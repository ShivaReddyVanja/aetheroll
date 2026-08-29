import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractSessionToken,
  extractAllSessionTokens,
  generateCompositeSessionToken,
} from "./auth.ts";

describe("🔍 Unified Abstracted Auth Token Extraction Suite", () => {
  const TEST_SESSION_ID = "3f848b25-06c8-472e-8e6f-e3c3ec12b001";
  const TEST_CLIENT_SECRET = "a1b2c3d4e5f67890123456789abcdef0a1b2c3d4e5f67890123456789abcdef0";
  const COMPOSITE_TOKEN = `${TEST_SESSION_ID}.${TEST_CLIENT_SECRET}`;

  it("1. should extract composite token from 'tg_session' Cookie header", () => {
    const req = new Request("https://example.com/api/media", {
      headers: {
        Cookie: `other_cookie=123; tg_session=${encodeURIComponent(COMPOSITE_TOKEN)}; theme=dark`,
      },
    });

    const parsed = extractSessionToken(req);
    assert.ok(parsed);
    assert.equal(parsed.sessionId, TEST_SESSION_ID);
    assert.equal(parsed.clientSecret, TEST_CLIENT_SECRET);
    assert.equal(parsed.fullToken, COMPOSITE_TOKEN);
  });

  it("2. should extract composite token from 'x-tg-session' header", () => {
    const req = new Request("https://example.com/api/media", {
      headers: {
        "x-tg-session": COMPOSITE_TOKEN,
      },
    });

    const parsed = extractSessionToken(req);
    assert.ok(parsed);
    assert.equal(parsed.sessionId, TEST_SESSION_ID);
    assert.equal(parsed.clientSecret, TEST_CLIENT_SECRET);
  });

  it("3. should extract composite token from 'Authorization: Bearer <token>'", () => {
    const req = new Request("https://example.com/api/media", {
      headers: {
        Authorization: `Bearer ${COMPOSITE_TOKEN}`,
      },
    });

    const parsed = extractSessionToken(req);
    assert.ok(parsed);
    assert.equal(parsed.sessionId, TEST_SESSION_ID);
    assert.equal(parsed.clientSecret, TEST_CLIENT_SECRET);
  });

  it("4. should extract composite token from URL query '?session_token='", () => {
    const req = new Request(`https://example.com/api/stream?media_id=123&session_token=${encodeURIComponent(COMPOSITE_TOKEN)}`);

    const parsed = extractSessionToken(req);
    assert.ok(parsed);
    assert.equal(parsed.sessionId, TEST_SESSION_ID);
    assert.equal(parsed.clientSecret, TEST_CLIENT_SECRET);
  });

  it("5. should return null for missing or default tokens", () => {
    const req1 = new Request("https://example.com/api/media");
    assert.equal(extractSessionToken(req1), null);

    const req2 = new Request("https://example.com/api/stream?session_token=default");
    assert.equal(extractSessionToken(req2), null);
  });

  it("6. should parse legacy single-part token without clientSecret", () => {
    const LEGACY_TOKEN = "deadbeef12345678deadbeef12345678deadbeef12345678deadbeef12345678";
    const req = new Request("https://example.com/api/media", {
      headers: { "x-tg-session": LEGACY_TOKEN },
    });

    const parsed = extractSessionToken(req);
    assert.ok(parsed);
    assert.equal(parsed.sessionId, LEGACY_TOKEN);
    assert.equal(parsed.clientSecret, undefined);
  });

  it("7. should parse composite token passed directly as a string (POST /api/auth/session payload)", () => {
    const parsed = extractSessionToken(COMPOSITE_TOKEN);
    assert.ok(parsed);
    assert.equal(parsed.sessionId, TEST_SESSION_ID);
    assert.equal(parsed.clientSecret, TEST_CLIENT_SECRET);
    assert.equal(parsed.fullToken, COMPOSITE_TOKEN);
  });

  it("8. should extract all candidate tokens when multiple tg_session cookies exist in header", () => {
    const OLD_TOKEN = "old-session-id.old-secret";
    const NEW_TOKEN = "new-session-id.new-secret";
    const req = new Request("https://example.com/api/media", {
      headers: {
        Cookie: `tg_session=${OLD_TOKEN}; aetheroll_session=ae-id.ae-secret; tg_session=${NEW_TOKEN}`,
      },
    });

    const candidates = extractAllSessionTokens(req);
    assert.equal(candidates.length, 3);
    assert.equal(candidates[0].sessionId, "old-session-id");
    assert.equal(candidates[1].sessionId, "ae-id");
    assert.equal(candidates[2].sessionId, "new-session-id");
  });
});

