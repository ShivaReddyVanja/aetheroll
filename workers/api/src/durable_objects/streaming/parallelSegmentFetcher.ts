import { Api } from "telegram";
import { toBigInt, SlidingWindowRatePacer } from "../common/ratePacer";
import type { PrefetchedChunkEntry, SegmentCacheEntry } from "../common/types";
import { TelemetryLogger } from "../telemetry/telemetryLogger";
import { MediaLocationResolver } from "./mediaLocationResolver";

export class ParallelSegmentFetcher {
  segmentRingCache: Map<string, SegmentCacheEntry>;
  prefetchedChunks: Map<string, PrefetchedChunkEntry>;
  inFlightSegments: Map<string, Promise<Buffer | null>>;

  constructor() {
    this.segmentRingCache = new Map();
    this.prefetchedChunks = new Map();
    this.inFlightSegments = new Map();
  }

  storeChunkInRam(chunkKey: string, buffer: Buffer) {
    const now = Date.now();
    // Keep max 8 chunks in memory (~4MB max) to stay well within Cloudflare Worker memory limits
    if (this.prefetchedChunks.size >= 8) {
      const oldestKey = this.prefetchedChunks.keys().next().value;
      if (oldestKey) this.prefetchedChunks.delete(oldestKey);
    }
    this.prefetchedChunks.set(chunkKey, {
      buffer,
      expires: now + 3 * 60 * 1000, // 3 minutes TTL
    });
  }

