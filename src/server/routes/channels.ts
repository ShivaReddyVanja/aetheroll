import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import crypto from "crypto";
import { getDb } from "../lib/db";
import { decryptSession } from "../lib/crypto";
import { createTelegramClient, getUserChannels } from "../lib/telegram";

export const channelsRouter = new Hono();

/**
 * Helper to get authenticated user & their Telegram client
 */
async function getAuthUserClient(c: any) {
  const token = getCookie(c, "tg_session");
  if (!token) throw new Error("Unauthorized");

  const db = getDb((c.env as any)?.DB);
  const session = await db.get(
    `SELECT u.* FROM user_sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > CURRENT_TIMESTAMP`,
    [token]
  );

  if (!session) throw new Error("Unauthorized");

  const plainSession = decryptSession(session.session_string);
  const client = createTelegramClient(plainSession);
  return { user: session, client, db };
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

    // 1. Fetch live channels from Telegram
    let tgChannels: any[] = [];
    try {
      tgChannels = await getUserChannels(client);

      for (const ch of tgChannels) {
        // Find or create channel in D1
        let channelRow = await db.get("SELECT * FROM channels WHERE telegram_channel_id = ?", [ch.id]);
        const channelId = channelRow?.id || crypto.randomUUID();

        if (!channelRow) {
          await db.run(
            "INSERT INTO channels (id, telegram_channel_id, name) VALUES (?, ?, ?)",
            [channelId, ch.id, ch.title]
          );
        } else {
          await db.run("UPDATE channels SET name = ? WHERE id = ?", [ch.title, channelId]);
        }

        // Ensure user_channels mapping exists
        await db.run(
          `INSERT INTO user_channels (user_id, channel_id, role)
           VALUES (?, ?, 'owner')
           ON CONFLICT(user_id, channel_id) DO NOTHING`,
          [user.id, channelId]
        );
      }
    } catch (tgErr) {
      console.warn("Failed live TG channel sync, using cached D1 channels:", tgErr);
    }

    if (returnAll) {
      // Return all channels for the picker modal
      const allChannels = await db.all(
        `SELECT c.id, c.telegram_channel_id, c.name, c.cover_media_id, c.last_synced_at,
                COUNT(m.id) as media_count
         FROM channels c
         JOIN user_channels uc ON uc.channel_id = c.id
         LEFT JOIN media_items m ON m.channel_id = c.id AND m.deleted_at IS NULL
         WHERE uc.user_id = ?
         GROUP BY c.id
         ORDER BY (c.telegram_channel_id = 'me') DESC, media_count DESC, c.name ASC`,
        [user.id]
      );
      return c.json({ channels: allChannels });
    }

    // Default: Return only active channels (with media or 'me')
    const activeChannels = await db.all(
      `SELECT c.id, c.telegram_channel_id, c.name, c.cover_media_id, c.last_synced_at,
              COUNT(m.id) as media_count
       FROM channels c
       JOIN user_channels uc ON uc.channel_id = c.id
       LEFT JOIN media_items m ON m.channel_id = c.id AND m.deleted_at IS NULL
       WHERE uc.user_id = ?
       GROUP BY c.id
       HAVING media_count > 0 OR c.telegram_channel_id = 'me'
       ORDER BY (c.telegram_channel_id = 'me') DESC, media_count DESC, c.name ASC`,
      [user.id]
    );

    return c.json({ channels: activeChannels });
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

    let channelRow = await db.get("SELECT * FROM channels WHERE telegram_channel_id = ?", [telegram_channel_id]);
    const channelId = channelRow?.id || crypto.randomUUID();

    if (!channelRow) {
      await db.run(
        "INSERT INTO channels (id, telegram_channel_id, name) VALUES (?, ?, ?)",
        [channelId, telegram_channel_id, name || "Telegram Channel"]
      );
    }

    await db.run(
      `INSERT INTO user_channels (user_id, channel_id, role)
       VALUES (?, ?, 'owner')
       ON CONFLICT(user_id, channel_id) DO NOTHING`,
      [user.id, channelId]
    );

    return c.json({ success: true, channelId });
  } catch (error: any) {
    return c.json({ error: error.message || "Failed to add channel" }, 500);
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
       JOIN user_channels uc ON uc.channel_id = c.id
       WHERE c.id = ? AND uc.user_id = ?`,
      [channelId, user.id]
    );

    if (!channel) {
      return c.json({ error: "Channel not found or unauthorized" }, 404);
    }

    if (!client.connected) {
      await client.connect();
    }

    // Fetch last 100 messages from channel
    let targetPeer: any = channel.telegram_channel_id;
    if (channel.telegram_channel_id === "me") {
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

    const messages = await client.getMessages(targetPeer, { limit: 100 });
    let indexedCount = 0;

    for (const msg of messages) {
      if (!msg.media) continue;

      const isPhoto = !!msg.photo;
      const isVideo = !!(msg.video || (msg.document && msg.document.mimeType?.startsWith("video/")));

      if (!isPhoto && !isVideo) continue;

      const fileType = isPhoto ? "photo" : "video";
      const mimeType = isPhoto ? "image/jpeg" : (msg.document?.mimeType || "video/mp4");
      const fileSize = (msg.photo as any)?.sizes?.slice(-1)[0]?.size || (msg.document as any)?.size || 0;
      
      // Default dimensions or extracted
      const width = (msg.photo as any)?.sizes?.slice(-1)[0]?.w || (msg.document as any)?.attributes?.find((a: any) => a.w)?.w || 1920;
      const height = (msg.photo as any)?.sizes?.slice(-1)[0]?.h || (msg.document as any)?.attributes?.find((a: any) => a.h)?.h || 1080;
      const duration = (msg.document as any)?.attributes?.find((a: any) => a.duration)?.duration || null;

      // Safe placeholder BlurHash
      const defaultBlurHash = "LEHV6nWB2yk8pyo0adR*.7kCMdnj";

      const mediaId = crypto.randomUUID();
      const capturedAt = new Date(msg.date * 1000).toISOString();

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
          mediaId, channel.id, user.id, msg.id, fileType,
          mimeType, fileSize, width, height, duration,
          defaultBlurHash, capturedAt
        ]
      );
      indexedCount++;
    }

    await db.run("UPDATE channels SET last_synced_at = CURRENT_TIMESTAMP WHERE id = ?", [channelId]);

    return c.json({ success: true, indexedCount });
  } catch (error: any) {
    console.error("Sync Error:", error);
    return c.json({ error: error.message || "Failed to sync channel" }, 500);
  }
});
