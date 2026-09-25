import { helpers } from "telegram";
import { toSafeString } from "./db";

// ---------------------------------------------------------------------------
// Shared helpers for public media share creation.
// Used by both the DO handler (ShareHandler) and the local dev fallback
// (createShare.ts) to prevent logic drift between the two paths.
// ---------------------------------------------------------------------------

/**
 * Normalizes Telegram channel IDs so GramJS correctly classifies them as PeerChannel
 * rather than mistaking positive channel ID integers as PeerUser.
 */
export function normalizeTelegramPeerId(rawId: string): string {
  if (!rawId) return "me";
  const str = String(rawId).trim();
  if (str === "me" || str.startsWith("me_")) {
    return "me";
  }
  if (str.startsWith("-") || str.startsWith("@")) {
    return str;
  }
  if (/^\d+$/.test(str)) {
    if (str.startsWith("100") && str.length >= 11) {
      return `-${str}`;
    }
    return `-100${str}`;
  }
  return str;
}

/**
 * Resolves a Telegram peer from a raw channel-id string.
 * Normalizes the peer ID format, checks in-memory cache, warms dialogs on cache miss,
 * and falls back safely.
 */
export async function resolveTelegramPeer(client: any, channelId: string): Promise<any> {
  const normalizedId = normalizeTelegramPeerId(channelId);
  if (normalizedId === "me") {
    return "me";
  }

  // 1. Fast path: Check in-memory entity cache with normalized and raw IDs
  try {
    const peer = await client.getInputEntity(normalizedId);
    if (peer) return peer;
  } catch {}

  try {
    const peer = await client.getEntity(normalizedId);
    if (peer) return peer;
  } catch {}

  // 2. Cache Miss: Prime the GramJS entity cache by fetching dialogs
  try {
    if (typeof client.getDialogs === "function") {
      await client.getDialogs({ limit: 100 });
    }
    return (await client.getInputEntity(normalizedId).catch(() => null)) ||
           (await client.getEntity(normalizedId).catch(() => null)) ||
           (await client.getInputEntity(channelId).catch(() => null)) ||
           (await client.getEntity(channelId).catch(() => null)) ||
           normalizedId;
  } catch {
    return normalizedId;
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