  async fetchSegmentParallel(
    client: any,
    item: any,
    fileLocation: any,
    segmentIndex: number,
    r2: any,
    bypassCache: boolean = false,
    signal?: AbortSignal,
    ratePacer?: SlidingWindowRatePacer,
    logger?: TelemetryLogger,
    mediaLocationResolver?: MediaLocationResolver
  ): Promise<Buffer | null> {
    const SEGMENT_SIZE = 16 * 1024 * 1024;
    const TG_CHUNK_SIZE = 512 * 1024;
    const totalSize = Number(item.file_size_bytes) || 0;
    const segStart = segmentIndex * SEGMENT_SIZE;
    if (segStart >= totalSize) return null;
    const segEnd = Math.min(segStart + SEGMENT_SIZE, totalSize);
    const segLength = segEnd - segStart;
    const segmentKey = `${item.id}:seg:${segmentIndex}`;

    // 1. Check in-memory ring cache (unless bypassCache is requested)
    if (!bypassCache) {
      const now = Date.now();
      const cached = this.segmentRingCache.get(segmentKey);
      if (cached && cached.expires > now) {
        cached.lastUsed = now;
        logger?.logEvent(
          "RAM",
          "success",
          `⚡ [Ring-Buffer Hit] Segment ${segmentIndex} (${(segLength / 1024 / 1024).toFixed(1)}MB)`
        );
        return cached.buffer;
      }
    }

    // 2. Check In-Flight Promise deduplication (ALWAYS share active in-flight fetches unless explicitly bypassing)
    const existing = this.inFlightSegments.get(segmentKey);
    if (existing && !bypassCache) {
      logger?.logEvent("PREFETCH", "info", `🔗 [In-Flight Share] Joining active Segment ${segmentIndex} fetch`);
      return existing;
    }

    const fetchPromise = (async (): Promise<Buffer | null> => {
      const segStartTime = Date.now();
      try {
        const offsets: number[] = [];
        for (let off = segStart; off < segEnd; off += TG_CHUNK_SIZE) {
          offsets.push(off);
        }

        const CONCURRENCY = 10;
        const totalParts = offsets.length;

        logger?.logEvent(
          "STREAM",
          "info",
          `⚡ [Parallel Segment ${segmentIndex} Start] Fetching ${totalParts} parts (${(segLength / 1024 / 1024).toFixed(1)}MB) with ${CONCURRENCY} MTProto workers (Global Pacer <= 25 req/s)`
        );
        console.log(
          `[Stream Benchmark] ⚡ Starting Segment ${segmentIndex} (${(segLength / 1024 / 1024).toFixed(2)} MB, ${totalParts} parts) with CONCURRENCY=${CONCURRENCY}`
        );

        const buffers: Buffer[] = new Array(offsets.length);
        let cursor = 0;
        let requestsSent = 0;
        let requestsCompleted = 0;
        const latencies: number[] = [];

        const downloadWorker = async (workerId: number) => {
          while (cursor < offsets.length) {
            if (signal?.aborted) {
              logger?.logEvent("STREAM", "warn", `🛑 [Stream Aborted] Worker ${workerId} stopped for segment ${segmentIndex}`);
              break;
            }

            const idx = cursor++;
            const offset = offsets[idx];
            const partLength = Math.min(TG_CHUNK_SIZE, totalSize - offset);
            const partStartTime = Date.now();

            // Check if individual chunk is in prefetchedChunks
            const chunkKey = `${item.id}:${offset}`;
            if (!bypassCache) {
              const ramChunk = this.prefetchedChunks.get(chunkKey);
              if (ramChunk && ramChunk.expires > Date.now()) {
                buffers[idx] = ramChunk.buffer.subarray(0, partLength);
                continue;
              }
            }

            try {
              if (signal?.aborted) break;
              if (ratePacer) await ratePacer.acquire();
              if (signal?.aborted) break;

              requestsSent++;
              const req = new Api.upload.GetFile({
                location: fileLocation,
                offset: toBigInt(offset),
                limit: TG_CHUNK_SIZE,
                precise: true,
              });
              const res: any = await Promise.race([
                client.invoke(req),
                new Promise((_, reject) => setTimeout(() => reject(new Error("Segment chunk timeout")), 7000)),
              ]);
              if (res && res.bytes) {
                const latency = Date.now() - partStartTime;
                latencies.push(latency);
                requestsCompleted++;
                const b = Buffer.from(res.bytes).subarray(0, partLength);
                buffers[idx] = b;
                this.storeChunkInRam(chunkKey, b);
                logger?.logEvent(
                  "MTPROTO",
                  "info",
                  `📦 [Worker ${workerId} | Part ${idx + 1}/${offsets.length}] offset=${offset} (512KB) in ${latency}ms`
                );
              }
            } catch (err: any) {
              if (signal?.aborted) break;
              console.warn(`[SegmentFetch] Worker ${workerId} Error offset=${offset}:`, err?.message);
              if (err?.errorMessage === "FILE_REFERENCE_EXPIRED") {
                mediaLocationResolver?.deleteLocation(item.id);
              }
              // Retry once with fresh invoke
              try {
                if (signal?.aborted) break;
                if (ratePacer) await ratePacer.acquire();
                if (signal?.aborted) break;

                requestsSent++;
                const retryStartTime = Date.now();
                const req = new Api.upload.GetFile({
                  location: fileLocation,
                  offset: toBigInt(offset),
                  limit: TG_CHUNK_SIZE,
                  precise: true,
                });
                const res: any = await client.invoke(req);
                if (res && res.bytes) {
                  const latency = Date.now() - retryStartTime;
                  latencies.push(latency);
                  requestsCompleted++;
                  const b = Buffer.from(res.bytes).subarray(0, partLength);
                  buffers[idx] = b;
                  this.storeChunkInRam(chunkKey, b);
                  logger?.logEvent(
                    "MTPROTO",
                    "info",
                    `📦 [Worker ${workerId} | Part ${idx + 1}/${offsets.length} Retry] offset=${offset} in ${latency}ms`
                  );
                }
              } catch {}
            }
          }
        };

        const workers = Array.from({ length: Math.min(CONCURRENCY, offsets.length) }, (_, i) => downloadWorker(i + 1));
        await Promise.all(workers);

        if (signal?.aborted) return null;

        const assembled = Buffer.concat(buffers.filter(Boolean));
        if (assembled.length === 0) return null;

        // Maintain Ring-Buffer Cache (keep max 3 active segments ~48MB in RAM)
        if (this.segmentRingCache.size >= 3) {
          let oldestKey: string | null = null;
          let oldestTime = Infinity;
          for (const [k, v] of this.segmentRingCache.entries()) {
            if (v.lastUsed < oldestTime) {
              oldestTime = v.lastUsed;
              oldestKey = k;
            }
          }
          if (oldestKey) this.segmentRingCache.delete(oldestKey);
        }

        this.segmentRingCache.set(segmentKey, {
          buffer: assembled,
          expires: Date.now() + 15 * 60 * 1000, // 15 min TTL
          lastUsed: Date.now(),
        });

        const elapsed = Date.now() - segStartTime;
        const mb = assembled.length / 1024 / 1024;
        const speedMbS = elapsed > 0 ? (mb / (elapsed / 1000)).toFixed(2) : "0";
        const rps = elapsed > 0 ? (requestsCompleted / (elapsed / 1000)).toFixed(1) : "0";
        const avgLat =
          latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;
        const minLat = latencies.length > 0 ? Math.min(...latencies) : 0;
        const maxLat = latencies.length > 0 ? Math.max(...latencies) : 0;

        const summaryLog = `📊 [Segment ${segmentIndex} Benchmark | WORKERS=${CONCURRENCY} | GLOBAL PACER<=25rps] Size: ${mb.toFixed(1)}MB | Time: ${elapsed}ms | Speed: ${speedMbS} MB/s | Rate: ${rps} req/sec | Latency: avg=${avgLat}ms (min=${minLat}ms, max=${maxLat}ms) | Requests: ${requestsCompleted}/${requestsSent} completed`;
        console.log(summaryLog);

        logger?.logEvent(
          "STREAM",
          "success",
          `🚀 [Segment ${segmentIndex} Benchmark | WORKERS=${CONCURRENCY} | GLOBAL PACER<=25rps] ${mb.toFixed(1)}MB in ${elapsed}ms (${speedMbS} MB/s) | ${rps} req/sec | avg chunk: ${avgLat}ms`
        );

        return assembled;
      } finally {
        this.inFlightSegments.delete(segmentKey);
      }
    })();

    this.inFlightSegments.set(segmentKey, fetchPromise);
    return fetchPromise;
  }

