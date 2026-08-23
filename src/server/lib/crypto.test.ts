import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { encryptSession, decryptSession } from "./crypto.ts";

describe("🛡️ Zero-Knowledge Dual-Key Envelope Encryption Suite", () => {
  const SERVER_MASTER_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const TEST_SESSION_STRING = "1BVtsOMQBu8v9_dummy_telegram_string_session_payload_for_testing==";

  it("1. should encrypt and decrypt session with dual-key (ServerKey + ClientSecret)", async () => {
    const clientSecret = "client_secret_token_12345";

    const ciphertext = await encryptSession(TEST_SESSION_STRING, SERVER_MASTER_KEY, clientSecret);
    assert.ok(ciphertext, "Ciphertext should be produced");
    assert.notEqual(ciphertext, TEST_SESSION_STRING, "Ciphertext must not be plaintext");

    const decrypted = await decryptSession(ciphertext, SERVER_MASTER_KEY, clientSecret);
    assert.equal(decrypted, TEST_SESSION_STRING, "Decrypted session must match original plaintext");
  });

  it("2. should FAIL to decrypt if clientSecret is missing (Admin/Database Dump Leak Protection)", async () => {
    const clientSecret = "client_secret_token_12345";
    const ciphertext = await encryptSession(TEST_SESSION_STRING, SERVER_MASTER_KEY, clientSecret);

    await assert.rejects(
      async () => {
        await decryptSession(ciphertext, SERVER_MASTER_KEY, undefined);
      },
      /Decryption failed|Unsupported state/i,
      "Decryption MUST fail without user client secret"
    );
  });

  it("3. should FAIL to decrypt if clientSecret is incorrect or tampered", async () => {
    const clientSecret = "client_secret_token_12345";
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
    const legacyCiphertext = await encryptSession(TEST_SESSION_STRING, SERVER_MASTER_KEY, undefined);
    assert.ok(legacyCiphertext);

    const decryptedLegacy = await decryptSession(legacyCiphertext, SERVER_MASTER_KEY, undefined);
    assert.equal(decryptedLegacy, TEST_SESSION_STRING);

    const decryptedWithFallback = await decryptSession(legacyCiphertext, SERVER_MASTER_KEY, "some-secret");
    assert.equal(decryptedWithFallback, TEST_SESSION_STRING);
  });
});
