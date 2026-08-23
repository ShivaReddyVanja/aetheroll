/**
 * Derives a 256-bit AES-GCM key from MASTER_ENCRYPTION_KEY or fallback
 */
export async function getMasterCryptoKey(customKey?: string): Promise<CryptoKey> {
  const secret =
    customKey ||
    process.env.MASTER_ENCRYPTION_KEY ||
    "aetheroll-vault-master-secret";

  const encoder = new TextEncoder();
  const subtle = globalThis.crypto?.subtle || (await import("crypto")).webcrypto?.subtle;
  if (!subtle) {
    throw new Error("Web Crypto API (crypto.subtle) is not available");
  }

  const keyBuffer = await subtle.digest("SHA-256", encoder.encode(secret));
  return subtle.importKey("raw", keyBuffer, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/**
 * Encrypts arbitrary data using AES-256-GCM with a fresh 12-byte IV
 */
export async function encryptPayload(
  data: any,
  customKey?: string
): Promise<{ iv: string; ct: string }> {
  const subtle = globalThis.crypto?.subtle || (await import("crypto")).webcrypto?.subtle;
  const cryptoKey = await getMasterCryptoKey(customKey);

  const iv = new Uint8Array(12);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(iv);
  } else {
    const { randomFillSync } = await import("crypto");
    randomFillSync(iv);
  }

  const encoder = new TextEncoder();
  const jsonStr = JSON.stringify(data);
  const encryptedBuffer = await subtle.encrypt(
    { name: "AES-GCM", iv, tagLength: 128 },
    cryptoKey,
    encoder.encode(jsonStr)
  );

  return {
    iv: Buffer.from(iv).toString("base64"),
    ct: Buffer.from(encryptedBuffer).toString("base64"),
  };
}

/**
 * Decrypts an AES-256-GCM ciphertext. Returns null if invalid or tampered.
 */
export async function decryptPayload<T = any>(
  ivBase64: string,
  ctBase64: string,
  customKey?: string
): Promise<T | null> {
  try {
    const subtle = globalThis.crypto?.subtle || (await import("crypto")).webcrypto?.subtle;
    const cryptoKey = await getMasterCryptoKey(customKey);

    const iv = Buffer.from(ivBase64, "base64");
    const ct = Buffer.from(ctBase64, "base64");

    const decryptedBuffer = await subtle.decrypt(
      { name: "AES-GCM", iv, tagLength: 128 },
      cryptoKey,
      ct
    );

    const jsonStr = new TextDecoder().decode(decryptedBuffer);
    return JSON.parse(jsonStr) as T;
  } catch (err) {
    // Decryption failed (wrong key, tampered ciphertext, or invalid format)
    return null;
  }
}
