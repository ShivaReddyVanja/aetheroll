import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { Api, utils } from "telegram";
import bigInt from "big-integer";
import { getDb } from "../lib/db";
import { decryptSession } from "../lib/crypto";
import { extractSessionToken, resolveUserAuth } from "../lib/auth";
import { getConnectedClient, getDefaultTelegramConfig } from "../lib/telegram";
import { isTelemetryEnabled } from "./logs";

export const streamRouter = new Hono();

// Maximum chunk size allowed by Telegram upload.GetFile is 512KB (524288 bytes)
const CHUNK_SIZE = 512 * 1024;

// Short-term in-memory cache for resolved Telegram message media objects (TTL: 10 minutes)
const mediaObjectCache = new Map<string, { media: any; peer: any; expires: number }>();

function toBigInt(val: number | string) {
  const fn: any = typeof bigInt === "function" ? bigInt : (bigInt as any).default;
  return fn(val);
}

function getInputFileLocation(mediaObj: any): { location: any; dcId?: number } | null {
  if (!mediaObj) return null;

  const doc = mediaObj.document || (mediaObj instanceof Api.Document ? mediaObj : null) || (mediaObj.className === "MessageMediaDocument" ? mediaObj.document : null);
  if (doc && doc.id && doc.accessHash && doc.fileReference) {
    return {
      dcId: doc.dcId,
      location: new Api.InputDocumentFileLocation({
        id: doc.id,
        accessHash: doc.accessHash,
        fileReference: doc.fileReference,
        thumbSize: "",
      }),
    };
  }

  const photo = mediaObj.photo || (mediaObj instanceof Api.Photo ? mediaObj : null) || (mediaObj.className === "MessageMediaPhoto" ? mediaObj.photo : null);
  if (photo && photo.id && photo.accessHash && photo.fileReference) {
    const sizes = photo.sizes || [];
    const largest = sizes[sizes.length - 1];
    return {
      dcId: photo.dcId,
      location: new Api.InputPhotoFileLocation({
        id: photo.id,
        accessHash: photo.accessHash,
        fileReference: photo.fileReference,
        thumbSize: largest?.type || "x",
      }),
    };
  }

  return null;
}

/**
 * Downloads a precise slice of a Telegram document/photo using direct Api.upload.GetFile RPC
 * Zero background generator loops, zero worker hangs.
 */
async function fetchTelegramChunk(
  client: any,
  mediaObj: any,
  offsetBytes: number,
  limitBytes: number
): Promise<Buffer> {
  try {
    const fileInfo = getInputFileLocation(mediaObj);
    if (fileInfo && fileInfo.location) {
      const req = new Api.upload.GetFile({
        location: fileInfo.location,
        offset: toBigInt(offsetBytes),
        limit: limitBytes,
      });

      const invokePromise = (async () => {
        try {
          const res: any = await client.invoke(req);
          if (res && res.bytes) return Buffer.from(res.bytes);
        } catch (invokeErr: any) {
          console.warn("[Stream] Direct GetFile invoke error:", invokeErr?.errorMessage || invokeErr?.message);
        }
        return null;
      })();

      const chunk = await Promise.race([
        invokePromise,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 3500)),
      ]);

      if (chunk && chunk.length > 0) {
        return chunk;
      }
    }
  } catch (err: any) {
    console.warn("[Stream] Direct GetFile invoke warning:", err?.message || err);
  }

  // Fallback to client.downloadMedia for cross-DC migration or small media
  try {
    const dlPromise = client.downloadMedia(mediaObj, {});
    const fullBuffer = await Promise.race([
      dlPromise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 3500)),
    ]);
    if (fullBuffer && fullBuffer.length > 0) {
      const buf = Buffer.from(fullBuffer);
      return buf.subarray(offsetBytes, offsetBytes + limitBytes);
    }
  } catch (dlErr) {
    console.warn("[Stream] downloadMedia fallback error:", dlErr);
  }

  return Buffer.alloc(0);
}

