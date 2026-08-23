import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateAetherollSignature, verifyAetherollSignature } from "./crypto.ts";

describe("Aetheroll Cryptographic Signature & Sync Guard Tests", () => {
  const secretKey = "test-secret-key-1234567890-test-secret-key";
  const fileSize = 15485760; // ~14.7 MB
  const timestamp = 1718900000;

  it("generates valid 8-character hex HMAC tag", async () => {
    const signature = await generateAetherollSignature(fileSize, timestamp, secretKey);
    assert.match(signature, /^\[AET:v1:[0-9a-f]{8}\]$/);
  });

  it("verifies valid signature correctly", async () => {
    const signature = await generateAetherollSignature(fileSize, timestamp, secretKey);
    const isValid = await verifyAetherollSignature(signature, fileSize, timestamp, secretKey);
    assert.strictEqual(isValid, true);
  });

  it("rejects random chat messages without signature", async () => {
    const isValid = await verifyAetherollSignature("Hey check out this cool photo!", fileSize, timestamp, secretKey);
    assert.strictEqual(isValid, false);
  });

  it("rejects spoofed / forged signature with wrong hash", async () => {
    const forged = `[AET:v1:deadbeef]`;
    const isValid = await verifyAetherollSignature(forged, fileSize, timestamp, secretKey);
    assert.strictEqual(isValid, false);
  });

  it("rejects signature if file size or timestamp is tampered with", async () => {
    const signature = await generateAetherollSignature(fileSize, timestamp, secretKey);
    const tamperedSize = await verifyAetherollSignature(signature, fileSize + 100, timestamp, secretKey);
    const tamperedTime = await verifyAetherollSignature(signature, fileSize, timestamp + 100, secretKey);
    assert.strictEqual(tamperedSize, false);
    assert.strictEqual(tamperedTime, false);
  });

  it("accepts legacy WAL event ledger records", async () => {
    const walMessage = '[GP_EVENT:v1]\n{"_t":"GP_EVENT","v":1,"ref":42,"op":"CREATE"}';
    const isValid = await verifyAetherollSignature(walMessage, 0, 0, secretKey);
    assert.strictEqual(isValid, true);

    const hashtagMessage = 'Photo from holiday #aetheroll';
    const isHashtagValid = await verifyAetherollSignature(hashtagMessage, 0, 0, secretKey);
    assert.strictEqual(isHashtagValid, true);
  });
});
