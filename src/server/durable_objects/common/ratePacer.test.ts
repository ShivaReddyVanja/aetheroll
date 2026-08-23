import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SlidingWindowRatePacer, toBigInt, MAX_TELEGRAM_FILE_SIZE } from "./ratePacer.ts";

describe("⚡ DO Rate Pacer & Math Suite", () => {
  it("1. toBigInt should correctly handle hex strings, decimal strings, and numbers", () => {
    assert.equal(toBigInt("0x10").toString(), "16");
    assert.equal(toBigInt("100").toString(), "100");
    assert.equal(toBigInt(500000).toString(), "500000");
    assert.equal(toBigInt("1010", 2).toString(), "10");
  });

  it("2. MAX_TELEGRAM_FILE_SIZE constant should match 2GB Telegram limit", () => {
    assert.equal(MAX_TELEGRAM_FILE_SIZE, 2000 * 1024 * 1024);
  });

  it("3. SlidingWindowRatePacer should acquire slots immediately under capacity", async () => {
    const pacer = new SlidingWindowRatePacer(10, 500);
    const t0 = Date.now();
    for (let i = 0; i < 5; i++) {
      await pacer.acquire();
    }
    const elapsed = Date.now() - t0;
    assert.ok(elapsed < 100, `Expected fast acquisition, took ${elapsed}ms`);
  });

  it("4. SlidingWindowRatePacer should pace requests when limit is exceeded", async () => {
    const maxReqs = 5;
    const windowMs = 200;
    const pacer = new SlidingWindowRatePacer(maxReqs, windowMs);
    const timestamps: number[] = [];

    for (let i = 0; i < 10; i++) {
      await pacer.acquire();
      timestamps.push(Date.now());
    }

    assert.equal(timestamps.length, 10);
    // The 6th request must have waited for the 1st request to expire
    assert.ok(timestamps[5] - timestamps[0] >= windowMs);
  });
});
