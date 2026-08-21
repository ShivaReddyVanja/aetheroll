import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";

describe("⚡ Hybrid Upload Pipeline: 1MB Browser Frames ➔ 512KB MTProto Relay", () => {
  const BROWSER_CHUNK_SIZE = 1024 * 1024; // 1,048,576 bytes (1 MB)
  const TG_PART_SIZE = 512 * 1024; // 524,288 bytes (512 KB Telegram limit)

  it("1. should calculate correct 1MB browser chunk counts for small, medium, and large files", () => {
    // 100 KB photo -> 1 browser chunk
    assert.equal(Math.ceil((100 * 1024) / BROWSER_CHUNK_SIZE), 1);

    // Exactly 1 MB -> 1 browser chunk
    assert.equal(Math.ceil(BROWSER_CHUNK_SIZE / BROWSER_CHUNK_SIZE), 1);

    // 1 MB + 1 byte -> 2 browser chunks
    assert.equal(Math.ceil((BROWSER_CHUNK_SIZE + 1) / BROWSER_CHUNK_SIZE), 2);

    // 14.1 MB video (14,784,921 bytes) -> 15 browser chunks (down from 113 with 128KB, 29 with 512KB)
    const videoSize = 14784921;
    const browserChunkCount = Math.ceil(videoSize / BROWSER_CHUNK_SIZE);
    assert.equal(browserChunkCount, 15);
    assert.equal(Math.ceil(videoSize / (128 * 1024)), 113, "1MB provides ~7.5x reduction in total browser WebSocket frames over 128KB");
  });

  it("2. should correctly serialize and deserialize 1MB binary WebSocket frames", () => {
    const chunkIndex = 3;
    const payload = crypto.randomBytes(BROWSER_CHUNK_SIZE);

    // Encode: [4-byte Int32BE index | payload bytes]
    const frame = Buffer.alloc(4 + payload.length);
    frame.writeInt32BE(chunkIndex, 0);
    payload.copy(frame, 4);

    // Decode:
    const decodedIndex = frame.readInt32BE(0);
    const decodedPayload = frame.subarray(4);

    assert.equal(decodedIndex, 3);
    assert.equal(decodedPayload.length, BROWSER_CHUNK_SIZE);
    assert.deepEqual(decodedPayload, payload);
  });

  it("3. should accurately reassemble 1MB browser chunks and partition into 512KB Telegram MTProto parts", () => {
    const totalBytes = Math.floor(14.1 * 1024 * 1024); // 14,784,921 bytes (14.1 MB)
    const originalBuffer = crypto.randomBytes(totalBytes);
    const totalBrowserChunks = Math.ceil(totalBytes / BROWSER_CHUNK_SIZE);
    assert.equal(totalBrowserChunks, 15);

    // Slice into 1MB browser chunks
    const browserSlices: { index: number; buffer: Buffer }[] = [];
    for (let i = 0; i < totalBrowserChunks; i++) {
      const start = i * BROWSER_CHUNK_SIZE;
      const end = Math.min(start + BROWSER_CHUNK_SIZE, totalBytes);
      browserSlices.push({
        index: i,
        buffer: originalBuffer.subarray(start, end),
      });
    }

    // Reassemble in DO RAM
    const receivedChunks = new Array(totalBrowserChunks);
    for (const slice of browserSlices) {
      receivedChunks[slice.index] = slice.buffer;
    }
    const fullBuffer = Buffer.concat(receivedChunks.filter(Boolean));
    assert.equal(fullBuffer.length, totalBytes);
    assert.deepEqual(fullBuffer, originalBuffer);

    // Partition fullBuffer into 512KB MTProto parts
    const tgPartCount = Math.ceil(fullBuffer.length / TG_PART_SIZE);
    assert.equal(tgPartCount, 29);

    const tgParts: Buffer[] = [];
    for (let p = 0; p < tgPartCount; p++) {
      const start = p * TG_PART_SIZE;
      const end = Math.min(start + TG_PART_SIZE, fullBuffer.length);
      const chunk = fullBuffer.subarray(start, end);
      assert.ok(chunk.length <= TG_PART_SIZE, "Each Telegram part must not exceed 512KB");
      tgParts.push(chunk);
    }

    const reassembledFromTgParts = Buffer.concat(tgParts);
    assert.deepEqual(reassembledFromTgParts, originalBuffer, "Telegram parts must reassemble to bit-identical original buffer");
  });

  it("4. should correctly partition 512KB MTProto parts and generate concurrent batches", () => {
    const fileSize = 14.1 * 1024 * 1024; // 14.1 MB
    const partCount = Math.ceil(fileSize / TG_PART_SIZE);
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
