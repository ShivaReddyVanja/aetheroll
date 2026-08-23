import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TelegramAuthDO } from "./TelegramAuthDO.ts";

describe("⚡ DO Main Router & Backward Compatibility Suite", () => {
  it("1. should initialize all sub-managers and expose backward compatible getters", () => {
    const doInstance = new TelegramAuthDO(null, { ENABLE_TELEMETRY: "true" });

    assert.ok(doInstance.ratePacer);
    assert.ok(doInstance.activeSessions instanceof Map);
    assert.ok(doInstance.userClients instanceof Map);
    assert.ok(doInstance.uploadSessions instanceof Map);
    assert.ok(doInstance.mediaLocationCache instanceof Map);
    assert.ok(doInstance.segmentRingCache instanceof Map);
    assert.ok(doInstance.prefetchedChunks instanceof Map);
    assert.ok(Array.isArray(doInstance.recentLogs));
    assert.ok(doInstance.logStreamControllers instanceof Set);
  });

  it("2. /cache/clear endpoint should clear in-memory caches and return 200", async () => {
    const doInstance = new TelegramAuthDO(null, {});

    doInstance.segmentFetcher.segmentRingCache.set("seg1", { buffer: Buffer.alloc(10), expires: 1000, lastUsed: 1000 });
    doInstance.mediaLocationResolver.mediaLocationCache.set("item1", { fileLocation: {}, expires: 1000 });

    const req = new Request("https://example.com/cache/clear");
    const res = await doInstance.fetch(req);

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);

    assert.equal(doInstance.segmentRingCache.size, 0);
    assert.equal(doInstance.mediaLocationCache.size, 0);
  });

  it("3. should return 404 for unknown endpoints", async () => {
    const doInstance = new TelegramAuthDO(null, {});
    const req = new Request("https://example.com/unknown/endpoint");
    const res = await doInstance.fetch(req);

    assert.equal(res.status, 404);
    const text = await res.text();
    assert.match(text, /Not found in Auth DO/i);
  });

  it("4. should support proxy methods isTelemetryActive and logEvent", () => {
    const doInstance = new TelegramAuthDO(null, { ENABLE_TELEMETRY: "true" });
    assert.equal(doInstance.isTelemetryActive(), true);

    doInstance.logEvent("RAM", "info", "test event", null, false);
    assert.equal(doInstance.recentLogs.length, 1);
    assert.equal(doInstance.recentLogs[0].message, "test event");
  });
});
