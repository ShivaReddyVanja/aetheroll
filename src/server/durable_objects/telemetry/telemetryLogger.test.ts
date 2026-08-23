import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TelemetryLogger } from "./telemetryLogger.ts";

describe("⚡ DO TelemetryLogger Suite", () => {
  it("1. isTelemetryActive should respect env flags in various formats", () => {
    const logger = new TelemetryLogger(null, {});

    assert.equal(logger.isTelemetryActive({ ENABLE_TELEMETRY: "true" }), true);
    assert.equal(logger.isTelemetryActive({ ENABLE_TELEMETRY: "1" }), true);
    assert.equal(logger.isTelemetryActive({ ENABLE_TELEMETRY: "yes" }), true);
    assert.equal(logger.isTelemetryActive({ ENABLE_TELEMETRY: true }), true);

    assert.equal(logger.isTelemetryActive({ ENABLE_TELEMETRY: "false" }), false);
    assert.equal(logger.isTelemetryActive({ ENABLE_TELEMETRY: "0" }), false);
    assert.equal(logger.isTelemetryActive({ ENABLE_TELEMETRY: undefined }), false);
  });

  it("2. logEvent should not store anything when telemetry is disabled", () => {
    const logger = new TelemetryLogger(null, { ENABLE_TELEMETRY: "false" });
    logger.logEvent("STREAM", "info", "test message", null, false);
    assert.equal(logger.recentLogs.length, 0);
  });

  it("3. logEvent should buffer logs up to 250 items with FIFO eviction", () => {
    const logger = new TelemetryLogger(null, { ENABLE_TELEMETRY: "true" });

    for (let i = 0; i < 300; i++) {
      logger.logEvent("RAM", "info", `Event ${i}`, null, false);
    }

    assert.equal(logger.recentLogs.length, 250);
    assert.equal(logger.recentLogs[0].message, "Event 50");
    assert.equal(logger.recentLogs[249].message, "Event 299");
  });

  it("4. handleStreamLogs should return 404 when disabled and SSE stream when enabled", async () => {
    const logger = new TelemetryLogger(null, { ENABLE_TELEMETRY: "false" });
    const req = new Request("https://example.com/logs/stream");

    const disabledRes = logger.handleStreamLogs(req, { ENABLE_TELEMETRY: "false" });
    assert.equal(disabledRes.status, 404);

    const enabledRes = logger.handleStreamLogs(req, { ENABLE_TELEMETRY: "true" });
    assert.equal(enabledRes.status, 200);
    assert.equal(enabledRes.headers.get("Content-Type"), "text/event-stream");
    assert.equal(enabledRes.headers.get("Cache-Control"), "no-cache");
  });

  it("5. handleIngestLog should record valid incoming POST log events", async () => {
    const logger = new TelemetryLogger(null, { ENABLE_TELEMETRY: "true" });
    const req = new Request("https://example.com/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category: "EDGE_CACHE",
        level: "success",
        message: "External edge hit",
      }),
    });

    const res = await logger.handleIngestLog(req, { ENABLE_TELEMETRY: "true" });
    assert.equal(res.status, 200);
    assert.equal(logger.recentLogs.length, 1);
    assert.equal(logger.recentLogs[0].category, "EDGE_CACHE");
    assert.equal(logger.recentLogs[0].message, "External edge hit");
  });
});
