import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DynamicUploadDispatcher,
  RollingSpeedAggregator,
  formatUploadSpeed,
  formatUploadDuration,
  getAdaptiveConcurrency,
  MAX_CONCURRENT_MICRO_FILES,
  MAX_CONCURRENT_SMALL_FILES,
  MAX_CONCURRENT_MEDIUM_FILES,
  MAX_CONCURRENT_LARGE_FILES,
  MICRO_FILE_THRESHOLD,
  SMALL_FILE_THRESHOLD,
  LARGE_FILE_THRESHOLD,
} from "../src/lib/uploadPool.ts";

describe("⚡ Dynamic Adaptive Multi-File Upload Pipeline & Tiered Scaling", () => {
  it("1. should correctly determine adaptive concurrency tiers based on file size", () => {
    // Micro files (<= 500 KB) -> 8 workers
    assert.equal(getAdaptiveConcurrency(100 * 1024), MAX_CONCURRENT_MICRO_FILES);
    assert.equal(getAdaptiveConcurrency(MICRO_FILE_THRESHOLD), MAX_CONCURRENT_MICRO_FILES);
    assert.equal(MAX_CONCURRENT_MICRO_FILES, 8);

    // Small files (500 KB - 3 MB) -> 5 workers
    assert.equal(getAdaptiveConcurrency(500 * 1024 + 1), MAX_CONCURRENT_SMALL_FILES);
    assert.equal(getAdaptiveConcurrency(2 * 1024 * 1024), MAX_CONCURRENT_SMALL_FILES);
    assert.equal(getAdaptiveConcurrency(SMALL_FILE_THRESHOLD), MAX_CONCURRENT_SMALL_FILES);
    assert.equal(MAX_CONCURRENT_SMALL_FILES, 5);

    // Medium files (3 MB - 15 MB) -> 3 workers
    assert.equal(getAdaptiveConcurrency(3 * 1024 * 1024 + 1), MAX_CONCURRENT_MEDIUM_FILES);
    assert.equal(getAdaptiveConcurrency(10 * 1024 * 1024), MAX_CONCURRENT_MEDIUM_FILES);
    assert.equal(getAdaptiveConcurrency(LARGE_FILE_THRESHOLD), MAX_CONCURRENT_MEDIUM_FILES);
    assert.equal(MAX_CONCURRENT_MEDIUM_FILES, 3);

    // Large files (> 15 MB) -> 1 worker dedicated
    assert.equal(getAdaptiveConcurrency(15 * 1024 * 1024 + 1), MAX_CONCURRENT_LARGE_FILES);
    assert.equal(getAdaptiveConcurrency(88 * 1024 * 1024), MAX_CONCURRENT_LARGE_FILES);
    assert.equal(MAX_CONCURRENT_LARGE_FILES, 1);
  });

  it("2. should scale up to 8 concurrent workers for micro files (<= 500 KB)", async () => {
    const items = Array.from({ length: 24 }, (_, i) => ({
      id: `micro-${i + 1}`,
      name: `icon_${i + 1}.png`,
      size: 100 * 1024, // 100 KB
    }));

    let currentActive = 0;
    let maxObservedActive = 0;
    const completedIds: string[] = [];

    const dispatcher = new DynamicUploadDispatcher({
      items,
      executor: async (item, signal) => {
        currentActive++;
        maxObservedActive = Math.max(maxObservedActive, currentActive);

        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 25);
          signal.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new Error("Aborted"));
          });
        });

        currentActive--;
        completedIds.push(item.id);
        return { success: true, id: item.id };
      },
    });

    const results = await dispatcher.start();

    assert.equal(results.length, 24);
    assert.equal(completedIds.length, 24);
    assert.equal(maxObservedActive, 8, "Observed concurrency must scale up to 8 for micro files");
    assert.equal(currentActive, 0);
  });

  it("3. should dynamically throttle concurrency when transitioning between micro, medium, and large files", async () => {
    // 8 micro (100KB) -> 3 medium (5MB) -> 1 large (20MB) -> 8 micro (100KB)
    const items = [
      ...Array.from({ length: 8 }, (_, i) => ({ id: `micro1-${i}`, size: 100 * 1024 })),
      ...Array.from({ length: 3 }, (_, i) => ({ id: `med-${i}`, size: 5 * 1024 * 1024 })),
      { id: "large-1", size: 20 * 1024 * 1024 },
      ...Array.from({ length: 8 }, (_, i) => ({ id: `micro2-${i}`, size: 100 * 1024 })),
    ];

    let currentActive = 0;
    let maxMicroConcurrency = 0;
    let activeDuringLarge = 0;
    const executionLog: string[] = [];

    const dispatcher = new DynamicUploadDispatcher({
      items,
      executor: async (item) => {
        currentActive++;
        if (item.size <= MICRO_FILE_THRESHOLD) {
          maxMicroConcurrency = Math.max(maxMicroConcurrency, currentActive);
        }
        if (item.size > LARGE_FILE_THRESHOLD) {
          activeDuringLarge = currentActive;
        }

        executionLog.push(`start:${item.id}`);
        const delay = item.size > LARGE_FILE_THRESHOLD ? 30 : 15;
        await new Promise((r) => setTimeout(r, delay));

        executionLog.push(`end:${item.id}`);
        currentActive--;
        return { id: item.id };
      },
    });

    await dispatcher.start();

    assert.equal(maxMicroConcurrency, 8, "Micro files should reach 8 concurrent slots");
    assert.equal(activeDuringLarge, 1, "Large file must execute with strictly 1 worker after draining");
    assert.equal(currentActive, 0);
  });

  it("4. should cancel a single in-flight task cleanly and fill the freed slot immediately", async () => {
    const items = Array.from({ length: 12 }, (_, i) => ({
      id: `task-${i + 1}`,
      name: `file${i + 1}.jpg`,
      size: 100 * 1024,
    }));

    const aborted: string[] = [];
    const completed: string[] = [];

    const dispatcher = new DynamicUploadDispatcher({
      items,
      executor: async (item, signal) => {
        if (item.id === "task-3") {
          setTimeout(() => {
            dispatcher.abortTask("task-3");
          }, 5);
        }

        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 30);
          signal.addEventListener("abort", () => {
            clearTimeout(timer);
            aborted.push(item.id);
            reject(new Error("Task cancelled"));
          });
        });

        completed.push(item.id);
        return { id: item.id };
      },
    });

    const results = await dispatcher.start();

    assert.deepEqual(aborted, ["task-3"]);
    assert.equal(completed.length, 11);
    assert.equal(results.find((r) => r.id === "task-3")?.status, "error");
    assert.equal(results.find((r) => r.id === "task-12")?.status, "done");
  });

  it("5. should cleanly abort all in-flight and pending tasks on abortAll()", async () => {
    const items = Array.from({ length: 16 }, (_, i) => ({
      id: `task-${i}`,
      name: `file${i}.jpg`,
      size: 100 * 1024,
    }));

    let startedCount = 0;
    const dispatcher = new DynamicUploadDispatcher({
      items,
      executor: async (_item, signal) => {
        startedCount++;
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 50);
          signal.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new Error("Aborted all"));
          });
        });
        return { success: true };
      },
    });

    const promise = dispatcher.start();

    setTimeout(() => {
      dispatcher.abortAll();
    }, 10);

    const results = await promise;

    // Up to 8 micro workers started initially before abortAll fired
    assert.ok(startedCount <= 8);
    assert.equal(results.length, 16);
    assert.ok(results.every((r) => r.status === "error" || r.status === "pending" || r.status === "cancelled"));
  });

  it("6. should isolate errors without breaking the rest of the scaling queue", async () => {
    const items = [
      { id: "1", size: 1024 },
      { id: "2", size: 1024 },
      { id: "3", size: 1024 },
      { id: "4", size: 1024 },
    ];

    const errorCalls: string[] = [];

    const dispatcher = new DynamicUploadDispatcher({
      items,
      executor: async (item) => {
        await new Promise((r) => setTimeout(r, 15));
        if (item.id === "2") {
          throw new Error("Simulated network failure");
        }
        return { success: true };
      },
      onTaskError: (item, err) => {
        errorCalls.push(`${item.id}:${err.message}`);
      },
    });

    const results = await dispatcher.start();

    assert.equal(results.length, 4);
    assert.equal(results[0].status, "done");
    assert.equal(results[1].status, "error");
    assert.equal(results[2].status, "done");
    assert.equal(results[3].status, "done");
    assert.equal(errorCalls.length, 1);
  });

  it("7. should aggregate rolling speeds across up to 8 concurrent workers accurately", async () => {
    const aggregator = new RollingSpeedAggregator();

    // 8 workers upload 250 KB each at t=0 (total 2 MB)
    for (let i = 1; i <= 8; i++) {
      aggregator.recordProgress(`worker-${i}`, 250 * 1024);
    }

    // After 500ms, each worker uploaded another 250 KB (total 500 KB each = 4 MB total)
    const mockNow = Date.now() + 500;
    for (let i = 1; i <= 8; i++) {
      aggregator.recordProgress(`worker-${i}`, 500 * 1024, mockNow);
    }

    const speed = aggregator.getCurrentSpeedBytesPerSec(mockNow);
    // In 500ms, total delta was 2 MB = 4.0 MB/sec
    assert.ok(speed > 3.6 * 1024 * 1024 && speed < 4.4 * 1024 * 1024, `Calculated speed ${speed} should be ~4MB/s`);

    const formatted = formatUploadSpeed(speed);
    assert.match(formatted, /MB\/s/);
  });

  it("8. should format speeds and durations correctly", () => {
    assert.equal(formatUploadSpeed(0), "0 KB/s");
    assert.equal(formatUploadSpeed(500 * 1024), "500.0 KB/s");
    assert.equal(formatUploadSpeed(2.5 * 1024 * 1024), "2.5 MB/s");

    assert.equal(formatUploadDuration(5000), "5s");
    assert.equal(formatUploadDuration(65000), "1m 5s");
  });
});
