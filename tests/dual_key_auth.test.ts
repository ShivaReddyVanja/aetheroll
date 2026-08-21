import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { encryptSession, decryptSession } from "../src/server/lib/crypto.ts";
import {
  extractSessionToken,
  generateCompositeSessionToken,
} from "../src/server/lib/auth.ts";

describe("🛡️ Zero-Knowledge Dual-Key Envelope Encryption Suite", () => {
  const SERVER_MASTER_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const TEST_SESSION_STRING = "1BVtsOMQBu8v9_dummy_telegram_string_session_payload_for_testing==";

  it("1. should encrypt and decrypt session with dual-key (ServerKey + ClientSecret)", async () => {
    const { sessionId, clientSecret, sessionToken } = generateCompositeSessionToken();
    assert.ok(sessionId, "sessionId must be generated");
    assert.ok(clientSecret, "clientSecret must be generated");
    assert.equal(sessionToken, `${sessionId}.${clientSecret}`);

    const ciphertext = await encryptSession(TEST_SESSION_STRING, SERVER_MASTER_KEY, clientSecret);
    assert.ok(ciphertext, "Ciphertext should be produced");
    assert.notEqual(ciphertext, TEST_SESSION_STRING, "Ciphertext must not be plaintext");

    const decrypted = await decryptSession(ciphertext, SERVER_MASTER_KEY, clientSecret);
    assert.equal(decrypted, TEST_SESSION_STRING, "Decrypted session must match original plaintext");
  });

  it("2. should FAIL to decrypt if clientSecret is missing (Admin/Database Dump Leak Protection)", async () => {
    const { clientSecret } = generateCompositeSessionToken();
    const ciphertext = await encryptSession(TEST_SESSION_STRING, SERVER_MASTER_KEY, clientSecret);

    // Attacker only has the Server Master Key (from Cloudflare dashboard) and Database Ciphertext
    await assert.rejects(
      async () => {
        await decryptSession(ciphertext, SERVER_MASTER_KEY, undefined);
      },
      /Decryption failed|Unsupported state/i,
      "Decryption MUST fail without user client secret"
    );
  });

  it("3. should FAIL to decrypt if clientSecret is incorrect or tampered", async () => {
    const { clientSecret } = generateCompositeSessionToken();
    const wrongSecret = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
    const ciphertext = await encryptSession(TEST_SESSION_STRING, SERVER_MASTER_KEY, clientSecret);

    await assert.rejects(
      async () => {
        await decryptSession(ciphertext, SERVER_MASTER_KEY, wrongSecret);
      },
      /Decryption failed|Unsupported state/i,
      "Decryption MUST fail with wrong client secret"
    );
  });

  it("4. should seamlessly decrypt legacy single-key sessions for backward compatibility", async () => {
    // Encrypt with legacy method (no client secret)
    const legacyCiphertext = await encryptSession(TEST_SESSION_STRING, SERVER_MASTER_KEY, undefined);
    assert.ok(legacyCiphertext);

    // Decrypt without client secret
    const decryptedLegacy = await decryptSession(legacyCiphertext, SERVER_MASTER_KEY, undefined);
    assert.equal(decryptedLegacy, TEST_SESSION_STRING);

    // Decrypt when client secret is passed by new middleware (graceful fallback)
    const decryptedWithFallback = await decryptSession(legacyCiphertext, SERVER_MASTER_KEY, "some-secret");
    assert.equal(decryptedWithFallback, TEST_SESSION_STRING);
  });
});

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
});
