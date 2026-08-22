import { TelegramClient } from "telegram";
import { CustomFile } from "telegram/client/uploads.js";
import type { DatabaseInterface } from "./db";
import crypto from "crypto";

export interface GalleryEventPayload {
  blur_hash?: string;
  captured_at?: string;
  gps?: {
    lat: number;
    lng: number;
    alt?: number;
    name?: string;
  };
  people?: string[];
  event?: string;
  tags?: string[];
  trip?: string;
  fav?: boolean;
  deleted?: boolean;
}

export type GalleryOpType =
  | "CREATE"
  | "TAG_PEOPLE"
  | "SET_LOCATION"
  | "SET_EVENT"
  | "ADD_TAG"
  | "SET_TRIP"
  | "FAVORITE"
  | "DELETE";

export interface GalleryOp {
  op: GalleryOpType;
  refs: number[]; // Telegram Message IDs of target media items
  data: GalleryEventPayload;
}

export interface GalleryEvent {
  _t: "GP_EVENT";
  v: number;
  ref: number; // Telegram Message ID of the target media item
  op: GalleryOpType;
  data: GalleryEventPayload;
  ts: number;
}

export const EVENT_TAG_PREFIX = "[GP_EVENT:v1]";
export const BATCH_TAG_PREFIX = "[GP_BATCH:v1]";

/**
 * Derives a 256-bit AES-GCM key from MASTER_ENCRYPTION_KEY or fallback
 */
