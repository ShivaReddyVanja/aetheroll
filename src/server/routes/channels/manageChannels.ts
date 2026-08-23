import { Hono } from "hono";
import crypto from "crypto";
import { toSafeNumber } from "../../lib/db.ts";
import { verifyAetherollSignature } from "../../lib/crypto.ts";
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
        const isPhoto = !!msg.photo;
        const isVideo = !!(msg.video || (msg.document && msg.document.mimeType?.startsWith("video/")));
        if (!isPhoto && !isVideo) continue;
        const fileType = isPhoto ? "photo" : "video";
        const mimeType = isPhoto ? "image/jpeg" : (msg.document?.mimeType || "video/mp4");
        const fileSize = toSafeNumber((msg.photo as any)?.sizes?.slice(-1)[0]?.size || (msg.document as any)?.size || 0);
        const dateSeconds = toSafeNumber(msg.date, Math.floor(Date.now() / 1000));

        // Strictly verify Aetheroll cryptographic upload signature or WAL event
        const isAetherollMedia = await verifyAetherollSignature(
          msg.message,
          fileSize,
          dateSeconds,
          (c.env as any)?.SESSION_ENCRYPTION_KEY
        );
        if (!isAetherollMedia) {
          continue; // Ignore random non-Aetheroll chat files
        }

        const width = toSafeNumber((msg.photo as any)?.sizes?.slice(-1)[0]?.w || (msg.document as any)?.attributes?.find((a: any) => a.w)?.w || 1920);
        const height = toSafeNumber((msg.photo as any)?.sizes?.slice(-1)[0]?.h || (msg.document as any)?.attributes?.find((a: any) => a.h)?.h || 1080);
        const rawDuration = (msg.document as any)?.attributes?.find((a: any) => a.duration)?.duration;
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