  async fetchSingleChunk(
    client: any,
    item: any,
    fileLocation: any,
    alignedOffset: number,
    r2: any,
    ratePacer?: SlidingWindowRatePacer,
    logger?: TelemetryLogger,
    mediaLocationResolver?: MediaLocationResolver
  ): Promise<Buffer | null> {
    const chunkKey = `${item.id}:${alignedOffset}`;
    const now = Date.now();

    // 1. Check RAM Cache (0ms)
    const ramCached = this.prefetchedChunks.get(chunkKey);
    if (ramCached && ramCached.expires > now) {
      return ramCached.buffer;
    }

    // 2. Check Ring-Buffer Segment Cache
    const SEGMENT_SIZE = 16 * 1024 * 1024;
    const segmentIndex = Math.floor(alignedOffset / SEGMENT_SIZE);
    const segment = await this.fetchSegmentParallel(
      client,
      item,
      fileLocation,
      segmentIndex,
      r2,
      false,
      undefined,
      ratePacer,
      logger,
      mediaLocationResolver
    );
    if (segment) {
      const segStart = segmentIndex * SEGMENT_SIZE;
      const sliceStart = alignedOffset - segStart;
      const sliceEnd = Math.min(sliceStart + 512 * 1024, segment.length);
      return segment.subarray(sliceStart, sliceEnd);
    }

    return null;
  }

  clear() {
    this.segmentRingCache.clear();
    this.prefetchedChunks.clear();
    this.inFlightSegments.clear();
  }
}