async function getMasterCryptoKey(customKey?: string): Promise<CryptoKey> {
  const secret =
    customKey ||
    process.env.MASTER_ENCRYPTION_KEY ||
    process.env.SESSION_ENCRYPTION_KEY ||
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

/**
 * Emits an AES-GCM encrypted inline event payload threaded to a media item in Telegram
 */
export async function emitGalleryEvent(
  client: TelegramClient,
  targetPeer: any,
  refMsgId: number,
  op: GalleryOpType,
  data: GalleryEventPayload,
  customKey?: string
): Promise<number | null> {
  try {
    const ts = Math.floor(Date.now() / 1000);
    const { iv, ct } = await encryptPayload({ op, data, ts }, customKey);

    const envelope = {
      _t: "GP_EVENT",
      v: 1,
      ref: refMsgId,
      iv,
      ct,
    };

    const messageText = `${EVENT_TAG_PREFIX}\n${JSON.stringify(envelope)}`;

    const sent = await client.sendMessage(targetPeer, {
      message: messageText,
      replyTo: refMsgId,
    });

    return sent.id;
  } catch (err) {
    console.error(`[EventLedger] Failed to emit event ${op} for msg ${refMsgId}:`, err);
    return null;
  }
}

/**
 * Emits an AES-GCM encrypted batch document manifest to a Telegram channel
 */
export async function emitGalleryBatch(
  client: TelegramClient,
  targetPeer: any,
  channelId: string,
  ops: GalleryOp[],
  customKey?: string
): Promise<number | null> {
  try {
    if (!ops || ops.length === 0) return null;

    const ts = Math.floor(Date.now() / 1000);
    const { iv, ct } = await encryptPayload({ ts, ops }, customKey);

    const manifest = {
      _t: "GP_BATCH",
      v: 1,
      channel_id: channelId,
      iv,
      ct,
    };

    const jsonContent = JSON.stringify(manifest, null, 2);
    const jsonBuffer = Buffer.from(jsonContent, "utf-8");
    const fileName = `aetheroll_batch_${Date.now()}_${crypto.randomUUID().slice(0, 8)}.json`;

    const customFile = new CustomFile(fileName, jsonBuffer.length, "", jsonBuffer);

    const sent = await client.sendFile(targetPeer, {
      file: customFile,
      caption: BATCH_TAG_PREFIX,
      forceDocument: true,
      workers: 1,
    });

    return sent.id;
  } catch (err) {
    console.error(`[BatchLedger] Failed to emit batch manifest for channel ${channelId}:`, err);
    return null;
  }
}

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

/**
 * Replays single op for target media items in the D1 database scoped to channel
 */
async function applyOpToDb(
  db: DatabaseInterface,
  channelId: string,
  userId: string,
  refMsgId: number,
  op: GalleryOpType,
  data: GalleryEventPayload
): Promise<boolean> {
  const mediaItem = await db.get(
    "SELECT id FROM media_items WHERE channel_id = ? AND telegram_message_id = ?",
    [channelId, refMsgId]
  );

  if (!mediaItem) return false;
  const mediaId = mediaItem.id;

  // 1. Media attributes
  if (data.blur_hash) {
    await db.run("UPDATE media_items SET blur_hash = ? WHERE id = ?", [data.blur_hash, mediaId]);
  }
  if (data.captured_at) {
    await db.run("UPDATE media_items SET captured_at = ? WHERE id = ?", [data.captured_at, mediaId]);
  }

  // 2. Inline Geo Location
  if (data.gps && typeof data.gps.lat === "number" && typeof data.gps.lng === "number") {
    await db.run(
      "UPDATE media_items SET latitude = ?, longitude = ?, altitude = ? WHERE id = ?",
      [data.gps.lat, data.gps.lng, data.gps.alt || null, mediaId]
    );
  }

  // 3. Favorites
  if (data.fav !== undefined) {
    if (data.fav) {
      await db.run(
        "INSERT INTO media_favorites (user_id, media_item_id) VALUES (?, ?) ON CONFLICT DO NOTHING",
        [userId, mediaId]
      );
    } else {
      await db.run(
        "DELETE FROM media_favorites WHERE user_id = ? AND media_item_id = ?",
        [userId, mediaId]
      );
    }
  }

  // 4. People Tags (scoped to channelId)
  if (data.people && Array.isArray(data.people)) {
    for (const personName of data.people) {
      if (!personName.trim()) continue;
      let personRow = await db.get(
        "SELECT id FROM people WHERE channel_id = ? AND name = ?",
        [channelId, personName.trim()]
      );
      const personId = personRow?.id || crypto.randomUUID();

      if (!personRow) {
        await db.run(
          "INSERT INTO people (id, channel_id, name, created_by, user_id) VALUES (?, ?, ?, ?, ?)",
          [personId, channelId, personName.trim(), userId, userId]
        );
      }

      await db.run(
        "INSERT INTO media_person_tags (id, media_item_id, person_id, tagged_by) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING",
        [crypto.randomUUID(), mediaId, personId, userId]
      );
    }
  }

  // 5. Events (scoped to channelId)
  if (data.event && data.event.trim()) {
    let eventRow = await db.get(
      "SELECT id FROM events WHERE channel_id = ? AND name = ?",
      [channelId, data.event.trim()]
    );
    const eventId = eventRow?.id || crypto.randomUUID();

    if (!eventRow) {
      await db.run(
        "INSERT INTO events (id, channel_id, name, created_by, user_id) VALUES (?, ?, ?, ?, ?)",
        [eventId, channelId, data.event.trim(), userId, userId]
      );
    }

    await db.run(
      "INSERT INTO media_event_tags (id, media_item_id, event_id, tagged_by) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING",
      [crypto.randomUUID(), mediaId, eventId, userId]
    );
  }

  // 6. User-defined Tags (scoped to channelId)
  if (data.tags && Array.isArray(data.tags)) {
    for (const tagName of data.tags) {
      if (!tagName.trim()) continue;
      let tagRow = await db.get(
        "SELECT id FROM tags WHERE channel_id = ? AND name = ?",
        [channelId, tagName.trim()]
      );
      const tagId = tagRow?.id || crypto.randomUUID();

      if (!tagRow) {
        await db.run(
          "INSERT INTO tags (id, channel_id, user_id, name) VALUES (?, ?, ?, ?)",
          [tagId, channelId, userId, tagName.trim()]
        );
      }

      await db.run(
        "INSERT INTO media_tags (media_item_id, tag_id, tagged_by) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
        [mediaId, tagId, userId]
      );
    }
  }

  // 7. Trips (scoped to channelId)
  if (data.trip && data.trip.trim()) {
    let tripRow = await db.get(
      "SELECT id FROM trips WHERE channel_id = ? AND name = ?",
      [channelId, data.trip.trim()]
    );
    const tripId = tripRow?.id || crypto.randomUUID();

    if (!tripRow) {
      await db.run(
        "INSERT INTO trips (id, channel_id, user_id, name) VALUES (?, ?, ?, ?)",
        [tripId, channelId, userId, data.trip.trim()]
      );
    }

    await db.run(
      "INSERT INTO trip_media (media_item_id, trip_id, added_by) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
      [mediaId, tripId, userId]
    );
  }

  // 8. Delete
  if (op === "DELETE" || data.deleted) {
    await db.run("UPDATE media_items SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?", [mediaId]);
  }

  return true;
}

/**
 * Replays a collection of chronological events into the D1 database for a specific channel
 */
export async function applyGalleryEventsToDb(
  db: DatabaseInterface,
  channelId: string,
  userId: string,
  events: GalleryEvent[]
): Promise<number> {
  let appliedCount = 0;
  const sortedEvents = [...events].sort((a, b) => (a.ts || 0) - (b.ts || 0));

  for (const event of sortedEvents) {
    const success = await applyOpToDb(
      db,
      channelId,
      userId,
      event.ref,
      event.op,
      event.data
    );
    if (success) appliedCount++;
  }

  return appliedCount;
}

/**
 * Replays a batch of operations into the D1 database
 */
export async function applyGalleryBatch(
  db: DatabaseInterface,
  channelId: string,
  userId: string,
  ops: GalleryOp[]
): Promise<number> {
  let appliedCount = 0;

  for (const op of ops) {
    if (!Array.isArray(op.refs)) continue;
    for (const refMsgId of op.refs) {
      const success = await applyOpToDb(
        db,
        channelId,
        userId,
        refMsgId,
        op.op,
        op.data
      );
      if (success) appliedCount++;
    }
  }

  return appliedCount;
}
