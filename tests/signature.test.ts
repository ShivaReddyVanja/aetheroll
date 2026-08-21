import test from "node:test";
import assert from "node:assert/strict";
import { generateAetherollSignature, verifyAetherollSignature } from "../src/server/lib/crypto.ts";

test("Aetheroll Cryptographic Signature & Sync Guard Tests", async (t) => {
  const secretKey = "test-secret-key-12345678901234567890123456789012";
  const fileSize = 15420980;
  const timestamp = 1718901234;

  await t.test("generates valid 8-character hex HMAC tag", async () => {
    const tag = await generateAetherollSignature(fileSize, timestamp, secretKey);
    assert.match(tag, /^\[AET:v1:[a-f0-9]{8}\]$/);
  });

  await t.test("verifies valid signature correctly", async () => {
    const tag = await generateAetherollSignature(fileSize, timestamp, secretKey);
    const messageText = `My vacation video!\n${tag}`;
    const isValid = await verifyAetherollSignature(messageText, fileSize, timestamp, secretKey);
    assert.strictEqual(isValid, true);
  });

  await t.test("rejects random chat messages without signature", async () => {
    const messageText = "Hey bro check out this funny meme video";
    const isValid = await verifyAetherollSignature(messageText, fileSize, timestamp, secretKey);
    assert.strictEqual(isValid, false);
  });

  await t.test("rejects spoofed / forged signature with wrong hash", async () => {
    const messageText = "Fake video [AET:v1:deadbeef]";
    const isValid = await verifyAetherollSignature(messageText, fileSize, timestamp, secretKey);
    assert.strictEqual(isValid, false);
  });

  await t.test("rejects signature if file size or timestamp is tampered with", async () => {
    const tag = await generateAetherollSignature(fileSize, timestamp, secretKey);
    const messageText = `Tampered video ${tag}`;
    const isValidDifferentSize = await verifyAetherollSignature(messageText, fileSize + 100, timestamp, secretKey);
    assert.strictEqual(isValidDifferentSize, false);
  });

  await t.test("accepts legacy WAL event ledger records", async () => {
    const walMessage = '[GP_EVENT:v1]\n{"_t":"GP_EVENT","v":1,"ref":100,"op":"CREATE"}';
    const isValid = await verifyAetherollSignature(walMessage, fileSize, timestamp, secretKey);
    assert.strictEqual(isValid, true);
  });
});
