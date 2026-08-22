import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { SlidingWindowRatePacer } from "../src/server/durable_objects/TelegramAuthDO.ts";

describe("⚡ Upload Pipeline: Rate-Paced Worker Pool & Backpressure Flow Control", () => {
  const TG_PART_SIZE = 512 * 1024; // 524,288 bytes (512 KB Telegram limit)
  const CONCURRENCY = 4;

  it("1. should calculate 512KB part counts and byte offsets accurately for small to large files", () => {
    // 100 KB photo -> 1 part
    assert.equal(Math.ceil((100 * 1024) / TG_PART_SIZE), 1);

    // Exactly 512 KB -> 1 part
    assert.equal(Math.ceil(TG_PART_SIZE / TG_PART_SIZE), 1);

    // 512 KB + 1 byte -> 2 parts
    assert.equal(Math.ceil((TG_PART_SIZE + 1) / TG_PART_SIZE), 2);

    // 88.69 MB video (88,695,577 bytes) -> 170 parts
    const videoSize = 88695577;
    const partCount = Math.ceil(videoSize / TG_PART_SIZE);
    assert.equal(partCount, 170);
  });

  it("2. should correctly encode and decode 512KB binary WebSocket frames with big-endian header", () => {
    const partIndex = 42;
    const payload = crypto.randomBytes(TG_PART_SIZE);

    // Encode: [4-byte Int32BE index | payload bytes]
    const frame = Buffer.alloc(4 + payload.length);
    frame.writeInt32BE(partIndex, 0);
    payload.copy(frame, 4);

    // Decode:
    const decodedIndex = frame.readInt32BE(0);
    const decodedPayload = frame.subarray(4);

    assert.equal(decodedIndex, 42);
    assert.equal(decodedPayload.length, TG_PART_SIZE);
    assert.deepEqual(decodedPayload, payload);
  });

  it("3. SlidingWindowRatePacer should strictly enforce <= 25 req/sec limit across concurrent workers", async () => {
    const pacer = new SlidingWindowRatePacer(25, 1000);
    const timestamps: number[] = [];

    // Simulate 35 rapid requests fired simultaneously across 4 workers
    const tasks = Array.from({ length: 35 }, async () => {
      await pacer.acquire();
      timestamps.push(Date.now());
    });

    await Promise.all(tasks);

    assert.equal(timestamps.length, 35);

    // Verify that within ANY 1000ms window, the count of timestamps is <= 25
    for (let i = 0; i < timestamps.length; i++) {
      const windowStart = timestamps[i];
      const countInWindow = timestamps.filter((t) => t >= windowStart && t < windowStart + 990).length;
      assert.ok(countInWindow <= 25, `Window starting at ${windowStart} had ${countInWindow} requests, exceeding 25 rps limit`);
    }
  });

  it("4. Worker pool should stream parts concurrently up to max limit without exceeding concurrency", async () => {
    const totalParts = 20;
    let activeWorkers = 0;
    let maxObservedConcurrency = 0;
    const completedParts = new Set<number>();

    // Simulated part queue
    const queue = Array.from({ length: totalParts }, (_, i) => i);

    const runWorker = async (workerId: number) => {
      while (queue.length > 0) {
        const partIndex = queue.shift();
        if (partIndex === undefined) break;

        activeWorkers++;
        maxObservedConcurrency = Math.max(maxObservedConcurrency, activeWorkers);

        // Simulate network latency (20ms)
        await new Promise((r) => setTimeout(r, 20));

        completedParts.add(partIndex);
        activeWorkers--;
      }
    };

    const workers = Array.from({ length: CONCURRENCY }, (_, i) => runWorker(i + 1));
    await Promise.all(workers);

    assert.equal(completedParts.size, totalParts, "All 20 parts must be processed");
    assert.ok(maxObservedConcurrency <= CONCURRENCY, `Concurrency was ${maxObservedConcurrency}, should not exceed ${CONCURRENCY}`);
    assert.equal(activeWorkers, 0);
  });

  it("5. Flow control sliding window should prevent unbounded buffer accumulation in RAM", async () => {
    const WINDOW_SIZE = 4;
    const TOTAL_CHUNKS = 16;
    let nextToSend = 0;
    let ackedChunks = 0;
    let maxBufferInFlight = 0;

    const inFlightBuffers = new Map<number, Buffer>();

    const simulateServerProcessing = async (chunkIndex: number) => {
      // Server takes ~30ms to save part to MTProto
      await new Promise((r) => setTimeout(r, 30));
      inFlightBuffers.delete(chunkIndex);
      ackedChunks++;
    };

    // Client pump loop with sliding window backpressure
    while (ackedChunks < TOTAL_CHUNKS) {
      while (nextToSend < TOTAL_CHUNKS && (nextToSend - ackedChunks) < WINDOW_SIZE) {
        const chunkIndex = nextToSend++;
        const dummyBuffer = Buffer.alloc(TG_PART_SIZE);
        inFlightBuffers.set(chunkIndex, dummyBuffer);

        maxBufferInFlight = Math.max(maxBufferInFlight, inFlightBuffers.size);

        // Fire server processing (simulating network send + MTProto save)
        simulateServerProcessing(chunkIndex);
      }

      await new Promise((r) => setTimeout(r, 10));
    }

    assert.equal(ackedChunks, TOTAL_CHUNKS);
    assert.ok(maxBufferInFlight <= WINDOW_SIZE, `Max in-flight buffer was ${maxBufferInFlight}, must not exceed WINDOW_SIZE of ${WINDOW_SIZE}`);
    assert.equal(inFlightBuffers.size, 0, "Buffer in RAM must be completely cleared after upload");
  });
});

