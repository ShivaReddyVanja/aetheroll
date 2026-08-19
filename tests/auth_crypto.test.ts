import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { encryptSession, decryptSession } from "../src/server/lib/crypto.ts";

describe("🔐 Core Security & Crypto Module", () => {
  it("should successfully encrypt and decrypt a Telegram session string", () => {
    const originalSession = "1BapW5zQBu8y2_example_telegram_session_string_ABC123!@#$%";
    const encrypted = encryptSession(originalSession);

    assert.notEqual(encrypted, originalSession, "Encrypted text must not match plaintext");
    assert.ok(typeof encrypted === "string" && encrypted.length > 32, "Encrypted string must be a base64 payload");

    const decrypted = decryptSession(encrypted);
    assert.equal(decrypted, originalSession, "Decrypted session must match original");
  });

  it("should fail gracefully when decrypting tampered data", () => {
    const originalSession = "valid_session_string";
    const encrypted = encryptSession(originalSession);

    // Tamper with the raw base64 payload bytes
    const buf = Buffer.from(encrypted, "base64");
    buf[buf.length - 1] = buf[buf.length - 1] ^ 0xff; // flip last byte
    const tampered = buf.toString("base64");

    assert.throws(
      () => decryptSession(tampered),
      /Unsupported state or unable to authenticate data|Invalid IV length|decryption failed|unable to authenticate/i,
      "Tampered payload must fail cryptographic authentication"
    );
  });

  it("should handle empty or malformed ciphertext inputs without hanging", () => {
    assert.throws(() => decryptSession(""), /Invalid cipher text length/);
    assert.throws(() => decryptSession("short"), /Invalid cipher text length/);
  });
});
