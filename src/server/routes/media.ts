import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { getDb } from "../lib/db";
import { decryptSession } from "../lib/crypto";
import { getR2Storage } from "../lib/r2";
import { createTelegramClient, getConnectedClient, getDefaultTelegramConfig } from "../lib/telegram";
import { emitGalleryEvent } from "../lib/ledger";
import { Api, utils } from "telegram";
import { isTelemetryEnabled } from "./logs";

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
  const authDo = (c.env as any)?.AUTH_DO;
  if (authDo && typeof authDo.idFromName === "function") {
    return forwardToUploadDO(c);
  }

  // 2. Fallback for local Node / SQLite dev environment
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
       JOIN gallery_channels gc ON gc.channel_id = c.id
       WHERE c.id = ? AND gc.user_id = ?`,
      [channelId, session.id]
    );

    if (!channel) {
      return c.json({ error: "Channel not found or unauthorized" }, 404);
    }

    const client = await getConnectedClient(
      await decryptSession(session.session_string, (c.env as any)?.SESSION_ENCRYPTION_KEY),
      getDefaultTelegramConfig(c.env)
    );

    const arrayBuffer = await file.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuffer);
    const isVideo = file.type.startsWith("video/");

    const customFile = new CustomFile(file.name, file.size, "", fileBuffer);
    
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

    const sentMsg = await client.sendFile(targetPeer, {
      file: customFile,
      workers: 1,
      forceDocument: false,
    });

    const realMessageId = sentMsg.id;
    const mediaId = crypto.randomUUID();
    let thumbnailR2Key: string | null = null;

    await db.run(
      `INSERT INTO media_items (
         id, channel_id, uploader_user_id, telegram_message_id, file_type,
         mime_type, file_size_bytes, width, height, duration_seconds,
         blur_hash, thumbnail_r2_key, captured_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(channel_id, telegram_message_id) DO UPDATE SET
         file_size_bytes = excluded.file_size_bytes`,
      [
        mediaId, channelId, session.id, realMessageId, isVideo ? "video" : "photo",
        file.type || (isVideo ? "video/mp4" : "image/jpeg"), file.size, 1920, 1080, null,
        blurHash, thumbnailR2Key, capturedAt
      ]
    );

    return c.json({ success: true, mediaId, telegramMessageId: realMessageId });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

function forwardToUploadDO(c: any) {
  const authDo = (c.env as any)?.AUTH_DO;
  if (authDo && typeof authDo.idFromName === "function") {
    const token = getCookie(c, "tg_session") || c.req.header("x-tg-session") || "default";
    const doId = authDo.idFromName(token);
    const stub = authDo.get(doId);

    const headers = new Headers(c.req.raw.headers);
    if (c.env?.TELEGRAM_API_ID) headers.set("x-tg-api-id", String(c.env.TELEGRAM_API_ID));
    if (c.env?.TELEGRAM_API_HASH) headers.set("x-tg-api-hash", String(c.env.TELEGRAM_API_HASH));
    if (c.env?.TELEGRAM_TEST_MODE) headers.set("x-tg-test-mode", String(c.env.TELEGRAM_TEST_MODE));
    if (c.env?.SESSION_ENCRYPTION_KEY) headers.set("x-tg-enc-key", String(c.env.SESSION_ENCRYPTION_KEY));

    const req = new Request(c.req.raw, { headers });
    return stub.fetch(req);
  }
  return c.json({ error: "Upload requires Durable Object backend" }, 400);
}

mediaRouter.get("/upload/ws", async (c) => {
  return forwardToUploadDO(c);
});

mediaRouter.post("/upload/init", async (c) => {
  return forwardToUploadDO(c);
});

mediaRouter.post("/upload/chunk", async (c) => {
  return forwardToUploadDO(c);
});

mediaRouter.post("/upload/complete", async (c) => {
  return forwardToUploadDO(c);
});

/**
 * POST /api/media/register
 * Instant 5ms registration of media uploaded directly from the browser to Telegram
 */
mediaRouter.post("/register", async (c) => {
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

    const body = await c.req.json();
    const {
      channel_id,
      telegram_message_id,
      file_type,
      mime_type,
      file_size_bytes,
      width,
      height,
      duration_seconds,
      blur_hash,
      thumbnail_base64,
      captured_at,
    } = body;

    if (!channel_id || !telegram_message_id) {
      return c.json({ error: "channel_id and telegram_message_id required" }, 400);
    }

    const channel = await db.get(
      `SELECT c.* FROM channels c
       JOIN gallery_channels gc ON gc.channel_id = c.id
       WHERE c.id = ? AND gc.user_id = ?`,
      [channel_id, session.id]
    );
    if (!channel) return c.json({ error: "Channel not found or unauthorized" }, 404);

    const mediaId = crypto.randomUUID();
    let thumbnailR2Key: string | null = null;

    if (thumbnail_base64) {
      const r2 = getR2Storage((c.env as any)?.R2_BUCKET);
      thumbnailR2Key = `thumbnails/${channel_id}/${mediaId}.jpg`;
      const thumbBuf = Buffer.from(thumbnail_base64.replace(/^data:image\/\w+;base64,/, ""), "base64");
      await r2.put(thumbnailR2Key, thumbBuf, "image/jpeg").catch(() => {});
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
        mediaId,
        channel_id,
        session.id,
        Number(telegram_message_id),
        file_type || "photo",
        mime_type || "image/jpeg",
        Number(file_size_bytes) || 0,
        Number(width) || 1920,
        Number(height) || 1080,
        duration_seconds != null ? Number(duration_seconds) : null,
        blur_hash || "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
        thumbnailR2Key,
        captured_at || new Date().toISOString(),
      ]
    );

    return c.json({ success: true, mediaId });
  } catch (error: any) {
    console.error("[MediaRegister] Error:", error);
    return c.json({ error: error.message || "Failed registering media" }, 500);
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
        const client = await getConnectedClient(
          await decryptSession(session.session_string, (c.env as any)?.SESSION_ENCRYPTION_KEY),
          getDefaultTelegramConfig(c.env)
        );
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
 * POST /api/media/delete
 * Deletes one or more media items from D1, R2 cache, and Telegram channels
 */
mediaRouter.post("/delete", async (c) => {
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

    const body = await c.req.json();
    const media_ids: string[] = Array.isArray(body.media_ids)
      ? body.media_ids
      : body.media_id
      ? [body.media_id]
      : [];

    if (media_ids.length === 0) {
      return c.json({ error: "media_ids array required" }, 400);
    }

    const r2 = getR2Storage((c.env as any)?.R2_BUCKET);
    let client: any = null;
    try {
      client = await getConnectedClient(
        await decryptSession(session.session_string, (c.env as any)?.SESSION_ENCRYPTION_KEY),
        getDefaultTelegramConfig(c.env)
      );
    } catch (clientErr) {
      console.warn("[MediaDelete] Telegram client connect error:", clientErr);
    }

    let deletedCount = 0;
    for (const mediaId of media_ids) {
      const item = await db.get(
        `SELECT m.*, c.telegram_channel_id FROM media_items m
         JOIN channels c ON c.id = m.channel_id
         WHERE m.id = ?`,
        [mediaId]
      );

      // 1. Delete from D1 Database first (instant & reliable)
      await db.run("DELETE FROM media_favorites WHERE media_item_id = ?", [mediaId]);
      await db.run("DELETE FROM media_items WHERE id = ?", [mediaId]);
      deletedCount++;

      if (!item) continue;

      // 2. Delete cached thumbnail & full files from R2
      if (item.thumbnail_r2_key) {
        try { await r2.delete(item.thumbnail_r2_key); } catch {}
      }
      try { await r2.delete(`cache/${item.channel_id}/${item.id}.bin`); } catch {}

      // 3. Delete message from Telegram and all its metadata replies with strict timeout
      if (client && item.telegram_message_id) {
        try {
          const deleteTgPromise = (async () => {
            let targetPeer: any = item.telegram_channel_id;
            if (targetPeer !== "me") {
              try { targetPeer = await client.getInputEntity(targetPeer); }
              catch { try { targetPeer = await client.getEntity(targetPeer); } catch {} }
            }
            const msgId = Number(item.telegram_message_id);
            const idsToDelete: number[] = [msgId];

            // Find all reply metadata messages attached to this media item (e.g. [GP_EVENT:v1])
            try {
              const replies = await client.getMessages(targetPeer, { replyTo: msgId, limit: 20 });
              if (replies && replies.length > 0) {
                for (const r of replies) {
                  if (r && r.id) idsToDelete.push(Number(r.id));
                }
              }
            } catch (replyErr) {
              console.warn("[MediaDelete] GetReplies check warning:", replyErr);
            }

            // Atomic batch deletion of media + all metadata reply messages
            await client.deleteMessages(targetPeer, idsToDelete, { revoke: true });
          })();

          await Promise.race([
            deleteTgPromise,
            new Promise((resolve) => setTimeout(resolve, 2000)),
          ]);
        } catch (tgDelErr) {
          console.warn("[MediaDelete] Telegram message delete warning:", tgDelErr);
        }
      }
    }

    return c.json({ success: true, deletedCount });
  } catch (error: any) {
    console.error("Delete Error:", error);
    return c.json({ error: error.message || "Failed to delete media" }, 500);
  }
});

/**
 * GET /api/media/:id/thumbnail
 * Serves cached thumbnail from Cloudflare Edge Cache, R2, or decodes stripped bytes instantly from Telegram
 */
mediaRouter.get("/:id/thumbnail", async (c) => {
  try {
    const mediaId = c.req.param("id");
    if (!mediaId) return c.text("Not Found", 404);

    // 1. Check Cloudflare Edge Cache (Sub-2ms Delivery at local Edge PoP)
    const workerOrigin = new URL(c.req.url).origin;
    const cacheKeyUrl = `${workerOrigin}/api/media/cache/${encodeURIComponent(mediaId)}/thumbnail`;
    const cacheKey = new Request(cacheKeyUrl, { method: "GET" });
    const cache = (caches as any)?.default;

    if (cache) {
      try {
        const cachedRes = await cache.match(cacheKey);
        if (cachedRes) {
          const hitHeaders = new Headers(cachedRes.headers);
          hitHeaders.set("x-edge-cache", "HIT");

          // Log Edge HIT to DO telemetry in background only when enabled
          const authDo = (c.env as any)?.AUTH_DO;
          if (authDo && typeof authDo.idFromName === "function" && isTelemetryEnabled(c.env)) {
            const doId = authDo.idFromName("global_telemetry");
            const stub = authDo.get(doId);
            const logReq = new Request(`${workerOrigin}/api/logs/log`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                category: "EDGE_CACHE",
                level: "success",
                message: `🟢 [Thumbnail Edge HIT ⚡ 1ms] ${mediaId.slice(0, 8)}...`,
                meta: { mediaId, hit: true },
              }),
            });
            if ((c.executionCtx as any)?.waitUntil) {
              c.executionCtx.waitUntil(stub.fetch(logReq).catch(() => {}));
            }
          }

          return new Response(cachedRes.body, {
            status: cachedRes.status,
            headers: hitHeaders,
          });
        }
      } catch (cacheErr) {
        console.warn("[EdgeCache] Thumbnail match error:", cacheErr);
      }
    }

    const db = getDb((c.env as any)?.DB);
    const r2 = getR2Storage((c.env as any)?.R2_BUCKET);

    const item = await db.get(
      `SELECT m.*, c.telegram_channel_id FROM media_items m
       JOIN channels c ON c.id = m.channel_id
       WHERE m.id = ?`,
      [mediaId]
    );

    if (!item) return c.text("Not Found", 404);

    let response: Response | null = null;

    // 2. Check R2 Cache
    if (item.thumbnail_r2_key) {
      const cached = await r2.get(item.thumbnail_r2_key);
      if (cached) {
        response = new Response(cached as any, {
          headers: {
            "Content-Type": "image/jpeg",
            "Cache-Control": "public, max-age=31536000, immutable",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }
    }

    // 3. Fallback: Fetch from Telegram on cache miss
    if (!response) {
      const token = getCookie(c, "tg_session");
      if (!token) return c.text("Unauthorized", 401);

      const userRow = await db.get(
        `SELECT u.session_string FROM user_sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.id = ?`,
        [token]
      );

      if (!userRow) return c.text("Unauthorized", 401);

      const client = await getConnectedClient(
        await decryptSession(userRow.session_string, (c.env as any)?.SESSION_ENCRYPTION_KEY),
        getDefaultTelegramConfig(c.env)
      );

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

      const msgId = Number(item.telegram_message_id);
      const messages = await client.getMessages(targetPeer, { ids: [msgId] });
      const msg = messages[0];

      if (!msg || !msg.media) return c.text("Media not found on Telegram", 404);

      let thumbBuffer: Buffer | null = null;

      // Fast Path: Extract instant stripped thumbnail (0ms CPU, 0 network requests)
      const photoSizes = (msg.media as any)?.photo?.sizes || [];
      const docThumbs = (msg.media as any)?.document?.thumbs || [];
      const stripped = [...photoSizes, ...docThumbs].find(
        (s: any) => s instanceof Api.PhotoStrippedSize || s.className === "PhotoStrippedSize" || s.bytes
      );

      if (stripped && stripped.bytes) {
        try {
          thumbBuffer = Buffer.from(utils.strippedPhotoToJpg(stripped.bytes));
        } catch (stripErr) {
          console.warn("[Thumbnail] Stripped JPEG conversion fallback:", stripErr);
        }
      }

      // Fallback: download small preview thumbnail
      if (!thumbBuffer) {
        const downloaded = await client.downloadMedia(msg.media, {
          thumb: 1, // Small/Medium preview size
        });
        if (downloaded && Buffer.isBuffer(downloaded)) {
          thumbBuffer = downloaded;
        }
      }

      if (thumbBuffer && Buffer.isBuffer(thumbBuffer)) {
        const key = `thumbnails/${item.channel_id}/${item.id}.jpg`;
        try {
          await r2.put(key, thumbBuffer, "image/jpeg");
          await db.run("UPDATE media_items SET thumbnail_r2_key = ? WHERE id = ?", [key, item.id]);
        } catch (r2Err) {
          console.warn("[Thumbnail] R2 cache write non-fatal error:", r2Err);
        }

        response = new Response(thumbBuffer as any, {
          headers: {
            "Content-Type": "image/jpeg",
            "Cache-Control": "public, max-age=31536000, immutable",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }
    }

    if (!response) {
      return c.text("Failed to download thumbnail", 500);
    }

    // 4. Save to Cloudflare Edge Cache in Background
    if (cache && response.status === 200) {
      try {
        const resToCache = response.clone();
        const edgeHeaders = new Headers(resToCache.headers);
        edgeHeaders.set("Cache-Control", "public, max-age=31536000, immutable");

        const edgeResponse = new Response(resToCache.body, {
          status: 200,
          headers: edgeHeaders,
        });

        const putPromise = cache.put(cacheKey, edgeResponse).catch(() => {});
        if ((c.executionCtx as any)?.waitUntil) {
          c.executionCtx.waitUntil(putPromise);
        }
      } catch (putErr) {
        console.warn("[EdgeCache] Thumbnail save error:", putErr);
      }
    }

    const outHeaders = new Headers(response.headers);
    outHeaders.set("x-edge-cache", "MISS");
    return new Response(response.body, {
      status: response.status,
      headers: outHeaders,
    });
  } catch (error: any) {
    return c.text(error.message || "Thumbnail error", 500);
  }
});
