import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sanitizeLogMessage } from "./logSanitizer";

describe("🛡️ Log Sanitization Suite", () => {
  it("should redact session_token in query string", () => {
    const input = "--> GET /api/media/123/thumbnail?session_token=a565b36f-886b-4a90-8a18-f0192c53b4b9.1e59ab10d06066398131e2ea19b6f4ab463c3706ea8b938ef2b6546d35f3670b 200 17ms";
    const expected = "--> GET /api/media/123/thumbnail?session_token=[REDACTED] 200 17ms";
    assert.equal(sanitizeLogMessage(input), expected);
  });

  it("should redact multiple query parameters including token and secret", () => {
    const input = "--> GET /api/stream?media_id=456&session_token=secret123&token=abc&custom=ok";
    const expected = "--> GET /api/stream?media_id=456&session_token=[REDACTED]&token=[REDACTED]&custom=ok";
    assert.equal(sanitizeLogMessage(input), expected);
  });

  it("should preserve harmless URLs without sensitive query params", () => {
    const input = "--> GET /api/media/123/thumbnail 200 12ms";
    assert.equal(sanitizeLogMessage(input), input);
  });
});
