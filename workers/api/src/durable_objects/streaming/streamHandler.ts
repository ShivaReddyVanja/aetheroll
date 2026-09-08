import { getDb } from "../../lib/db";
import { getR2Storage } from "../../lib/r2";
import { SlidingWindowRatePacer } from "../common/ratePacer";
import { TelemetryLogger } from "../telemetry/telemetryLogger";
import { ClientSessionManager } from "../auth/clientSessionManager";
import { MediaLocationResolver } from "./mediaLocationResolver";
import { ParallelSegmentFetcher } from "./parallelSegmentFetcher";
import { flushSessionBilling } from "../../lib/billing/index";

export class StreamHandler {
  streamAbortController: AbortController;

  constructor() {
    this.streamAbortController = new AbortController();
  }

  async handleStream(
    request: Request,
    envObj: any,
    clientSessionManager: ClientSessionManager,
    mediaLocationResolver: MediaLocationResolver,
    segmentFetcher: ParallelSegmentFetcher,
    ratePacer: SlidingWindowRatePacer,
    logger: TelemetryLogger
  ): Promise<Response> {
    const streamStartTime = performance.now();
    let billingFlushed = false;
    let activeUserId: string | undefined;

    const flushStreamBilling = () => {
      if (billingFlushed) return;
      billingFlushed = true;
      return flushSessionBilling({
        startTime: streamStartTime,
        userId: activeUserId,
        purpose: "STREAM_MEDIA",
        dbBinding: envObj?.DB,
      });
    };

    try {
      const url = new URL(request.url);
      const mediaId = url.searchParams.get("media_id");
      if (!mediaId) return new Response("media_id required", { status: 400 });

      const noCache = url.searchParams.get("nocache") === "1" || url.searchParams.get("nocache") === "true";

      // Reset the DO-wide stream abort controller for this media session.
      // When browser disconnects (request.signal fires), we abort the controller so
      // all background prefetch tasks also stop — not just the primary fetch.
      this.streamAbortController = new AbortController();
      const streamSignal = this.streamAbortController.signal;
      request.signal.addEventListener(
        "abort",
        () => {
          this.streamAbortController.abort();
          flushStreamBilling();
          logger.logEvent(
            "STREAM",
            "warn",
            `🛑 [Stream Cancelled] Browser disconnected for ${mediaId?.slice(0, 8)}... — aborting all background fetches`
          );
        },
        { once: true }
      );

      const { client, userId, error } = await clientSessionManager.getOrConnectUserClient(request, envObj);
      if (!client) return new Response(error || "Unauthorized", { status: 401 });
      activeUserId = userId;

      const db = getDb(envObj?.DB);
      const item = await db.get(
        `SELECT m.*, c.telegram_channel_id FROM media_items m
         JOIN channels c ON c.id = m.channel_id
         WHERE m.id = ?`,
        [mediaId]
      );
      if (!item) return new Response("Media item not found", { status: 404 });

      const totalSize = Number(item.file_size_bytes) || 0;
      const rangeHeader = request.headers.get("range");
      const r2 = getR2Storage(envObj?.R2_BUCKET);

      // 1. Resolve Media Location (cached in RAM for 1 hour)
      let fileLocation = await mediaLocationResolver.resolveMediaLocation(client, item);
      if (!fileLocation) {
        mediaLocationResolver.deleteLocation(item.id);
        fileLocation = await mediaLocationResolver.resolveMediaLocation(client, item);
        if (!fileLocation) return new Response("Media not found in Telegram", { status: 404 });
      }

      // 2. Parse Range header or safely default to initial 2MB slice for video playback
      // Support comma-delimited ranges (e.g. "bytes=0-, bytes=36888852-") by taking the last/most specific range
      const rawRange = rangeHeader ? rangeHeader.split(",").pop()!.trim() : undefined;

      let start = 0;
      let requestedEnd: number | undefined;

      if (rawRange) {
        const parts = rawRange.replace(/bytes=/, "").split("-");
        start = parseInt(parts[0], 10);
        requestedEnd = parts[1] ? parseInt(parts[1], 10) : undefined;
        if (isNaN(start)) start = 0;
      } else if (totalSize <= 2 * 1024 * 1024) {
        // Small media (<= 2MB, e.g. thumbnail or small photo): full download fallback is safe
        const msgId = Number(item.telegram_message_id);
        let targetPeer: any = item.telegram_channel_id;
        if (item.telegram_channel_id !== "me" && !item.telegram_channel_id.startsWith("me_")) {
          try {
            targetPeer = await client.getInputEntity(item.telegram_channel_id);
          } catch {
            try {
              targetPeer = await client.getEntity(item.telegram_channel_id);
            } catch {}
          }
        } else {
          targetPeer = "me";
        }
        const messages = await client.getMessages(targetPeer, { ids: [msgId] });
        const msg = messages[0];
        const fullBuffer = await client.downloadMedia(msg.media, {});
        return new Response(fullBuffer as any, {
          status: 200,
          headers: {
            "Content-Type": item.mime_type || "application/octet-stream",
            "Content-Length": (fullBuffer?.length || totalSize).toString(),
            "Accept-Ranges": "bytes",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges",
            "Cache-Control": noCache ? "no-store, no-cache, must-revalidate" : "public, max-age=31536000, immutable",
          },
        });
      }
      // If no range header and totalSize > 2MB, start remains 0, requestedEnd remains undefined (safely delivers first 2MB slice without 140MB buffer OOM)

      const BROWSER_CHUNK_SIZE = 2 * 1024 * 1024; // 2MB chunk size for fast TTFB and low memory usage
      const SEGMENT_SIZE = 16 * 1024 * 1024;

      let end: number;
      // If client specifically probes for a tiny range (< 64KB, e.g. moov atom / metadata probe), honor the tiny probe
      if (requestedEnd !== undefined && requestedEnd - start + 1 < 64 * 1024) {
        end = Math.min(requestedEnd, totalSize - 1);
      } else {
        // For video playback stream, deliver 2.0 MB slice (or up to EOF)
        end = Math.min(start + BROWSER_CHUNK_SIZE - 1, totalSize - 1);
      }

      if (start > end || start >= totalSize) {
        return new Response(null, {
          status: 416,
          headers: {
            "Content-Range": `bytes */${totalSize}`,
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges",
          },
        });
      }

      const segmentIndex = Math.floor(start / SEGMENT_SIZE);
      const segStart = segmentIndex * SEGMENT_SIZE;
      const endSegmentIndex = Math.floor(end / SEGMENT_SIZE);

      logger.logEvent(
        "STREAM",
        "info",
        `🎬 [Stream Request] ${item.id.slice(0, 8)}... Range: ${start}-${end}/${totalSize} (Segment ${segmentIndex}${
          endSegmentIndex !== segmentIndex ? `->${endSegmentIndex}` : ""
        })${noCache ? " [NO-CACHE]" : ""}`
      );

      // 3. Predictive Lookahead Prefetch: Fire at 75% into current segment so N is nearly
      //    done before N+1 starts — prevents two segments competing on the global rate pacer.
      //    Uses streamSignal (DO-wide) so it stops immediately when browser closes the player.
      const offsetWithinSeg = start - segStart;
      if (offsetWithinSeg >= (SEGMENT_SIZE * 3) / 4 && !noCache) {
        const nextSegIndex = segmentIndex + 1;
        if (nextSegIndex * SEGMENT_SIZE < totalSize) {
          segmentFetcher
            .fetchSegmentParallel(
              client,
              item,
              fileLocation,
              nextSegIndex,
              r2,
              false,
              streamSignal,
              ratePacer,
              logger,
              mediaLocationResolver
            )
            .catch(() => {});
        }
      }

      // 4. Fetch the primary 16MB segment in parallel
      const primarySegBuffer = await segmentFetcher.fetchSegmentParallel(
        client,
        item,
        fileLocation,
        segmentIndex,
        r2,
        noCache,
        streamSignal,
        ratePacer,
        logger,
        mediaLocationResolver
      );
      if (!primarySegBuffer || primarySegBuffer.length === 0) {
        return new Response("Segment unavailable", { status: 502 });
      }

      let exactSlice: Buffer;
      if (endSegmentIndex === segmentIndex) {
        // Slice is entirely within this segment
        const sliceStart = start - segStart;
        const sliceEnd = Math.min(sliceStart + (end - start + 1), primarySegBuffer.length);
        exactSlice = primarySegBuffer.subarray(sliceStart, sliceEnd);
      } else {
        // Slice crosses the 16MB segment boundary into the next segment
        const sliceStart = start - segStart;
        const firstPart = primarySegBuffer.subarray(sliceStart);

        const nextSegBuffer = await segmentFetcher.fetchSegmentParallel(
          client,
          item,
          fileLocation,
          endSegmentIndex,
          r2,
          noCache,
          streamSignal,
          ratePacer,
          logger,
          mediaLocationResolver
        );
        if (nextSegBuffer && nextSegBuffer.length > 0) {
          const neededBytes = end - start + 1 - firstPart.length;
          const secondPart = nextSegBuffer.subarray(0, Math.min(neededBytes, nextSegBuffer.length));
          exactSlice = Buffer.concat([firstPart, secondPart]);
        } else {
          exactSlice = firstPart;
        }
      }

      if (exactSlice.length === 0) {
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${totalSize}` },
        });
      }
      const actualEnd = start + exactSlice.length - 1;

      const videoMimeType =
        item.file_type === "video"
          ? item.mime_type === "video/webm"
            ? "video/webm"
            : "video/mp4"
          : item.mime_type || "image/jpeg";

      flushStreamBilling();

      return new Response(exactSlice as any, {
        status: 206,
        headers: {
          "Content-Range": `bytes ${start}-${actualEnd}/${totalSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": exactSlice.length.toString(),
          "Content-Type": videoMimeType,
          "Cache-Control": noCache ? "no-store, no-cache, must-revalidate" : "public, max-age=31536000, immutable",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges",
        },
      });
    } catch (err: any) {
      console.error("[TelegramAuthDO Stream Error]:", err);
      return new Response(err.message || "Streaming failed", { status: 500 });
    }
  }
}
