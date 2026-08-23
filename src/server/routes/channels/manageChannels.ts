import { Hono } from "hono";
import crypto from "crypto";
import { Api, utils } from "telegram";
import { toSafeNumber } from "../../lib/db.ts";
import { verifyAetherollSignature } from "../../lib/crypto.ts";
import { getR2Storage } from "../../lib/r2.ts";
import { getAuthUserClient } from "./utils.ts";

export const manageChannelsRoute = new Hono();

/**
 * POST /add
 * Explicitly adds a Telegram channel to active galleries and performs initial sync
 */
manageChannelsRoute.post("/add", async (c) => {
  try {
    const { user, client, db } = await getAuthUserClient(c);
    const { telegram_channel_id, name } = await c.req.json();

    if (!telegram_channel_id) {
      return c.json({ error: "telegram_channel_id required" }, 400);
    }

    const userMeTgId = `me_${user.telegram_user_id}`;
    const targetTgId = telegram_channel_id === "me" ? userMeTgId : telegram_channel_id;

    let channelRow = await db.get("SELECT * FROM channels WHERE telegram_channel_id = ?", [targetTgId]);
    const channelId = channelRow?.id || crypto.randomUUID();

    if (!channelRow) {
      await db.run(
        "INSERT INTO channels (id, telegram_channel_id, name) VALUES (?, ?, ?)",
        [channelId, targetTgId, name || "Telegram Channel"]
      );
    }

    // Explicitly add to gallery_channels table
    await db.run(
      `INSERT INTO gallery_channels (user_id, channel_id)
       VALUES (?, ?)
       ON CONFLICT(user_id, channel_id) DO NOTHING`,
      [user.id, channelId]
    );

    // Initial background sync for newly added channel
    try {
      if (!client.connected) await client.connect();
      let targetPeer: any = targetTgId;
      if (targetTgId === "me" || targetTgId.startsWith("me_")) {
        targetPeer = "me";
      } else {
        try { targetPeer = await client.getInputEntity(targetTgId); }
        catch { try { targetPeer = await client.getEntity(targetTgId); } catch {} }
      }
      const messages = await client.getMessages(targetPeer, { limit: 100 });
      for (const msg of messages) {
        if (!msg.media) continue;

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

        const docAttrs = doc?.attributes || [];
        const imageAttr = docAttrs.find((a: any) => a.w && a.h);
        const videoAttr = docAttrs.find((a: any) => a.w && a.h);
        const photoSizes = (msg.photo as any)?.sizes || [];
        const largestPhotoSize = photoSizes[photoSizes.length - 1];

        const width = toSafeNumber(imageAttr?.w || videoAttr?.w || largestPhotoSize?.w || 1920);
        const height = toSafeNumber(imageAttr?.h || videoAttr?.h || largestPhotoSize?.h || 1080);
        const rawDuration = docAttrs.find((a: any) => a.duration != null)?.duration;
        const duration = rawDuration != null ? toSafeNumber(rawDuration) : null;
        const capturedAt = new Date(dateSeconds * 1000).toISOString();
        const tgMsgId = toSafeNumber(msg.id);

        await db.run(
          `INSERT INTO media_items (
             id, channel_id, uploader_user_id, telegram_message_id, file_type,
             mime_type, file_size_bytes, width, height, duration_seconds,
             blur_hash, captured_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'LEHV6nWB2yk8pyo0adR*.7kCMdnj', ?)
           ON CONFLICT(channel_id, telegram_message_id) DO NOTHING`,
          [crypto.randomUUID(), channelId, user.id, tgMsgId, fileType, mimeType, fileSize, width, height, duration, capturedAt]
        );
      }
      await db.run("UPDATE channels SET last_synced_at = CURRENT_TIMESTAMP WHERE id = ?", [channelId]);
    } catch (syncErr) {
      console.warn("Initial sync error on add:", syncErr);
    }

    return c.json({ success: true, channelId });
  } catch (error: any) {
    return c.json({ error: error.message || "Failed to add channel" }, error.message === "Unauthorized" ? 401 : 500);
  }
});

/**
 * POST /remove
 * Removes a channel from active galleries
 */
manageChannelsRoute.post("/remove", async (c) => {
  try {
    const { user, db } = await getAuthUserClient(c);
    const { channel_id } = await c.req.json();

    if (!channel_id) {
      return c.json({ error: "channel_id required" }, 400);
    }

    await db.run("DELETE FROM gallery_channels WHERE user_id = ? AND channel_id = ?", [user.id, channel_id]);
    return c.json({ success: true });
  } catch (error: any) {
    return c.json({ error: error.message || "Failed to remove channel" }, error.message === "Unauthorized" ? 401 : 500);
  }
});
