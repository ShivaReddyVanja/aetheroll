import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import crypto from "crypto";
import { getDb } from "../lib/db";
import { decryptSession } from "../lib/crypto";
import { getR2Storage } from "../lib/r2";
import { createTelegramClient, getConnectedClient } from "../lib/telegram";
import { emitGalleryEvent } from "../lib/ledger";

export const mediaRouter = new Hono();

/**
 * GET /api/media
 * Query parameters:
 *  - channel_id: string (required)
 *  - limit: number (default 50)
 *  - cursor: string (ISO timestamp for keyset pagination)
 *  - person_id: optional filter
 *  - location_id: optional filter
 *  - event_id: optional filter
 *  - favorites_only: boolean
 */
mediaRouter.get("/", async (c) => {
  try {
    const token = getCookie(c, "tg_session");
    if (!token) return c.json({ error: "Unauthorized" }, 401);

    const db = getDb((c.env as any)?.DB);
    const session = await db.get(
      `SELECT u.id FROM user_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > CURRENT_TIMESTAMP`,
      [token]
    );
    if (!session) return c.json({ error: "Unauthorized" }, 401);

    const channelId = c.req.query("channel_id");
    if (!channelId) return c.json({ error: "channel_id is required" }, 400);

    const limit = Math.min(parseInt(c.req.query("limit") || "50", 10), 100);
    const cursor = c.req.query("cursor");
    const personId = c.req.query("person_id");
    const locationId = c.req.query("location_id");
    const eventId = c.req.query("event_id");
    const favoritesOnly = c.req.query("favorites_only") === "true";

    let query = `
      SELECT m.*,
             CASE WHEN f.user_id IS NOT NULL THEN 1 ELSE 0 END as is_favorite,
             u.display_name as uploader_name
      FROM media_items m
      LEFT JOIN users u ON u.id = m.uploader_user_id
      LEFT JOIN media_favorites f ON f.media_item_id = m.id AND f.user_id = ?
      WHERE m.channel_id = ? AND m.deleted_at IS NULL
    `;
    const params: any[] = [session.id, channelId];

    if (cursor) {
      query += ` AND m.captured_at < ?`;
      params.push(cursor);
    }

    if (favoritesOnly) {
      query += ` AND f.user_id IS NOT NULL`;
    }

    if (personId) {
      query += ` AND m.id IN (SELECT media_item_id FROM media_person_tags WHERE person_id = ?)`;
      params.push(personId);
    }

    if (locationId) {
      query += ` AND m.id IN (SELECT media_item_id FROM media_location_tags WHERE location_id = ?)`;
      params.push(locationId);
    }

    if (eventId) {
      query += ` AND m.id IN (SELECT media_item_id FROM media_event_tags WHERE event_id = ?)`;
      params.push(eventId);
    }

    query += ` ORDER BY m.captured_at DESC LIMIT ?`;
    params.push(limit);

    const items = await db.all(query, params);

    // Fetch tags for each item in batch
    for (const item of items) {
      item.people = await db.all(
        `SELECT p.id, p.name, t.bbox_x, t.bbox_y, t.bbox_w, t.bbox_h
         FROM media_person_tags t
         JOIN people p ON p.id = t.person_id
         WHERE t.media_item_id = ?`,
        [item.id]
      );
      item.locations = await db.all(
        `SELECT l.id, l.name, l.latitude, l.longitude, l.place_type
         FROM media_location_tags t
         JOIN locations l ON l.id = t.location_id
         WHERE t.media_item_id = ?`,
        [item.id]
      );
      item.events = await db.all(
        `SELECT e.id, e.name
         FROM media_event_tags t
         JOIN events e ON e.id = t.event_id
         WHERE t.media_item_id = ?`,
        [item.id]
      );
    }

    const nextCursor = items.length === limit ? items[items.length - 1].captured_at : null;

    return c.json({ items, nextCursor });
  } catch (error: any) {
    return c.json({ error: error.message || "Failed to fetch media" }, 500);
  }
});

import { CustomFile } from "telegram/client/uploads";

/**
 * POST /api/media/upload
 * Actually uploads photo/video file directly to Telegram channel via MTProto
 */
