import { helpers } from "telegram";
import { toSafeString } from "./db";

// ---------------------------------------------------------------------------
// Shared helpers for public media share creation.
// Used by both the DO handler (ShareHandler) and the local dev fallback
// (createShare.ts) to prevent logic drift between the two paths.
// ---------------------------------------------------------------------------

/**
 * Resolves a Telegram peer from a raw channel-id string.
 * Tries getInputEntity first (cheap), falls back to getEntity (full lookup),
 * and throws a descriptive error if both fail so callers surface a proper
 * HTTP status instead of silently continuing with a broken peer value.
 */
export async function resolveTelegramPeer(client: any, channelId: string): Promise<any> {
  if (channelId === "me" || channelId.startsWith("me_")) {
    return "me";
  }
  try {
    return await client.getInputEntity(channelId);
  } catch {
    try {
      return await client.getEntity(channelId);
    } catch (err: any) {
      throw new Error(
        `Unable to resolve Telegram peer for channel "${channelId}": ${err?.message ?? String(err)}`
      );
    }
  }
}

/**
 * Extracts document/photo metadata from a raw Telegram message object.
 * Returns null when the message carries no file media or is missing
 * required MTProto fields (id, accessHash).
 */
export function extractShareableFileMetadata(msg: any): {
  docId: string;
  accessHash: string;
  fileRefHex: string;
} | null {
  const media = msg?.media;
  if (!media) return null;

  const subject = media.document ?? media.photo ?? null;
  if (!subject?.id || !subject?.accessHash) return null;

  return {
    docId: toSafeString(subject.id),
    accessHash: toSafeString(subject.accessHash),
    fileRefHex: subject.fileReference
      ? Buffer.from(subject.fileReference).toString("hex")
      : "",
  };
}

/**
 * Generates a cryptographically secure 64-bit random integer compatible with
 * Telegram's randomId field (signed 64-bit, unique per forward request).
 * Uses gramjs helpers which work in both Node and the Cloudflare Workers runtime.
 */
export function secureTelegramRandomId(): any {
  return helpers.readBigIntFromBuffer(helpers.generateRandomBytes(8), true, true);
}

/**
 * Generates a URL-safe base64 share token using the Web Crypto API
 * (available in both Node ≥ 19 and Cloudflare Workers).
 */
export function generateShareId(): string {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return `sh_${Buffer.from(bytes).toString("base64url")}`;
}
