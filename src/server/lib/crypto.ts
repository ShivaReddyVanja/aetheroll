/**
 * Universal Web Crypto AES-256-GCM module with Dual-Key HKDF-SHA256 Zero-Knowledge Envelope Encryption.
 * 100% compatible with Cloudflare Workers, Node.js (v16+), and Edge runtimes.
 */

const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const HKDF_INFO = "tg-gallery-dual-key-v1";

/**
 * Derives a 256-bit AES-GCM CryptoKey.
 * When clientSecret is provided, uses HKDF-SHA256(IKM=clientSecret, Salt=serverKey, Info="tg-gallery-dual-key-v1").
 * When clientSecret is omitted, falls back to SHA-256(serverKey) for legacy single-key compatibility.
 */
export async function getCryptoKey(serverKey?: string, clientSecret?: string): Promise<CryptoKey> {
  const secret = serverKey || process.env.SESSION_ENCRYPTION_KEY;
  if (!secret || secret.trim() === "") {
    throw new Error(
      "Missing required environment variable: SESSION_ENCRYPTION_KEY. Please set this secret via 'wrangler secret put SESSION_ENCRYPTION_KEY'."
    );
  }

  const encoder = new TextEncoder();
  const subtle = globalThis.crypto?.subtle || (await import("crypto")).webcrypto?.subtle;
  if (!subtle) {
    throw new Error("Web Crypto API (crypto.subtle) is not available in this runtime.");
  }

  if (clientSecret && clientSecret.trim() !== "") {
    try {
      const baseKey = await subtle.importKey(
        "raw",
        encoder.encode(clientSecret.trim()),
        "HKDF",
        false,
        ["deriveKey"]
      );

      return await subtle.deriveKey(
        {
          name: "HKDF",
          hash: "SHA-256",
          salt: encoder.encode(secret.trim()),
          info: encoder.encode(HKDF_INFO),
        },
        baseKey,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
      );
    } catch {
      // Fallback if HKDF import is unsupported: SHA-256(serverKey + ":" + clientSecret)
      const combinedBytes = encoder.encode(`${secret.trim()}:${clientSecret.trim()}`);
      const digest = await subtle.digest("SHA-256", combinedBytes);
      return subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
    }
  }

  // Legacy single-key fallback: SHA-256(serverKey)
  const keyBuffer = await subtle.digest("SHA-256", encoder.encode(secret));
  return subtle.importKey("raw", keyBuffer, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/**
 * Encrypts a plaintext string (e.g. Telegram StringSession) using Dual-Key AES-256-GCM
 */
export async function encryptSession(
  plainText: string,
  secretKey?: string,
  clientSecret?: string
): Promise<string> {
  const subtle = globalThis.crypto?.subtle || (await import("crypto")).webcrypto?.subtle;
  const cryptoKey = await getCryptoKey(secretKey, clientSecret);

  const iv = new Uint8Array(IV_LENGTH);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(iv);
  } else {
    const { randomFillSync } = await import("crypto");
    randomFillSync(iv);
  }

  const encoder = new TextEncoder();
  const encryptedBuffer = await subtle.encrypt(
    { name: "AES-GCM", iv, tagLength: TAG_LENGTH * 8 },
    cryptoKey,
    encoder.encode(plainText)
  );

  // Pack: IV (12 bytes) + Encrypted Data (Web Crypto appends 16-byte auth tag at end)
  const combined = new Uint8Array(IV_LENGTH + encryptedBuffer.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encryptedBuffer), IV_LENGTH);

  return Buffer.from(combined).toString("base64");
}

/**
 * Decrypts an AES-256-GCM encrypted base64 payload using Dual-Key derivation (with legacy fallback)
 */
