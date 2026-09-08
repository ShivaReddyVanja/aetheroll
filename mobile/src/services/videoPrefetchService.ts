import { getApiBaseUrl, getSessionToken } from './api';
import { telemetryService } from './telemetryService';

const CHUNK_SIZE = 2 * 1024 * 1024; // 2MB standard chunk size
const LOOKAHEAD_CHUNKS = 5; // 5 chunks (10MB) sliding lookahead window (~25-35s of video)
const MAX_CONCURRENT_FETCHES = 2; // Pipelined concurrency: 2 in-flight requests at a time

class VideoPrefetchService {
  private activeMediaId: string | null = null;
  private totalSizeBytes = 0;
  private currentChunkIndex = 0;
  private prefetchedChunks = new Set<string>();
  private inFlightChunks = new Set<string>();
  private pendingQueue: number[] = [];
  private abortControllers = new Map<string, AbortController>();

  /**
   * Proactively prefetch lookahead chunks as playback progresses
   */
  public updatePlaybackProgress(
    mediaId: string,
    currentTime: number,
    duration: number,
    totalSizeBytes: number
  ) {
    if (!mediaId || totalSizeBytes <= 0 || duration <= 0) return;

    if (this.activeMediaId !== mediaId) {
      this.resetForMedia(mediaId, totalSizeBytes);
    }

    this.totalSizeBytes = totalSizeBytes;

    // Estimate current byte offset from playback time ratio
    const currentByteOffset = Math.min(
      Math.floor((currentTime / duration) * totalSizeBytes),
      totalSizeBytes - 1
    );

    const chunkIndex = Math.floor(currentByteOffset / CHUNK_SIZE);
    if (chunkIndex !== this.currentChunkIndex || this.pendingQueue.length === 0) {
      this.currentChunkIndex = chunkIndex;
      this.rebuildQueue();
    }
  }

  /**
   * Warm up initial chunks when a video is first opened
   */
  public prefetchInitialChunks(mediaId: string, totalSizeBytes: number) {
    if (!mediaId || totalSizeBytes <= 0) return;

    this.resetForMedia(mediaId, totalSizeBytes);
    this.currentChunkIndex = 0;
    this.rebuildQueue();
  }

  private resetForMedia(mediaId: string, totalSizeBytes: number) {
    this.cancelAll();
    this.activeMediaId = mediaId;
    this.totalSizeBytes = totalSizeBytes;
    this.currentChunkIndex = 0;
    this.prefetchedChunks.clear();
    this.inFlightChunks.clear();
    this.pendingQueue = [];
  }

  private rebuildQueue() {
    if (!this.activeMediaId || this.totalSizeBytes <= 0) return;

    const maxChunkIndex = Math.floor((this.totalSizeBytes - 1) / CHUNK_SIZE);
    const neededChunks: number[] = [];

    for (let i = 1; i <= LOOKAHEAD_CHUNKS; i++) {
      const targetChunk = this.currentChunkIndex + i;
      if (targetChunk > maxChunkIndex) break;

      const chunkKey = `${this.activeMediaId}:${targetChunk}`;
      if (!this.prefetchedChunks.has(chunkKey) && !this.inFlightChunks.has(chunkKey)) {
        neededChunks.push(targetChunk);
      }
    }

    this.pendingQueue = neededChunks;
    this.pumpQueue();
  }

  private pumpQueue() {
    if (!this.activeMediaId) return;

    while (
      this.inFlightChunks.size < MAX_CONCURRENT_FETCHES &&
      this.pendingQueue.length > 0
    ) {
      const nextChunk = this.pendingQueue.shift();
      if (nextChunk !== undefined) {
        this.fetchChunkInBackground(this.activeMediaId, nextChunk, this.totalSizeBytes);
      }
    }
  }

  private async fetchChunkInBackground(mediaId: string, chunkIndex: number, totalSizeBytes: number) {
    const chunkKey = `${mediaId}:${chunkIndex}`;
    const start = chunkIndex * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE - 1, totalSizeBytes - 1);

    this.inFlightChunks.add(chunkKey);
    const controller = new AbortController();
    this.abortControllers.set(chunkKey, controller);

    const token = getSessionToken();
    const streamUrl = `${getApiBaseUrl()}/api/stream?media_id=${encodeURIComponent(mediaId)}`;

    const headers: Record<string, string> = {
      Range: `bytes=${start}-${end}`,
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
      headers['x-tg-session'] = token;
    }

    const startTime = Date.now();
    try {
      const response = await fetch(streamUrl, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });

      const latencyMs = Date.now() - startTime;
      const cfCache = response.headers.get('cf-cache-status') || response.headers.get('x-cache') || 'EDGE';

      if (response.ok || response.status === 206) {
        // Read stream to complete caching and immediately free buffer
        await response.arrayBuffer();

        this.prefetchedChunks.add(chunkKey);
        telemetryService.addLog({
          category: 'PREFETCH',
          level: 'success',
          message: `⚡ [Lookahead Prefetch] Chunk ${chunkIndex} (${(start / 1024 / 1024).toFixed(1)}MB-${(end / 1024 / 1024).toFixed(1)}MB) warmed in ${latencyMs}ms [${cfCache}]`,
          meta: { chunkIndex, start, end, latencyMs, cfCache },
        });
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        telemetryService.addLog({
          category: 'PREFETCH',
          level: 'warn',
          message: `⚠️ [Prefetch Skipped] Chunk ${chunkIndex}: ${err.message}`,
        });
      }
    } finally {
      this.inFlightChunks.delete(chunkKey);
      this.abortControllers.delete(chunkKey);

      // Trigger next item in queue
      if (this.activeMediaId === mediaId) {
        this.pumpQueue();
      }
    }
  }

  /**
   * Cancel all in-flight and queued prefetch requests
   */
  public cancelAll() {
    for (const controller of this.abortControllers.values()) {
      controller.abort();
    }
    this.abortControllers.clear();
    this.inFlightChunks.clear();
    this.pendingQueue = [];
  }
}

export const videoPrefetchService = new VideoPrefetchService();
