import { describe, it } from "node:test";
import assert from "node:assert/strict";

function isTelemetryEnabled(env?: any): boolean {
  const flag =
    env?.ENABLE_TELEMETRY ??
    process.env?.ENABLE_TELEMETRY ??
    process.env?.NEXT_PUBLIC_ENABLE_TELEMETRY;
  if (flag === true || flag === 1) return true;
  if (typeof flag === "string") {
    const lower = flag.trim().toLowerCase();
    return lower === "true" || lower === "1" || lower === "yes" || lower === "enabled";
  }
  return false;
}

describe("🔒 Telemetry Variable-Driven Gatekeeper Suite", () => {
  it("1. should return false when ENABLE_TELEMETRY is undefined or not set", () => {
    assert.equal(isTelemetryEnabled({}), false);
    assert.equal(isTelemetryEnabled(undefined), false);
  });

  it("2. should return false when ENABLE_TELEMETRY is explicitly 'false' or 0", () => {
    assert.equal(isTelemetryEnabled({ ENABLE_TELEMETRY: "false" }), false);
    assert.equal(isTelemetryEnabled({ ENABLE_TELEMETRY: "0" }), false);
    assert.equal(isTelemetryEnabled({ ENABLE_TELEMETRY: "no" }), false);
    assert.equal(isTelemetryEnabled({ ENABLE_TELEMETRY: "disabled" }), false);
  });

  it("3. should return true when ENABLE_TELEMETRY is 'true', '1', or 'enabled'", () => {
    assert.equal(isTelemetryEnabled({ ENABLE_TELEMETRY: "true" }), true);
    assert.equal(isTelemetryEnabled({ ENABLE_TELEMETRY: "1" }), true);
    assert.equal(isTelemetryEnabled({ ENABLE_TELEMETRY: "yes" }), true);
    assert.equal(isTelemetryEnabled({ ENABLE_TELEMETRY: "enabled" }), true);
    assert.equal(isTelemetryEnabled({ ENABLE_TELEMETRY: true }), true);
  });

  it("4. should safely prioritize context env over process.env", () => {
    const originalEnv = process.env.ENABLE_TELEMETRY;
    try {
      process.env.ENABLE_TELEMETRY = "true";
      assert.equal(isTelemetryEnabled({ ENABLE_TELEMETRY: "false" }), false);
    } finally {
      process.env.ENABLE_TELEMETRY = originalEnv;
    }
  });
});
