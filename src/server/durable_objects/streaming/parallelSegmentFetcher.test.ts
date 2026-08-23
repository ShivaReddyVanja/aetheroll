import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("⚡ Dual-Chunk Read-Ahead Video Streaming & Prefetch Pipeline", () => {
  const CHUNK_SIZE = 512 * 1024; // 524,288 bytes

  it("1. should compute correct alignedStart and nextAlignedStart for read-ahead prefetch", () => {
    const totalSize = 100 * 1024 * 1024; // 100 MB video

    // Case A: Initial playback at byte 0
    const start0 = 0;
    const aligned0 = Math.floor(start0 / CHUNK_SIZE) * CHUNK_SIZE;
    const next0 = aligned0 + CHUNK_SIZE;
    assert.equal(aligned0, 0);
    assert.equal(next0, 524288);
    assert.ok(next0 < totalSize, "Next chunk offset is within file size");

    // Case B: Seek to 25.3 MB (byte 26,528,972)
    const seekByte = 26528972;
    const alignedSeek = Math.floor(seekByte / CHUNK_SIZE) * CHUNK_SIZE;
    const nextSeek = alignedSeek + CHUNK_SIZE;
    assert.equal(alignedSeek, 50 * CHUNK_SIZE);
    assert.equal(nextSeek, 51 * CHUNK_SIZE);

    // Case C: Last chunk of a 1.2 MB file (1,258,291 bytes)
    const smallTotal = 1258291;
    const startLast = 1048576; // Chunk 2 (starts at 1MB)
    const alignedLast = Math.floor(startLast / CHUNK_SIZE) * CHUNK_SIZE;
    const nextLast = alignedLast + CHUNK_SIZE;
    assert.equal(alignedLast, 1048576);
    assert.equal(nextLast, 1572864);
    assert.ok(nextLast >= smallTotal, "Should not trigger prefetch beyond file totalSize");
  });

  it("2. should deduplicate parallel requests using in-flight promises", async () => {
    const inFlightMap = new Map<string, Promise<Buffer>>();
    let rpcCallCount = 0;

    const mockFetchRpc = (chunkKey: string) => {
      const existing = inFlightMap.get(chunkKey);
      if (existing) return existing;

      const p = (async () => {
        rpcCallCount++;
        await new Promise((r) => setTimeout(r, 20));
        return Buffer.alloc(CHUNK_SIZE, 0xaa);
      })().finally(() => {
        inFlightMap.delete(chunkKey);
      });

      inFlightMap.set(chunkKey, p);
      return p;
    };

    // 3 parallel requests for the same chunk (e.g. video player range probe + speculative prefetch)
    const [res1, res2, res3] = await Promise.all([
      mockFetchRpc("item_123:0"),
      mockFetchRpc("item_123:0"),
      mockFetchRpc("item_123:0"),
    ]);

    assert.equal(rpcCallCount, 1, "Only 1 RPC was launched despite 3 concurrent requests");
    assert.equal(res1.length, CHUNK_SIZE);
    assert.equal(res2.length, CHUNK_SIZE);
    assert.equal(res3.length, CHUNK_SIZE);
    assert.equal(inFlightMap.size, 0, "In-flight map cleaned up after completion");
  });

  it("3. should enforce LRU RAM cache bounds to prevent memory bloat", () => {
    const prefetchedChunks = new Map<string, { buffer: Buffer; expires: number }>();
    const MAX_RAM_CHUNKS = 8;

    const storeInRam = (key: string, buf: Buffer) => {
      if (prefetchedChunks.size >= MAX_RAM_CHUNKS) {
        const oldestKey = prefetchedChunks.keys().next().value;
        if (oldestKey) prefetchedChunks.delete(oldestKey);
      }
      prefetchedChunks.set(key, { buffer: buf, expires: Date.now() + 180000 });
    };

    // Add 12 chunks
    for (let i = 0; i < 12; i++) {
      storeInRam(`chunk_${i}`, Buffer.alloc(512 * 1024));
    }

    assert.equal(prefetchedChunks.size, MAX_RAM_CHUNKS, "RAM cache is strictly capped at 8 chunks (4MB)");
    assert.ok(!prefetchedChunks.has("chunk_0"), "Oldest chunk_0 was evicted");
    assert.ok(!prefetchedChunks.has("chunk_3"), "Old chunk_3 was evicted");
    assert.ok(prefetchedChunks.has("chunk_11"), "Newest chunk_11 is present");
  });
});