streamRouter.get("/", async (c) => {
  const mediaId = c.req.query("media_id");
  if (!mediaId) return c.text("media_id required", 400);

  const token = getCookie(c, "tg_session") || c.req.query("session_token") || "default";
  const rangeHeader = c.req.header("range") || "full";

  // 1. Check Cloudflare Edge Cache (Sub-3ms Local PoP Delivery)
  const workerOrigin = new URL(c.req.url).origin;
  const cacheKeyUrl = `${workerOrigin}/api/stream/cache/${encodeURIComponent(mediaId)}?range=${encodeURIComponent(rangeHeader)}`;
  const cacheKey = new Request(cacheKeyUrl, { method: "GET" });
  const cache = (caches as any)?.default;

  if (cache) {
    try {
      const cachedRes = await cache.match(cacheKey);
      if (cachedRes) {
        const hitHeaders = new Headers(cachedRes.headers);
        hitHeaders.set("x-edge-cache", "HIT");
        const originalStatus = parseInt(hitHeaders.get("x-original-status") || "206", 10);
        hitHeaders.delete("x-original-status");

        // Log Edge HIT to DO telemetry in background only when enabled
        const authDo = (c.env as any)?.AUTH_DO;
        if (authDo && typeof authDo.idFromName === "function" && isTelemetryEnabled(c.env)) {
          const doId = authDo.idFromName("global_telemetry");
          const stub = authDo.get(doId);
          const logReq = new Request(`${workerOrigin}/api/logs/log`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              category: "EDGE_CACHE",
              level: "success",
              message: `🟢 [Edge HIT ⚡ 2ms] ${mediaId.slice(0, 8)}... range=${rangeHeader}`,
              meta: { mediaId, range: rangeHeader, hit: true },
            }),
          });
          if ((c.executionCtx as any)?.waitUntil) {
            c.executionCtx.waitUntil(stub.fetch(logReq).catch(() => {}));
          }
        }

        return new Response(cachedRes.body, {
          status: originalStatus,
          headers: hitHeaders,
        });
      }
    } catch (cacheErr) {
      console.warn("[EdgeCache] Stream match error:", cacheErr);
    }
  }

  // 2. Fast Path: Route to Cloudflare Durable Object (warm MTProto connection in RAM)
  const authDo = (c.env as any)?.AUTH_DO;
  if (authDo && typeof authDo.idFromName === "function") {
    const doId = authDo.idFromName(token);
    const stub = authDo.get(doId);

    const envObj = (c.env as any) || {};
    const headers = new Headers(c.req.raw.headers);
    if (envObj.TELEGRAM_API_ID) headers.set("x-tg-api-id", String(envObj.TELEGRAM_API_ID));
    if (envObj.TELEGRAM_API_HASH) headers.set("x-tg-api-hash", String(envObj.TELEGRAM_API_HASH));
    if (envObj.TELEGRAM_TEST_MODE) headers.set("x-tg-test-mode", String(envObj.TELEGRAM_TEST_MODE));
    if (envObj.SESSION_ENCRYPTION_KEY) headers.set("x-tg-enc-key", String(envObj.SESSION_ENCRYPTION_KEY));
    if (envObj.ENABLE_TELEMETRY) headers.set("x-enable-telemetry", String(envObj.ENABLE_TELEMETRY));

    const req = new Request(c.req.url, {
      method: c.req.method,
      headers,
    });
    const doRes = await stub.fetch(req);
    const resHeaders = new Headers(doRes.headers);
    const body = await doRes.arrayBuffer();
    const response = new Response(body, {
      status: doRes.status,
      headers: resHeaders,
    });

    // 3. Save Successful 200/206 Partial Content Response to Edge Cache in Background
    if (cache && (response.status === 200 || response.status === 206)) {
      try {
        const resToCache = response.clone();
        const edgeHeaders = new Headers(resToCache.headers);
        edgeHeaders.set("Cache-Control", "public, max-age=31536000, immutable");
        edgeHeaders.set("x-original-status", response.status.toString());

        // Cloudflare Cache API strictly requires 200 OK status on cache.put()
        const edgeResponse = new Response(resToCache.body, {
          status: 200,
          headers: edgeHeaders,
        });

        const putPromise = cache.put(cacheKey, edgeResponse).catch((err: any) => {
          console.warn("[EdgeCache] Put error:", err?.message);
        });
        if ((c.executionCtx as any)?.waitUntil) {
          c.executionCtx.waitUntil(putPromise);
        }
      } catch (putErr) {
        console.warn("[EdgeCache] Save error:", putErr);
      }
    }

    const outHeaders = new Headers(response.headers);
    outHeaders.set("x-edge-cache", "MISS");
    outHeaders.set("Accept-Ranges", "bytes");
    outHeaders.set("Access-Control-Allow-Origin", "*");
    outHeaders.set("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges, x-edge-cache");
    return new Response(response.body, {
      status: response.status,
      headers: outHeaders,
    });
  }

  // 2. Fallback for local Node / SQLite dev environment
  try {
    const mediaId = c.req.query("media_id");
    if (!mediaId) return c.text("media_id required", 400);

    const auth = await resolveUserAuth(c);
    if (!auth.authenticated || !auth.sessionString) return c.text("Unauthorized", 401);

    const db = getDb((c.env as any)?.DB);
    const item = await db.get(
      `SELECT m.*, c.telegram_channel_id FROM media_items m
       JOIN channels c ON c.id = m.channel_id
       WHERE m.id = ?`,
      [mediaId]
    );

    if (!item) return c.text("Media item not found", 404);

    const totalSize = item.file_size_bytes;
    const rangeHeader = c.req.header("range");

    // Reuse persistent MTProto client connection (0ms connection overhead!)
    const client = await getConnectedClient(auth.sessionString, auth.telegramConfig);

    // Check message media cache to avoid redundant Telegram getMessages RPCs
    const now = Date.now();
    let cached = mediaObjectCache.get(mediaId);
    let mediaObj: any;
    let targetPeer: any;

    if (cached && cached.expires > now) {
      mediaObj = cached.media;
      targetPeer = cached.peer;
    } else {
      targetPeer = item.telegram_channel_id;
      if (item.telegram_channel_id === "me" || item.telegram_channel_id.startsWith("me_")) {
        targetPeer = "me";
      } else {
        try {
          targetPeer = await client.getInputEntity(item.telegram_channel_id);
        } catch {
          try {
            targetPeer = await client.getEntity(item.telegram_channel_id);
          } catch {}
        }
      }

      const msgId = Number(item.telegram_message_id);
      const messages = await client.getMessages(targetPeer, { ids: [msgId] });
      const msg = messages[0];

      if (!msg || !msg.media) {
        return c.text("Media not found in Telegram channel", 404);
      }

      mediaObj = msg.media;
      mediaObjectCache.set(mediaId, {
        media: mediaObj,
        peer: targetPeer,
        expires: now + 10 * 60 * 1000, // 10 minutes cache
      });
    }

    if (!rangeHeader) {
      // Full download (e.g. photo or full file download)
      const fullBuffer = await client.downloadMedia(mediaObj, {});
      return new Response(fullBuffer as any, {
        status: 200,
        headers: {
          "Content-Type": item.mime_type || "application/octet-stream",
          "Content-Length": (fullBuffer?.length || totalSize).toString(),
          "Accept-Ranges": "bytes",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges",
        },
      });
    }

    // Parse Range header: `bytes=start-end`
    const parts = rangeHeader.replace(/bytes=/, "").split("-");
    let start = parseInt(parts[0], 10);
    let requestedEnd = parts[1] ? parseInt(parts[1], 10) : undefined;

    // Telegram upload.GetFile chunk size is 512KB
    let end = requestedEnd !== undefined ? requestedEnd : Math.min(start + CHUNK_SIZE - 1, totalSize - 1);

    if (isNaN(start)) start = 0;
    if (isNaN(end) || end >= totalSize) end = totalSize - 1;
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

    // Align start to 512KB boundary for Telegram upload.GetFile
    const alignedStart = Math.floor(start / CHUNK_SIZE) * CHUNK_SIZE;
    const limit = CHUNK_SIZE; // Must strictly be a 4KB-aligned chunk size (512KB)

    // Fetch chunk directly from Telegram DC via upload.GetFile
    let chunkBuffer: Buffer;
    try {
      chunkBuffer = await fetchTelegramChunk(client, mediaObj, alignedStart, limit);
    } catch (err: any) {
      // Clear cache and retry with fresh message if file reference expired
      mediaObjectCache.delete(mediaId);
      console.warn("[Stream] Retrying with fresh message reference...", err);
      const msgId = Number(item.telegram_message_id);
      const messages = await client.getMessages(targetPeer, { ids: [msgId] });
      const freshMsg = messages[0];
      if (!freshMsg?.media) throw err;
      mediaObj = freshMsg.media;
      mediaObjectCache.set(mediaId, { media: mediaObj, peer: targetPeer, expires: Date.now() + 10 * 60 * 1000 });
      chunkBuffer = await fetchTelegramChunk(client, mediaObj, alignedStart, limit);
    }

    // Slice the exact requested byte range from the aligned chunk
    const sliceStart = start - alignedStart;
    const sliceEnd = Math.min(sliceStart + (end - start + 1), chunkBuffer.length);
    const exactSlice = chunkBuffer.subarray(sliceStart, sliceEnd);
    const actualEnd = start + exactSlice.length - 1;

    return new Response(exactSlice as any, {
      status: 206,
      headers: {
        "Content-Range": `bytes ${start}-${actualEnd}/${totalSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": exactSlice.length.toString(),
        "Content-Type": item.mime_type || "video/mp4",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges",
      },
    });
  } catch (error: any) {
    console.error("Streaming Proxy Error:", error);
    return c.text(error.message || "Streaming failed", 500);
  }
});
