import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

/**
 * Derives a 32-byte Buffer key from the environment secret
 */
function getKey(): Buffer {
  const secret = process.env.SESSION_ENCRYPTION_KEY || "default_fallback_secret_32_bytes!";
  return crypto.createHash("sha256").update(secret).digest();
}

/**
 * Encrypts a plaintext string (e.g. Telegram StringSession) using AES-256-GCM
 */
export function encryptSession(plainText: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Pack: IV (12 bytes) + Tag (16 bytes) + Encrypted Data
  const combined = Buffer.concat([iv, tag, encrypted]);
  return combined.toString("base64");
}

/**
 * Decrypts an AES-256-GCM encrypted base64 payload
 */
export function decryptSession(cipherTextBase64: string): string {
  const combined = Buffer.from(cipherTextBase64, "base64");
  
  if (combined.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error("Invalid cipher text length");
  }

  const iv = combined.subarray(0, IV_LENGTH);
  const tag = combined.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const encrypted = combined.subarray(IV_LENGTH + TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}