export async function decryptSession(
  cipherTextBase64: string,
  secretKey?: string,
  clientSecret?: string
): Promise<string> {
  if (!cipherTextBase64 || cipherTextBase64.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error("Invalid cipher text length");
  }

  const candidateKeys = [
    secretKey,
    process.env.SESSION_ENCRYPTION_KEY,
  ].filter((k, idx, self): k is string => typeof k === "string" && k.trim() !== "" && self.indexOf(k) === idx);

  if (candidateKeys.length === 0) {
    throw new Error(
      "Missing required environment variable: SESSION_ENCRYPTION_KEY. Please configure SESSION_ENCRYPTION_KEY secret in environment."
    );
  }

  const combined = Buffer.from(cipherTextBase64, "base64");
  if (combined.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error("Invalid cipher text length");
  }

  const subtle = globalThis.crypto?.subtle || (await import("crypto")).webcrypto?.subtle;
  const iv = combined.subarray(0, IV_LENGTH);
  const data = combined.subarray(IV_LENGTH);

  for (const keyCandidate of candidateKeys) {
    // 1. Dual-key HKDF decryption
    if (clientSecret) {
      try {
        const cryptoKey = await getCryptoKey(keyCandidate, clientSecret);
        const decryptedBuffer = await subtle.decrypt(
          { name: "AES-GCM", iv, tagLength: TAG_LENGTH * 8 },
          cryptoKey,
          data
        );
        return new TextDecoder().decode(decryptedBuffer);
      } catch {}

      // Legacy order dual-key
      try {
        const cryptoKey = await getCryptoKey(keyCandidate, clientSecret);
        const tag = combined.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
        const ciphertext = combined.subarray(IV_LENGTH + TAG_LENGTH);
        const reordered = Buffer.concat([ciphertext, tag]);
        const decryptedBuffer = await subtle.decrypt(
          { name: "AES-GCM", iv, tagLength: TAG_LENGTH * 8 },
          cryptoKey,
          reordered
        );
        return new TextDecoder().decode(decryptedBuffer);
      } catch {}
    }

    // 2. Single-key SHA-256 fallback
    try {
      const cryptoKey = await getCryptoKey(keyCandidate, undefined);
      const decryptedBuffer = await subtle.decrypt(
        { name: "AES-GCM", iv, tagLength: TAG_LENGTH * 8 },
        cryptoKey,
        data
      );
      return new TextDecoder().decode(decryptedBuffer);
    } catch {}

    // Legacy order single-key
    try {
      const cryptoKey = await getCryptoKey(keyCandidate, undefined);
      const tag = combined.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
      const ciphertext = combined.subarray(IV_LENGTH + TAG_LENGTH);
      const reordered = Buffer.concat([ciphertext, tag]);
      const decryptedBuffer = await subtle.decrypt(
        { name: "AES-GCM", iv, tagLength: TAG_LENGTH * 8 },
        cryptoKey,
        reordered
      );
      return new TextDecoder().decode(decryptedBuffer);
    } catch {}
  }

  throw new Error("Session decryption failed: Invalid encryption key or session expired. Please log in again.");
}

/**
 * Generates an 8-character cryptographic signature tag for Aetheroll uploads.
 * e.g. "[AET:v1:7f8a9b2c]"
 */
export async function generateAetherollSignature(
  fileSizeBytes: number,
  capturedAtSeconds: number,
  serverSecret?: string
): Promise<string> {
  const secret = serverSecret || process.env.SESSION_ENCRYPTION_KEY || "aetheroll-vault-master-secret";
  const encoder = new TextEncoder();
  const subtle = globalThis.crypto?.subtle || (await import("crypto")).webcrypto?.subtle;
  const payload = `${fileSizeBytes}:${Math.floor(capturedAtSeconds)}:${secret}`;

  if (subtle) {
    const digest = await subtle.digest("SHA-256", encoder.encode(payload));
    const hex = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 8);
    return `[AET:v1:${hex}]`;
  }

  const nodeCrypto = await import("crypto");
  const hex = nodeCrypto.createHash("sha256").update(payload).digest("hex").slice(0, 8);
  return `[AET:v1:${hex}]`;
}

/**
 * Validates whether a Telegram message was uploaded through Aetheroll.
 */
export async function verifyAetherollSignature(
  messageText: string | undefined | null,
  fileSizeBytes: number,
  dateSeconds: number,
  serverSecret?: string
): Promise<boolean> {
  if (!messageText) return false;

  // 1. Direct Aetheroll Cryptographic Signature Match
  const match = messageText.match(/\[AET:v1:([a-f0-9]{8})\]/i);
  if (match) {
    const expectedSig = await generateAetherollSignature(fileSizeBytes, dateSeconds, serverSecret);
    const expectedHex = expectedSig.replace("[AET:v1:", "").replace("]", "");
    if (match[1].toLowerCase() === expectedHex.toLowerCase()) {
      return true;
    }
    return false;
  }

  // 2. Event Ledger WAL Tag Match (Legacy and Threaded events)
  if (messageText.includes("[GP_EVENT:v1]") || messageText.includes("[GP_BATCH:v1]") || messageText.includes("#aetheroll")) {
    return true;
  }

  return false;
}