mediaRouter.post("/upload", async (c) => {
  try {
    const token = getCookie(c, "tg_session");
    if (!token) return c.json({ error: "Unauthorized" }, 401);

    const db = getDb((c.env as any)?.DB);
    const session = await db.get(
      `SELECT u.id, u.session_string FROM user_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > CURRENT_TIMESTAMP`,
      [token]
    );
    if (!session) return c.json({ error: "Unauthorized" }, 401);

    const formData = await c.req.formData();
    const file = formData.get("file") as File;
    const channelId = formData.get("channel_id") as string;
    const blurHash = (formData.get("blur_hash") as string) || "LEHV6nWB2yk8pyo0adR*.7kCMdnj";
    const capturedAt = (formData.get("captured_at") as string) || new Date().toISOString();
    const thumbnailBase64 = formData.get("thumbnail_base64") as string;

    if (!file || !channelId) {
      return c.json({ error: "File and channel_id are required" }, 400);
    }

    const channel = await db.get(
      `SELECT c.* FROM channels c
       JOIN user_channels uc ON uc.channel_id = c.id
       WHERE c.id = ? AND uc.user_id = ?`,
      [channelId, session.id]
    );

    if (!channel) {
      return c.json({ error: "Channel not found or unauthorized" }, 404);
    }

    const client = createTelegramClient(decryptSession(session.session_string));
    if (!client.connected) await client.connect();

    const arrayBuffer = await file.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuffer);
    const isVideo = file.type.startsWith("video/");

    console.log(`[MTProto] Uploading ${file.name} (${(file.size / (1024 * 1024)).toFixed(2)} MB) to TG channel ${channel.telegram_channel_id}...`);

    const customFile = new CustomFile(file.name, file.size, "", fileBuffer);
    
    // Resolve peer entity for Telegram
    let targetPeer: any = channel.telegram_channel_id;
    if (channel.telegram_channel_id === "me") {
      targetPeer = "me";
    } else {
      try {
        targetPeer = await client.getInputEntity(channel.telegram_channel_id);
      } catch {
        try {
          targetPeer = await client.getEntity(channel.telegram_channel_id);
        } catch (e) {
          targetPeer = channel.telegram_channel_id;
        }
      }
    }

    let sentMsg: any;
    try {
      sentMsg = await client.sendFile(targetPeer, {
        file: customFile,
        workers: 4,
        forceDocument: false,
      });
    } catch (sendErr: any) {
      if (sendErr?.errorMessage === "CHAT_WRITE_FORBIDDEN" || sendErr?.message?.includes("CHAT_WRITE_FORBIDDEN")) {
        return c.json(
          {
            error: "You do not have post/admin permissions in this Telegram channel. Please select 'Saved Messages' or a private channel/group you own.",
          },
          403
        );
      }
      throw sendErr;
    }

    const realMessageId = sentMsg.id;
    console.log(`[MTProto] Uploaded successfully! Message ID: ${realMessageId}`);

    // Extract dimensions
    let width = 1920;
    let height = 1080;
    let duration: number | null = isVideo ? 30 : null;

    if (sentMsg.photo) {
      const sizes = (sentMsg.photo as any).sizes;
      if (sizes && sizes.length > 0) {
        const largest = sizes[sizes.length - 1];
        if (largest.w && largest.h) {
          width = largest.w;
          height = largest.h;
        }
      }
    } else if (sentMsg.document) {
      const doc = sentMsg.document as any;
      const videoAttr = doc.attributes?.find((a: any) => a.w && a.h);
      if (videoAttr) {
        width = videoAttr.w;
        height = videoAttr.h;
        if (videoAttr.duration) duration = videoAttr.duration;
      }
    }

    const mediaId = crypto.randomUUID();
    let thumbnailR2Key: string | null = null;

    // Cache thumbnail in R2 / local cache
    if (thumbnailBase64) {
      const r2 = getR2Storage((c.env as any)?.R2_BUCKET);
      thumbnailR2Key = `thumbnails/${channelId}/${mediaId}.webp`;
      const thumbBuf = Buffer.from(thumbnailBase64.replace(/^data:image\/\w+;base64,/, ""), "base64");
      await r2.put(thumbnailR2Key, thumbBuf, "image/webp");
    }

    await db.run(
      `INSERT INTO media_items (
         id, channel_id, uploader_user_id, telegram_message_id, file_type,
         mime_type, file_size_bytes, width, height, duration_seconds,
         blur_hash, thumbnail_r2_key, captured_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(channel_id, telegram_message_id) DO UPDATE SET
         file_size_bytes = excluded.file_size_bytes,
         width = excluded.width,
         height = excluded.height,
         duration_seconds = excluded.duration_seconds`,
      [
        mediaId, channelId, session.id, realMessageId, isVideo ? "video" : "photo",
        file.type || (isVideo ? "video/mp4" : "image/jpeg"), file.size, width, height, duration,
        blurHash, thumbnailR2Key, capturedAt
      ]
    );

    // Emit Telegram WAL Event
    await emitGalleryEvent(client, targetPeer, realMessageId, "CREATE", {
      blur_hash: blurHash,
      captured_at: capturedAt,
    });

    return c.json({ success: true, mediaId, telegramMessageId: realMessageId });
  } catch (error: any) {
    console.error("[MTProto] Upload error:", error);
    return c.json({ error: error.message || "Failed uploading to Telegram" }, 500);
  }
});

