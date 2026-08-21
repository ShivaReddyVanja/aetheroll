import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";

describe("⚡ 512KB Upload Pipeline & MTProto Pipelining Suite", () => {
  const CHUNK_SIZE = 512 * 1024; // 524,288 bytes

  it("1. should calculate correct 512KB chunk counts for small, medium, and large files", () => {
    // 100 KB photo -> 1 chunk
    assert.equal(Math.ceil((100 * 1024) / CHUNK_SIZE), 1);

    // Exactly 512 KB -> 1 chunk
    assert.equal(Math.ceil(CHUNK_SIZE / CHUNK_SIZE), 1);

    // 512 KB + 1 byte -> 2 chunks
    assert.equal(Math.ceil((CHUNK_SIZE + 1) / CHUNK_SIZE), 2);

    // 14.1 MB video (14,784,921 bytes) -> 29 chunks (down from 113 with 128KB)
    const videoSize = 14784921;
    const chunkCount = Math.ceil(videoSize / CHUNK_SIZE);
    assert.equal(chunkCount, 29);
    assert.equal(Math.ceil(videoSize / (128 * 1024)), 113, "512KB provides ~4x reduction in total network chunks");
  });

  it("2. should correctly serialize and deserialize 512KB binary WebSocket frames", () => {
    const chunkIndex = 7;
    const payload = crypto.randomBytes(CHUNK_SIZE);

    // Encode: [4-byte Int32BE index | payload bytes]
    const frame = Buffer.alloc(4 + payload.length);
    frame.writeInt32BE(chunkIndex, 0);
    payload.copy(frame, 4);

    // Decode:
    const decodedIndex = frame.readInt32BE(0);
    const decodedPayload = frame.subarray(4);

    assert.equal(decodedIndex, 7);
    assert.equal(decodedPayload.length, CHUNK_SIZE);
    assert.deepEqual(decodedPayload, payload);
  });

  it("3. should accurately reassemble chunks received out of order or concurrently", () => {
    const totalBytes = 2 * 1024 * 1024 + 12345; // ~2.01 MB -> 5 chunks
    const originalBuffer = crypto.randomBytes(totalBytes);
    const totalChunks = Math.ceil(totalBytes / CHUNK_SIZE);
    assert.equal(totalChunks, 5);

    // Slice all chunks
    const slices: { index: number; buffer: Buffer }[] = [];
    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, totalBytes);
      slices.push({
        index: i,
        buffer: originalBuffer.subarray(start, end),
      });
    }

    // Shuffle chunks to simulate out-of-order network arrivals
    const shuffled = [...slices].reverse();

    // Store in chunk array
    const receivedChunks = new Array(totalChunks);
    const uploadedParts = new Set<number>();

    for (const item of shuffled) {
      receivedChunks[item.index] = item.buffer;
      uploadedParts.add(item.index);
    }

    assert.equal(uploadedParts.size, totalChunks);
    const reassembled = Buffer.concat(receivedChunks.filter(Boolean));

    assert.equal(reassembled.length, totalBytes);
    assert.deepEqual(reassembled, originalBuffer, "Reassembled buffer must be bit-for-bit identical to original file");
  });

  it("4. should correctly partition 512KB MTProto parts and generate concurrent batches", () => {
    const fileSize = 14.1 * 1024 * 1024; // 14.1 MB
    const partCount = Math.ceil(fileSize / CHUNK_SIZE);
    const CONCURRENCY = 2;

    const batches: { startPart: number; endPart: number; count: number }[] = [];
    let dispatchedParts = 0;

    for (let i = 0; i < partCount; i += CONCURRENCY) {
      const batchPartIndices: number[] = [];
      for (let j = i; j < Math.min(i + CONCURRENCY, partCount); j++) {
        batchPartIndices.push(j);
        dispatchedParts++;
      }
      batches.push({
        startPart: batchPartIndices[0],
        endPart: batchPartIndices[batchPartIndices.length - 1],
        count: batchPartIndices.length,
      });
    }

    assert.equal(dispatchedParts, partCount, "All parts must be dispatched across batches");
    assert.equal(batches.length, Math.ceil(partCount / CONCURRENCY), "Batch count must match ceil(partCount / CONCURRENCY)");
    assert.ok(batches[0].count <= CONCURRENCY);
  });
});
