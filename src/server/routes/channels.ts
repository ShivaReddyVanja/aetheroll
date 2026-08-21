import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import crypto from "crypto";
import { getDb, toSafeNumber, toSafeString } from "../lib/db";
import { decryptSession, verifyAetherollSignature } from "../lib/crypto";
import { createTelegramClient, getUserChannels, getConnectedClient, getDefaultTelegramConfig } from "../lib/telegram";
import { parseGalleryEvent, applyGalleryEventsToDb, GalleryEvent } from "../lib/ledger";
import { getR2Storage } from "../lib/r2";

import { resolveUserAuth } from "../lib/auth";

export const channelsRouter = new Hono();

/**
 * Helper to get authenticated user & their Telegram client via unified auth provider
 */
async function getAuthUserClient(c: any) {
  const auth = await resolveUserAuth(c);
  if (!auth.authenticated || !auth.userId || !auth.sessionString) {
    throw new Error("Unauthorized");
  }

  const db = getDb((c.env as any)?.DB);
  const client = createTelegramClient(auth.sessionString, auth.telegramConfig);
  return {
    user: {
      id: auth.userId,
      telegram_user_id: auth.telegramUserId,
      display_name: auth.displayName,
      session_string: auth.sessionString,
    },
    client,
    db,
  };
}

/**
 * GET /api/channels
 * Returns channels for the user.
 * - By default: Returns only active channels (with media or 'me' vault)
 * - With ?all=true: Returns all Telegram channels and groups the user belongs to
 */
channelsRouter.get("/", async (c) => {
  try {
    const { user, client, db } = await getAuthUserClient(c);
    const returnAll = c.req.query("all") === "true";

    // Ensure 'me' (Saved Messages) exists in channels catalog specifically for THIS user
    const userMeTgId = `me_${user.telegram_user_id}`;
    let meChannel = await db.get("SELECT * FROM channels WHERE telegram_channel_id = ?", [userMeTgId]);
    const meChannelId = meChannel?.id || crypto.randomUUID();
    if (!meChannel) {
      await db.run(
        "INSERT INTO channels (id, telegram_channel_id, name) VALUES (?, ?, 'Saved Messages (Private Cloud)')",
        [meChannelId, userMeTgId]
      );
    }

    if (returnAll) {
      // 1. Fetch live channels from Telegram for the picker modal
      try {
        const tgChannels = await getUserChannels(client);

        for (const ch of tgChannels) {
          const targetTgId = ch.id === "me" ? userMeTgId : ch.id;
          let channelRow = await db.get("SELECT * FROM channels WHERE telegram_channel_id = ?", [targetTgId]);
          const channelId = channelRow?.id || crypto.randomUUID();

          if (!channelRow) {
            await db.run(
              "INSERT INTO channels (id, telegram_channel_id, name) VALUES (?, ?, ?)",
              [channelId, targetTgId, ch.title]
            );
          } else {
            await db.run("UPDATE channels SET name = ? WHERE id = ?", [ch.title, channelId]);
          }
        }
      } catch (tgErr) {
        console.warn("Failed live TG channel sync, using cached D1 channels:", tgErr);
      }

      // Return all available Telegram channels for the picker modal
      const allChannels = await db.all(
        `SELECT c.id, c.telegram_channel_id, c.name, c.cover_media_id, c.last_synced_at,
                COUNT(m.id) as media_count,
                EXISTS(SELECT 1 FROM gallery_channels gc WHERE gc.channel_id = c.id AND gc.user_id = ?) as is_added
         FROM channels c
         LEFT JOIN media_items m ON m.channel_id = c.id AND m.deleted_at IS NULL
         WHERE c.telegram_channel_id NOT LIKE 'me_%' OR c.telegram_channel_id = ?
         GROUP BY c.id
         ORDER BY is_added DESC, (c.telegram_channel_id = ?) DESC, c.name ASC`,
        [user.id, userMeTgId, userMeTgId]
      );
      return c.json({ channels: allChannels });
    }

    // Default: Return ONLY channels explicitly added to the user's gallery
    const userChannels = await db.all(
      `SELECT c.id, c.telegram_channel_id, c.name, c.cover_media_id, c.last_synced_at,
              COUNT(m.id) as media_count
       FROM channels c
       JOIN gallery_channels gc ON gc.channel_id = c.id
       LEFT JOIN media_items m ON m.channel_id = c.id AND m.deleted_at IS NULL
       WHERE gc.user_id = ?
       GROUP BY c.id
       ORDER BY (c.telegram_channel_id = ? OR c.telegram_channel_id = 'me') DESC, media_count DESC, c.name ASC`,
      [user.id, userMeTgId]
    );

    return c.json({ channels: userChannels });
  } catch (error: any) {
    return c.json({ error: error.message || "Failed to fetch channels" }, error.message === "Unauthorized" ? 401 : 500);
  }
});

