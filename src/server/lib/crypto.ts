/**
 * Universal Web Crypto AES-256-GCM module
 * 100% compatible with Cloudflare Workers, Node.js (v16+), and Edge runtimes.
 * Zero dependency on Node.js legacy C++ crypto.createCipheriv bindings.
 */

const IV_LENGTH = 12;
const TAG_LENGTH = 16;

/**
 * Derives a CryptoKey for AES-GCM from the environment secret
 */
export async function getCryptoKey(secretKey?: string): Promise<CryptoKey> {
  const secret = secretKey || process.env.SESSION_ENCRYPTION_KEY;
  if (!secret || secret.trim() === "") {
    throw new Error("Missing required environment variable: SESSION_ENCRYPTION_KEY. Please set this secret via 'wrangler secret put SESSION_ENCRYPTION_KEY'.");
  }

  const encoder = new TextEncoder();
  const subtle = globalThis.crypto?.subtle || (await import("crypto")).webcrypto?.subtle;
  if (!subtle) {
    throw new Error("Web Crypto API (crypto.subtle) is not available in this runtime.");
  }

  const keyBuffer = await subtle.digest("SHA-256", encoder.encode(secret));
  return subtle.importKey("raw", keyBuffer, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/**
 * Encrypts a plaintext string (e.g. Telegram StringSession) using Web Crypto AES-256-GCM
 */
export async function encryptSession(plainText: string, secretKey?: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle || (await import("crypto")).webcrypto?.subtle;
  const cryptoKey = await getCryptoKey(secretKey);

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
 * Decrypts an AES-256-GCM encrypted base64 payload
 */
export async function decryptSession(cipherTextBase64: string, secretKey?: string): Promise<string> {
  if (!cipherTextBase64 || cipherTextBase64.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error("Invalid cipher text length");
  }

  const combined = Buffer.from(cipherTextBase64, "base64");
  if (combined.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error("Invalid cipher text length");
  }

  const subtle = globalThis.crypto?.subtle || (await import("crypto")).webcrypto?.subtle;
  const cryptoKey = await getCryptoKey(secretKey);

  const iv = combined.subarray(0, IV_LENGTH);
  const data = combined.subarray(IV_LENGTH);

  try {
    // 1. Try standard Web Crypto format: [12 IV] + [encrypted data + 16 Tag at end]
    const decryptedBuffer = await subtle.decrypt(
      { name: "AES-GCM", iv, tagLength: TAG_LENGTH * 8 },
      cryptoKey,
      data
    );
    return new TextDecoder().decode(decryptedBuffer);
  } catch (primaryErr) {
    // 2. Backward compatibility fallback: [12 IV] + [16 Tag at start] + [encrypted data]
    try {
      const tag = combined.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
      const ciphertext = combined.subarray(IV_LENGTH + TAG_LENGTH);
      const reordered = Buffer.concat([ciphertext, tag]);

      const decryptedBuffer = await subtle.decrypt(
        { name: "AES-GCM", iv, tagLength: TAG_LENGTH * 8 },
        cryptoKey,
        reordered
      );
      return new TextDecoder().decode(decryptedBuffer);
    } catch {
      throw new Error("Decryption failed: Unsupported state or unable to authenticate data");
    }
  }
}
