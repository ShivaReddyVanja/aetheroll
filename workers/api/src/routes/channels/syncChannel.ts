import { Hono } from "hono";
import crypto from "crypto";
import { Api, utils } from "telegram";
import { toSafeNumber } from "../../lib/db";
import { verifyAetherollSignature } from "../../lib/crypto";
import {
  parseGalleryEvent,
  parseGalleryBatch,
  applyGalleryEventsToDb,
  applyGalleryBatch,
  EVENT_TAG_PREFIX,
  BATCH_TAG_PREFIX,
} from "../../lib/ledger";
import type { GalleryEvent, GalleryOp } from "../../lib/ledger";
import { getR2Storage } from "../../lib/r2";
import { isTelegramAuthError, handleTelegramAuthFailure } from "../../lib/telegram";
import { getAuthUserClient } from "./utils";

export const syncChannelRoute = new Hono();

/**
 * POST /:id/sync
 * Syncs recent messages from a specific Telegram channel into D1
 */
syncChannelRoute.post("/:id/sync", async (c) => {
  try {
    const channelId = c.req.param("id");
    const { user, client, db } = await getAuthUserClient(c);

    const channel = await db.get(
      `SELECT c.* FROM channels c
       JOIN gallery_channels gc ON gc.channel_id = c.id
       WHERE c.id = ? AND gc.user_id = ?`,
      [channelId, user.id]
    );

    if (!channel) {
      return c.json({ error: "Channel not found or unauthorized" }, 404);
    }

    if (!client.connected) {
      await client.connect();
    }

    // Fetch last 200 messages from channel
    let targetPeer: any = channel.telegram_channel_id;
    if (channel.telegram_channel_id === "me" || channel.telegram_channel_id.startsWith("me_")) {
      targetPeer = "me";
    } else {
      try {
        targetPeer = await client.getInputEntity(channel.telegram_channel_id);
      } catch {
        try {
          targetPeer = await client.getEntity(channel.telegram_channel_id);
        } catch {}
      }
    }

    const messages = await client.getMessages(targetPeer, { limit: 200 });
    let indexedCount = 0;
    let prunedCount = 0;
    let cleanedOrphanEventsCount = 0;

    const activeTgMediaMsgIds = new Set<number>();
    const scannedMsgIds: number[] = [];
    const eventRecords: { event: GalleryEvent; msgId: number; ref: number }[] = [];
    const rawEventMessages: { msgId: number; ref: number | null }[] = [];
    const batchRecords: { batch: { ts: number; ops: GalleryOp[] }; msgId: number }[] = [];
    const encryptionKey = (c.env as any)?.MASTER_ENCRYPTION_KEY;

    // Pass 1: Index raw media messages & collect WAL events
    for (const msg of messages) {
      if (!msg) continue;
      const msgId = toSafeNumber(msg.id);
      scannedMsgIds.push(msgId);

      const hasEventPrefix = typeof msg.message === "string" && msg.message.includes(EVENT_TAG_PREFIX);
      const rawReplyToId = (msg.replyTo as any)?.replyToMsgId ? toSafeNumber((msg.replyTo as any).replyToMsgId) : null;
      let envelopeRef: number | null = null;

      // 1. Check if this message is a WAL event envelope
      if (hasEventPrefix && msg.message) {
        try {
          const jsonStr = msg.message.substring(msg.message.indexOf(EVENT_TAG_PREFIX) + EVENT_TAG_PREFIX.length).trim();
          const parsed = JSON.parse(jsonStr);
          if (parsed && typeof parsed.ref === "number") {
            envelopeRef = parsed.ref;
          }
        } catch {}

        const event = await parseGalleryEvent(msg.message, encryptionKey);
        const refId = event?.ref || envelopeRef || rawReplyToId || 0;
        if (event) {
          eventRecords.push({ event, msgId, ref: refId });
          continue;
        } else {
          // Record unparseable/unencrypted raw event message for orphan cleanup check
          rawEventMessages.push({ msgId, ref: envelopeRef || rawReplyToId });
          continue;
        }
      }

      // 2. Check if this message is a GP_BATCH document manifest
      if (msg.message?.startsWith(BATCH_TAG_PREFIX) && msg.media) {
        try {
          const docBytes = await client.downloadMedia(msg.media, {});
          if (docBytes && Buffer.isBuffer(docBytes)) {
            const batch = await parseGalleryBatch(
              msg.message,
              docBytes,
              channel.telegram_channel_id,
              encryptionKey
            );
            if (batch) {
              batchRecords.push({ batch, msgId });
              continue;
            }
          }
        } catch (bErr) {
          console.warn("[Sync] Error reading batch manifest:", bErr);
        }
      }

      // If it's a non-media message (e.g. text reply, signature tag), track for potential cleanup
      if (!msg.media) {
        if (rawReplyToId || msg.message?.startsWith("[AET:v1:")) {
          rawEventMessages.push({ msgId, ref: rawReplyToId });
        }
        continue;
      }

      const doc = (msg.document || (msg.media as any)?.document) as any;
      const isLegacyPhoto = !!msg.photo;
      const isDocImage = !!(doc && (
        doc.mimeType?.startsWith("image/") ||
        doc.mimeType === "image/jpeg" ||
        doc.mimeType === "image/png" ||
        doc.mimeType === "image/webp" ||
        doc.mimeType === "image/heic" ||
        doc.mimeType === "image/gif" ||
        doc.mimeType === "image/avif"
      ));
      const isPhoto = isLegacyPhoto || isDocImage;
      const isVideo = !!(msg.video || (doc && doc.mimeType?.startsWith("video/")));

      if (!isPhoto && !isVideo) continue;

      const fileType = isVideo ? "video" : "photo";
      const mimeType = doc?.mimeType || (isPhoto ? "image/jpeg" : "video/mp4");
      const fileSize = toSafeNumber((msg.photo as any)?.sizes?.slice(-1)[0]?.size || doc?.size || 0);
      const dateSeconds = toSafeNumber(msg.date, Math.floor(Date.now() / 1000));

      // Strictly verify Aetheroll cryptographic upload signature or WAL event
      const isAetherollMedia = await verifyAetherollSignature(
        msg.message,
        fileSize,
        dateSeconds,
        (c.env as any)?.SESSION_ENCRYPTION_KEY
      );
      if (!isAetherollMedia) {
        continue; // Strictly ignore any non-Aetheroll media
      }

      activeTgMediaMsgIds.add(msgId);

      // Default dimensions or extracted from document/photo attributes
      const docAttrs = doc?.attributes || [];
      const imageAttr = docAttrs.find((a: any) => a.w && a.h);
      const videoAttr = docAttrs.find((a: any) => a.w && a.h);
      const photoSizes = (msg.photo as any)?.sizes || [];
      const largestPhotoSize = photoSizes[photoSizes.length - 1];

      const width = toSafeNumber(imageAttr?.w || videoAttr?.w || largestPhotoSize?.w || 1920);
      const height = toSafeNumber(imageAttr?.h || videoAttr?.h || largestPhotoSize?.h || 1080);
      const rawDuration = docAttrs.find((a: any) => a.duration != null)?.duration;
      const duration = rawDuration != null ? toSafeNumber(rawDuration) : null;

      // Extract raw GPS from Telegram geo attachment if present
      const geoLat = (msg as any)?.geo?.lat != null ? Number((msg as any).geo.lat) : null;
      const geoLng = (msg as any)?.geo?.long != null ? Number((msg as any).geo.long) : null;

      // Safe placeholder BlurHash
      const defaultBlurHash = "LEHV6nWB2yk8pyo0adR*.7kCMdnj";

      const mediaId = crypto.randomUUID();
      const capturedAt = new Date(dateSeconds * 1000).toISOString();

      await db.run(
        `INSERT INTO media_items (
           id, channel_id, uploader_user_id, telegram_message_id, file_type,
           mime_type, file_size_bytes, width, height, duration_seconds,
           blur_hash, captured_at, latitude, longitude
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(channel_id, telegram_message_id) DO UPDATE SET
           file_size_bytes = excluded.file_size_bytes,
           width = excluded.width,
           height = excluded.height,
           duration_seconds = excluded.duration_seconds,
           latitude = COALESCE(excluded.latitude, media_items.latitude),
           longitude = COALESCE(excluded.longitude, media_items.longitude)`,
        [
          mediaId, channel.id, user.id, msgId, fileType,
          mimeType, fileSize, width, height, duration,
          defaultBlurHash, capturedAt, geoLat, geoLng
        ]
      );
      indexedCount++;
    }

    // Pass 2: 2-Way Sync - Prune ghost media items from D1 deleted directly in Telegram
    if (scannedMsgIds.length > 0) {
      const minScannedId = Math.min(...scannedMsgIds);
      const maxScannedId = Math.max(...scannedMsgIds);

      const existingItems = await db.all(
        `SELECT id, telegram_message_id, thumbnail_r2_key FROM media_items
         WHERE channel_id = ? AND telegram_message_id >= ? AND telegram_message_id <= ?`,
        [channel.id, minScannedId, maxScannedId]
      );

      const r2 = getR2Storage((c.env as any)?.R2_BUCKET);
      for (const item of existingItems) {
        const itemTgId = Number(item.telegram_message_id);
        if (!activeTgMediaMsgIds.has(itemTgId)) {
          // Item was deleted outside our web app (in Telegram client)
          await db.run("DELETE FROM media_favorites WHERE media_item_id = ?", [item.id]);
          await db.run("DELETE FROM media_tags WHERE media_item_id = ?", [item.id]);
          await db.run("DELETE FROM trip_media WHERE media_item_id = ?", [item.id]);
          await db.run("DELETE FROM media_person_tags WHERE media_item_id = ?", [item.id]);
          await db.run("DELETE FROM media_event_tags WHERE media_item_id = ?", [item.id]);
          await db.run("DELETE FROM media_items WHERE id = ?", [item.id]);
          if (item.thumbnail_r2_key) {
            try { await r2.delete(item.thumbnail_r2_key); } catch {}
          }
          try { await r2.delete(`cache/${channel.id}/${item.id}.bin`); } catch {}
          prunedCount++;
        }
      }
    }

    // Pass 3: Record discovered WAL event message IDs into D1 & collect valid events for replay
    const validEvents: GalleryEvent[] = [];

    for (const rec of eventRecords) {
      let isParentActive = activeTgMediaMsgIds.has(rec.ref);
      let parentDbId: string | null = null;

      if (rec.ref > 0) {
        const dbParent = await db.get(
          "SELECT id FROM media_items WHERE channel_id = ? AND telegram_message_id = ?",
          [channel.id, rec.ref]
        );
        if (dbParent) {
          isParentActive = true;
          parentDbId = dbParent.id;
          try {
            await db.run(
              `INSERT OR IGNORE INTO media_event_messages (id, channel_id, media_item_id, media_telegram_msg_id, event_telegram_msg_id)
               VALUES (?, ?, ?, ?, ?)`,
              [crypto.randomUUID(), channel.id, dbParent.id, rec.ref, rec.msgId]
            );
          } catch {}
        }
      }

      if (isParentActive) {
        validEvents.push(rec.event);
      }
    }

    for (const rec of rawEventMessages) {
      if (rec.ref && rec.ref > 0) {
        try {
          const dbParent = await db.get(
            "SELECT id FROM media_items WHERE channel_id = ? AND telegram_message_id = ?",
            [channel.id, rec.ref]
          );
          if (dbParent) {
            await db.run(
              `INSERT OR IGNORE INTO media_event_messages (id, channel_id, media_item_id, media_telegram_msg_id, event_telegram_msg_id)
               VALUES (?, ?, ?, ?, ?)`,
              [crypto.randomUUID(), channel.id, dbParent.id, rec.ref, rec.msgId]
            );
          }
        } catch {}
      }
    }

    // Pass 4: Replay valid Event Sourcing Ledger (restores tags, trips, people, events, favorites, GPS)
    let appliedEventsCount = 0;
    if (validEvents.length > 0) {
      appliedEventsCount += await applyGalleryEventsToDb(db, channel.id, user.id, validEvents);
    }

    // Pass 5: Replay Batch Manifests
    if (batchRecords.length > 0) {
      for (const rec of batchRecords) {
        appliedEventsCount += await applyGalleryBatch(db, channel.id, user.id, rec.batch.ops);
      }
    }

    console.log(`[EventLedger] Replayed ${appliedEventsCount} total events/batch-ops for channel ${channel.name}`);

    await db.run("UPDATE channels SET last_synced_at = CURRENT_TIMESTAMP WHERE id = ?", [channelId]);

    return c.json({
      success: true,
      indexedCount,
      prunedCount,
      cleanedOrphanEventsCount,
      appliedEventsCount,
    });
  } catch (error: any) {
    console.error("Sync Error:", error);
    if (isTelegramAuthError(error)) {
      try {
        const { user, db } = await getAuthUserClient(c);
        if (db && user?.id) {
          await handleTelegramAuthFailure(db, user.id);
        }
      } catch {}
      return c.json({ error: "Telegram session has been revoked or expired" }, 401);
    }
    return c.json({ error: error.message || "Failed to sync channel" }, error.message === "Unauthorized" ? 401 : 500);
  }
});
