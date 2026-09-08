import { decryptPayload } from "./crypto";
import type {
  GalleryEvent,
  GalleryOpType,
  GalleryEventPayload,
  GalleryOp,
} from "./types";
import {
  EVENT_TAG_PREFIX,
  BATCH_TAG_PREFIX,
} from "./types";

/**
 * Parses a Telegram message to see if it is a valid Gallery Event (handles encrypted & legacy)
 */
export async function parseGalleryEvent(
  text?: string,
  customKey?: string
): Promise<GalleryEvent | null> {
  if (!text || !text.includes(EVENT_TAG_PREFIX)) return null;

  try {
    const jsonStr = text.substring(text.indexOf(EVENT_TAG_PREFIX) + EVENT_TAG_PREFIX.length).trim();
    const parsed = JSON.parse(jsonStr);

    if (!parsed || parsed._t !== "GP_EVENT" || typeof parsed.ref !== "number") {
      return null;
    }

    // Check if it's encrypted format: { _t, v, ref, iv, ct }
    if (parsed.iv && parsed.ct) {
      const decrypted = await decryptPayload<{ op: GalleryOpType; data: GalleryEventPayload; ts: number }>(
        parsed.iv,
        parsed.ct,
        customKey
      );
      if (decrypted && decrypted.op && decrypted.data) {
        return {
          _t: "GP_EVENT",
          v: parsed.v || 1,
          ref: parsed.ref,
          op: decrypted.op,
          data: decrypted.data,
          ts: decrypted.ts || Math.floor(Date.now() / 1000),
        };
      }
      return null;
    }

    // Legacy unencrypted format: { _t, v, ref, op, data, ts }
    if (parsed.op && parsed.data) {
      return parsed as GalleryEvent;
    }
  } catch (e) {
    // Malformed JSON event message
  }
  return null;
}

/**
 * Parses and decrypts a Telegram batch document manifest
 */
export async function parseGalleryBatch(
  caption: string | undefined,
  docBytes: Buffer | Uint8Array,
  expectedChannelId: string,
  customKey?: string
): Promise<{ ts: number; ops: GalleryOp[] } | null> {
  // 1. Strict caption check
  if (!caption || caption.trim() !== BATCH_TAG_PREFIX) {
    return null;
  }

  try {
    // 2. Parse outer envelope
    const jsonStr = Buffer.from(docBytes).toString("utf-8");
    const parsed = JSON.parse(jsonStr);

    if (
      !parsed ||
      parsed._t !== "GP_BATCH" ||
      parsed.channel_id !== expectedChannelId ||
      !parsed.iv ||
      !parsed.ct
    ) {
      return null;
    }

    // 3. Decrypt ciphertext
    const decrypted = await decryptPayload<{ ts: number; ops: GalleryOp[] }>(
      parsed.iv,
      parsed.ct,
      customKey
    );

    if (decrypted && Array.isArray(decrypted.ops)) {
      return decrypted;
    }
  } catch (e) {
    // Invalid batch document or decryption error
  }
  return null;
}