/**
 * POST /api/channels/add
 * Explicitly adds a Telegram channel to active galleries and performs initial sync
 */
channelsRouter.post("/add", async (c) => {
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
    return c.json({ error: error.message || "Failed to add channel" }, 500);
  }
});

/**
 * POST /api/channels/remove
 * Removes a channel from active galleries
 */
channelsRouter.post("/remove", async (c) => {
  try {
    const { user, db } = await getAuthUserClient(c);
    const { channel_id } = await c.req.json();

    if (!channel_id) {
      return c.json({ error: "channel_id required" }, 400);
    }

    await db.run("DELETE FROM gallery_channels WHERE user_id = ? AND channel_id = ?", [user.id, channel_id]);
    return c.json({ success: true });
  } catch (error: any) {
    return c.json({ error: error.message || "Failed to remove channel" }, 500);
  }
});

/**
 * POST /api/channels/:id/sync
 * Syncs recent messages from a specific Telegram channel into D1
 */
channelsRouter.post("/:id/sync", async (c) => {
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
    const eventRecords: { event: GalleryEvent; msgId: number }[] = [];

    // Pass 1: Index raw media messages & collect WAL events
    for (const msg of messages) {
      if (!msg) continue;
      const msgId = toSafeNumber(msg.id);
      scannedMsgIds.push(msgId);

      // Check if this message is a WAL event
      const event = parseGalleryEvent(msg.message);
      if (event) {
        eventRecords.push({ event, msgId });
        continue;
      }

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

      activeTgMediaMsgIds.add(msgId);

      // Default dimensions or extracted
      const width = toSafeNumber((msg.photo as any)?.sizes?.slice(-1)[0]?.w || (msg.document as any)?.attributes?.find((a: any) => a.w)?.w || 1920);
      const height = toSafeNumber((msg.photo as any)?.sizes?.slice(-1)[0]?.h || (msg.document as any)?.attributes?.find((a: any) => a.h)?.h || 1080);
      const rawDuration = (msg.document as any)?.attributes?.find((a: any) => a.duration)?.duration;
      const duration = rawDuration != null ? toSafeNumber(rawDuration) : null;

      // Safe placeholder BlurHash
      const defaultBlurHash = "LEHV6nWB2yk8pyo0adR*.7kCMdnj";

      const mediaId = crypto.randomUUID();
      const capturedAt = new Date(dateSeconds * 1000).toISOString();

      await db.run(
        `INSERT INTO media_items (
           id, channel_id, uploader_user_id, telegram_message_id, file_type,
           mime_type, file_size_bytes, width, height, duration_seconds,
           blur_hash, captured_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(channel_id, telegram_message_id) DO UPDATE SET
           file_size_bytes = excluded.file_size_bytes,
           width = excluded.width,
           height = excluded.height,
           duration_seconds = excluded.duration_seconds`,
        [
          mediaId, channel.id, user.id, msgId, fileType,
          mimeType, fileSize, width, height, duration,
          defaultBlurHash, capturedAt
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
          await db.run("DELETE FROM media_items WHERE id = ?", [item.id]);
          if (item.thumbnail_r2_key) {
            try { await r2.delete(item.thumbnail_r2_key); } catch {}
          }
          try { await r2.delete(`cache/${channel.id}/${item.id}.bin`); } catch {}
          prunedCount++;
        }
      }
    }

    // Pass 3: Auto-clean orphaned [GP_EVENT:v1] text messages from Telegram
    const orphanedEventIds: number[] = [];
    const validEvents: GalleryEvent[] = [];

    for (const rec of eventRecords) {
      if (activeTgMediaMsgIds.has(rec.event.ref)) {
        validEvents.push(rec.event);
      } else {
        // Target media message is no longer in Telegram! Mark event text message for cleanup
        orphanedEventIds.push(rec.msgId);
      }
    }

    if (orphanedEventIds.length > 0) {
      try {
        await client.deleteMessages(targetPeer, orphanedEventIds, { revoke: true });
        cleanedOrphanEventsCount = orphanedEventIds.length;
        console.log(`[EventLedger] Cleaned ${cleanedOrphanEventsCount} orphaned event messages from channel ${channel.name}`);
      } catch (delErr) {
        console.warn("[EventLedger] Orphaned event cleanup warning:", delErr);
      }
    }

    // Pass 4: Replay valid Event Sourcing Ledger (restores tags, favorites, GPS, custom dates)
    let appliedEventsCount = 0;
    if (validEvents.length > 0) {
      appliedEventsCount = await applyGalleryEventsToDb(db, channel.id, user.id, validEvents);
      console.log(`[EventLedger] Replayed ${appliedEventsCount} events for channel ${channel.name}`);
    }

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
    return c.json({ error: error.message || "Failed to sync channel" }, 500);
  }
});