/**
 * POST /api/media/:id/favorite
 * Toggles favorite state
 */
mediaRouter.post("/:id/favorite", async (c) => {
  try {
    const token = getCookie(c, "tg_session");
    if (!token) return c.json({ error: "Unauthorized" }, 401);

    const db = getDb((c.env as any)?.DB);
    const session = await db.get(
      `SELECT u.id, u.session_string FROM user_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > CURRENT_TIMESTAMP`,
      [token]
    );
    if (!session) return c.json({ error: "Unauthorized" }, 401);

    const mediaId = c.req.param("id");
    const existing = await db.get(
      "SELECT 1 FROM media_favorites WHERE user_id = ? AND media_item_id = ?",
      [session.id, mediaId]
    );

    const isFavorited = !existing;
    if (existing) {
      await db.run("DELETE FROM media_favorites WHERE user_id = ? AND media_item_id = ?", [session.id, mediaId]);
    } else {
      await db.run("INSERT INTO media_favorites (user_id, media_item_id) VALUES (?, ?)", [session.id, mediaId]);
    }

    // Emit WAL Event to Telegram channel in background
    try {
      const item = await db.get(
        `SELECT m.telegram_message_id, c.telegram_channel_id FROM media_items m
         JOIN channels c ON c.id = m.channel_id
         WHERE m.id = ?`,
        [mediaId]
      );
      if (item) {
        const client = await getConnectedClient(decryptSession(session.session_string));
        let targetPeer: any = item.telegram_channel_id;
        if (targetPeer !== "me") {
          try {
            targetPeer = await client.getInputEntity(targetPeer);
          } catch {}
        }
        await emitGalleryEvent(client, targetPeer, item.telegram_message_id, "FAVORITE", {
          fav: isFavorited,
        });
      }
    } catch (eventErr) {
      console.warn("[EventLedger] Failed emitting favorite event:", eventErr);
    }

    return c.json({ favorited: isFavorited });
  } catch (error: any) {
    return c.json({ error: error.message || "Failed to toggle favorite" }, 500);
  }
});

/**
 * GET /api/media/:id/thumbnail
 * Serves cached thumbnail from R2 or downloads from Telegram on-the-fly
 */
mediaRouter.get("/:id/thumbnail", async (c) => {
  try {
    const mediaId = c.req.param("id");
    const db = getDb((c.env as any)?.DB);
    const r2 = getR2Storage((c.env as any)?.R2_BUCKET);

    const item = await db.get(
      `SELECT m.*, c.telegram_channel_id FROM media_items m
       JOIN channels c ON c.id = m.channel_id
       WHERE m.id = ?`,
      [mediaId]
    );

    if (!item) return c.text("Not Found", 404);

    // 1. Check R2 Cache
    if (item.thumbnail_r2_key) {
      const cached = await r2.get(item.thumbnail_r2_key);
      if (cached) {
        return new Response(cached as any, {
          headers: {
            "Content-Type": "image/webp",
            "Cache-Control": "public, max-age=31536000, immutable",
          },
        });
      }
    }

    // 2. Fetch from Telegram on cache miss
    const token = getCookie(c, "tg_session");
    if (!token) return c.text("Unauthorized", 401);

    const userRow = await db.get(
      `SELECT u.session_string FROM user_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = ?`,
      [token]
    );

    if (!userRow) return c.text("Unauthorized", 401);

    const client = createTelegramClient(decryptSession(userRow.session_string));
    if (!client.connected) await client.connect();

    let targetPeer: any = item.telegram_channel_id;
    if (item.telegram_channel_id === "me") {
      targetPeer = "me";
    } else {
      try {
        targetPeer = await client.getInputEntity(item.telegram_channel_id);
      } catch {
        try {
          targetPeer = await client.getEntity(item.telegram_channel_id);
        } catch {}
      }
    }

    const messages = await client.getMessages(targetPeer, { ids: [item.telegram_message_id] });
    const msg = messages[0];

    if (!msg || !msg.media) return c.text("Media not found on Telegram", 404);

    const thumbBuffer = await client.downloadMedia(msg.media, {
      thumb: 1, // Small/Medium preview size
    });

    if (thumbBuffer && Buffer.isBuffer(thumbBuffer)) {
      const key = `thumbnails/${item.channel_id}/${item.id}.jpg`;
      await r2.put(key, thumbBuffer, "image/jpeg");
      await db.run("UPDATE media_items SET thumbnail_r2_key = ? WHERE id = ?", [key, item.id]);

      return new Response(thumbBuffer as any, {
        headers: {
          "Content-Type": "image/jpeg",
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    }

    return c.text("Failed to download thumbnail", 500);
  } catch (error: any) {
    return c.text(error.message || "Thumbnail error", 500);
  }
});
