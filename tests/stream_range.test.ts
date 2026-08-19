import { describe, it } from "node:test";
import assert from "node:assert/strict";
import bigInt from "big-integer";

describe("⚡ Video Streaming & Chunk Range Math", () => {
  const CHUNK_SIZE = 512 * 1024; // 524,288 bytes (512KB Telegram alignment)

  it("should calculate correct 512KB aligned start offsets", () => {
    // Range: bytes=0-1000 -> Aligned start: 0
    assert.equal(Math.floor(0 / CHUNK_SIZE) * CHUNK_SIZE, 0);

    // Range: bytes=600000-700000 -> Aligned start: 524288 (Chunk 1)
    assert.equal(Math.floor(600000 / CHUNK_SIZE) * CHUNK_SIZE, 524288);

    // Range: bytes=1500000-2000000 -> Aligned start: 1048576 (Chunk 2)
    assert.equal(Math.floor(1500000 / CHUNK_SIZE) * CHUNK_SIZE, 1048576);
  });

  it("should slice exact sub-ranges from a 512KB Telegram chunk buffer", () => {
    // Mock 512KB chunk buffer
    const mockChunk = Buffer.alloc(CHUNK_SIZE);
    for (let i = 0; i < mockChunk.length; i++) {
      mockChunk[i] = i % 256;
    }

    const start = 600000;
    const end = 600100;
    const alignedStart = Math.floor(start / CHUNK_SIZE) * CHUNK_SIZE; // 524288

    const sliceStart = start - alignedStart; // 75712
    const sliceEnd = Math.min(sliceStart + (end - start + 1), mockChunk.length); // 75813
    const exactSlice = mockChunk.subarray(sliceStart, sliceEnd);

    assert.equal(exactSlice.length, 101, "Sliced buffer must exactly equal requested byte count (end - start + 1)");
    assert.equal(exactSlice[0], mockChunk[sliceStart]);
  });

  it("should convert offsets to BigInteger without throwing CastError across ESM/CJS", () => {
    function toBigInt(val: number | string) {
      const fn: any = typeof bigInt === "function" ? bigInt : (bigInt as any).default;
      return fn(val);
    }

    const offsets = [0, 524288, 1048576, 1572864, 52428800];
    for (const offset of offsets) {
      const converted = toBigInt(offset);
      assert.ok(converted !== undefined && converted !== null, "Converted BigInt must not be null");
      assert.equal(converted.toString(), offset.toString(), "BigInt string representation must match");
    }
  });

  it("should generate valid Content-Range and Content-Length headers", () => {
    const start = 1048576;
    const sliceLength = 524288;
    const actualEnd = start + sliceLength - 1;
    const totalSize = 14600000;

    const contentRange = `bytes ${start}-${actualEnd}/${totalSize}`;
    assert.equal(contentRange, "bytes 1048576-1572863/14600000");
    assert.equal(sliceLength.toString(), "524288");
  });
});
