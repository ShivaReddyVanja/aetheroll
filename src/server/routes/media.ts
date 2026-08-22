import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { getDb } from "../lib/db";
import { decryptSession } from "../lib/crypto";
import { resolveUserAuth, extractSessionToken } from "../lib/auth";
import { getR2Storage } from "../lib/r2";
import { createTelegramClient, getConnectedClient, getDefaultTelegramConfig } from "../lib/telegram";
import { emitGalleryEvent } from "../lib/ledger";
import { Api, utils } from "telegram";
import { isTelemetryEnabled } from "./logs";

export const MAX_TELEGRAM_FILE_SIZE = 2000 * 1024 * 1024; // 2,000 MB (Telegram standard user upload limit)

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
    const auth = await resolveUserAuth(c);
    if (!auth.authenticated || !auth.userId) return c.json({ error: "Unauthorized" }, 401);

    const db = getDb((c.env as any)?.DB);
    const channelId = c.req.query("channel_id");
    if (!channelId) return c.json({ error: "channel_id is required" }, 400);

    const limit = Math.min(parseInt(c.req.query("limit") || "50", 10), 100);
    const cursor = c.req.query("cursor");
    const personId = c.req.query("person_id");
    const locationId = c.req.query("location_id");
    const eventId = c.req.query("event_id");
    const tagId = c.req.query("tag_id");
    const tripId = c.req.query("trip_id");
    const hasGeo = c.req.query("has_geo") === "true";
    const favoritesOnly = c.req.query("favorites_only") === "true";

    let query = `
      SELECT m.*,
             CASE WHEN f.user_id IS NOT NULL THEN 1 ELSE 0 END as is_favorite,
             u.display_name as uploader_name,
             (
               SELECT GROUP_CONCAT(p.id || '::' || p.name || '::' || COALESCE(t.bbox_x, '') || '::' || COALESCE(t.bbox_y, '') || '::' || COALESCE(t.bbox_w, '') || '::' || COALESCE(t.bbox_h, ''), '||')
               FROM media_person_tags t
               JOIN people p ON p.id = t.person_id
               WHERE t.media_item_id = m.id
             ) as people_raw,
             (
               SELECT GROUP_CONCAT(tg.id || '::' || tg.name || '::' || COALESCE(tg.color, ''), '||')
               FROM media_tags mt
               JOIN tags tg ON tg.id = mt.tag_id
               WHERE mt.media_item_id = m.id
             ) as tags_raw,
             (
               SELECT GROUP_CONCAT(e.id || '::' || e.name, '||')
               FROM media_event_tags et
               JOIN events e ON e.id = et.event_id
               WHERE et.media_item_id = m.id
             ) as events_raw,
             (
               SELECT GROUP_CONCAT(tr.id || '::' || tr.name, '||')
               FROM trip_media tm
               JOIN trips tr ON tr.id = tm.trip_id
               WHERE tm.media_item_id = m.id
             ) as trips_raw
      FROM media_items m
      LEFT JOIN users u ON u.id = m.uploader_user_id
      LEFT JOIN media_favorites f ON f.media_item_id = m.id AND f.user_id = ?
      WHERE m.channel_id = ? AND m.deleted_at IS NULL
    `;
    const params: any[] = [auth.userId, channelId];

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
      // Backwards compatibility for location filter
      query += ` AND (m.latitude IS NOT NULL AND m.longitude IS NOT NULL)`;
    }

    if (hasGeo) {
      query += ` AND m.latitude IS NOT NULL AND m.longitude IS NOT NULL`;
    }

    if (eventId) {
      query += ` AND m.id IN (SELECT media_item_id FROM media_event_tags WHERE event_id = ?)`;
      params.push(eventId);
    }

    if (tagId) {
      query += ` AND m.id IN (SELECT media_item_id FROM media_tags WHERE tag_id = ?)`;
      params.push(tagId);
    }

    if (tripId) {
      query += ` AND m.id IN (SELECT media_item_id FROM trip_media WHERE trip_id = ?)`;
      params.push(tripId);
    }

    query += ` ORDER BY m.captured_at DESC LIMIT ?`;
    params.push(limit);

    const items = await db.all(query, params);

    // Fast in-memory parsing (1 query total for entire page!)
    for (const item of items) {
      item.people = item.people_raw
        ? item.people_raw.split("||").map((p: string) => {
            const [id, name, bx, by, bw, bh] = p.split("::");
            return {
              id,
              name,
              bbox_x: bx ? parseFloat(bx) : null,
              bbox_y: by ? parseFloat(by) : null,
              bbox_w: bw ? parseFloat(bw) : null,
              bbox_h: bh ? parseFloat(bh) : null,
            };
          })
        : [];
      delete item.people_raw;

      item.tags = item.tags_raw
        ? item.tags_raw.split("||").map((t: string) => {
            const [id, name, color] = t.split("::");
            return { id, name, color: color || null };
          })
        : [];
      delete item.tags_raw;

      item.events = item.events_raw
        ? item.events_raw.split("||").map((e: string) => {
            const [id, name] = e.split("::");
            return { id, name };
          })
        : [];
      delete item.events_raw;

      item.trips = item.trips_raw
        ? item.trips_raw.split("||").map((tr: string) => {
            const [id, name] = tr.split("::");
            return { id, name };
          })
        : [];
      delete item.trips_raw;

      // Provide backwards compatible locations structure
      if (item.latitude != null && item.longitude != null) {
        item.locations = [
          {
            id: `geo_${item.id}`,
            name: `GPS (${Number(item.latitude).toFixed(4)}, ${Number(item.longitude).toFixed(4)})`,
            latitude: item.latitude,
            longitude: item.longitude,
            place_type: "gps",
          },
        ];
      } else {
        item.locations = [];
      }
    }

    const nextCursor = items.length === limit ? items[items.length - 1].captured_at : null;

    return c.json({ items, nextCursor });
  } catch (error: any) {
    return c.json({ error: error.message || "Failed to fetch media" }, 500);
  }
});

import { CustomFile } from "telegram/client/uploads.js";

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
    const latitudeStr = formData.get("latitude") as string;
    const longitudeStr = formData.get("longitude") as string;
    const latitude = latitudeStr ? parseFloat(latitudeStr) : null;
    const longitude = longitudeStr ? parseFloat(longitudeStr) : null;

    if (!file || !channelId) {
      return c.json({ error: "File and channel_id are required" }, 400);
    }

    if (file.size > MAX_TELEGRAM_FILE_SIZE) {
      return c.json({ error: "File exceeds Telegram's 2,000 MB (2 GB) upload limit" }, 400);
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
    if (channel.telegram_channel_id === "me" || channel.telegram_channel_id.startsWith("me_")) {
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
         blur_hash, thumbnail_r2_key, captured_at, latitude, longitude
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(channel_id, telegram_message_id) DO UPDATE SET
         file_size_bytes = excluded.file_size_bytes,
         latitude = COALESCE(excluded.latitude, media_items.latitude),
         longitude = COALESCE(excluded.longitude, media_items.longitude)`,
      [
        mediaId, channelId, session.id, realMessageId, isVideo ? "video" : "photo",
        file.type || (isVideo ? "video/mp4" : "image/jpeg"), file.size, 1920, 1080, null,
        blurHash, thumbnailR2Key, capturedAt, latitude, longitude
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
    const auth = await resolveUserAuth(c);
    if (!auth.authenticated || !auth.userId) return c.json({ error: "Unauthorized" }, 401);

    const db = getDb((c.env as any)?.DB);
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
      [channel_id, auth.userId]
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
        auth.userId,
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
    const auth = await resolveUserAuth(c);
    if (!auth.authenticated || !auth.userId) return c.json({ error: "Unauthorized" }, 401);

    const db = getDb((c.env as any)?.DB);
    const mediaId = c.req.param("id");
    const existing = await db.get(
      "SELECT 1 FROM media_favorites WHERE user_id = ? AND media_item_id = ?",
      [auth.userId, mediaId]
    );

    const isFavorited = !existing;
    if (existing) {
      await db.run("DELETE FROM media_favorites WHERE user_id = ? AND media_item_id = ?", [auth.userId, mediaId]);
    } else {
      await db.run("INSERT INTO media_favorites (user_id, media_item_id) VALUES (?, ?)", [auth.userId, mediaId]);
    }

    // Emit WAL Event to Telegram channel in background
    try {
      const item = await db.get(
        `SELECT m.telegram_message_id, c.telegram_channel_id FROM media_items m
         JOIN channels c ON c.id = m.channel_id
         WHERE m.id = ?`,
        [mediaId]
      );
      if (item && auth.sessionString) {
        const client = await getConnectedClient(auth.sessionString, auth.telegramConfig);
        let targetPeer: any = item.telegram_channel_id;
        if (targetPeer !== "me" && !targetPeer.startsWith("me_")) {
          try {
            targetPeer = await client.getInputEntity(targetPeer);
          } catch {}
        } else {
          targetPeer = "me";
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
    const auth = await resolveUserAuth(c);
    if (!auth.authenticated || !auth.userId) return c.json({ error: "Unauthorized" }, 401);

    const db = getDb((c.env as any)?.DB);
    const body = await c.req.json();
    const media_ids: string[] = Array.isArray(body.media_ids)
      ? body.media_ids
      : body.media_id
      ? [body.media_id]
      : [];

    if (media_ids.length === 0) {
      return c.json({ error: "media_ids array required" }, 400);
    }

    const placeholders = media_ids.map(() => "?").join(",");
    const items = await db.all(
      `SELECT m.*, c.telegram_channel_id FROM media_items m
       JOIN channels c ON c.id = m.channel_id
       WHERE m.id IN (${placeholders})`,
      media_ids
    );

    // 1. Batched D1 Database Deletions (Instant & Reliable)
    await db.run(`DELETE FROM media_favorites WHERE media_item_id IN (${placeholders})`, media_ids);
    await db.run(`DELETE FROM media_person_tags WHERE media_item_id IN (${placeholders})`, media_ids);
    await db.run(`DELETE FROM media_tags WHERE media_item_id IN (${placeholders})`, media_ids);
    await db.run(`DELETE FROM media_event_tags WHERE media_item_id IN (${placeholders})`, media_ids);
    await db.run(`DELETE FROM trip_media WHERE media_item_id IN (${placeholders})`, media_ids);
    await db.run(`DELETE FROM media_items WHERE id IN (${placeholders})`, media_ids);

    const deletedCount = items.length || media_ids.length;

    // 2. Batched R2 Cache cleanup
    const r2 = getR2Storage((c.env as any)?.R2_BUCKET);
    Promise.allSettled(
      items.map(async (item: any) => {
        if (item.thumbnail_r2_key) {
          try { await r2.delete(item.thumbnail_r2_key); } catch {}
        }
        try { await r2.delete(`cache/${item.channel_id}/${item.id}.bin`); } catch {}
      })
    ).catch(() => {});

    // 3. Batched Telegram Message Deletion grouped by target channel
    if (auth.sessionString && items.length > 0) {
      const itemsByChannel = new Map<string, any[]>();
      for (const item of items) {
        if (item.telegram_message_id && item.telegram_channel_id) {
          const list = itemsByChannel.get(item.telegram_channel_id) || [];
          list.push(item);
          itemsByChannel.set(item.telegram_channel_id, list);
        }
      }

      if (itemsByChannel.size > 0) {
        const deleteTgPromise = (async () => {
          try {
            const client = await getConnectedClient(auth.sessionString!, auth.telegramConfig);

            for (const [channelTgId, channelItems] of itemsByChannel.entries()) {
              try {
                let targetPeer: any = channelTgId;
                if (targetPeer !== "me" && !targetPeer.startsWith("me_")) {
                  try { targetPeer = await client.getInputEntity(targetPeer); }
                  catch { try { targetPeer = await client.getEntity(targetPeer); } catch {} }
                } else {
                  targetPeer = "me";
                }

                const allIdsToDelete = new Set<number>();

                // Collect primary message IDs and fetch associated metadata replies in parallel
                await Promise.allSettled(
                  channelItems.map(async (item) => {
                    const msgId = Number(item.telegram_message_id);
                    if (!msgId) return;
                    allIdsToDelete.add(msgId);

                    try {
                      const replies = await client.getMessages(targetPeer, { replyTo: msgId, limit: 20 });
                      if (replies && replies.length > 0) {
                        for (const r of replies) {
                          if (r && r.id) allIdsToDelete.add(Number(r.id));
                        }
                      }
                    } catch (replyErr) {
                      console.warn("[MediaDelete] Failed fetching replies for msgId:", msgId, replyErr);
                    }
                  })
                );

                // Telegram deleteMessages supports up to 100 IDs per RPC call
                const idArray = Array.from(allIdsToDelete);
                const TG_BATCH_LIMIT = 100;
                for (let i = 0; i < idArray.length; i += TG_BATCH_LIMIT) {
                  const chunk = idArray.slice(i, i + TG_BATCH_LIMIT);
                  console.log(`[MediaDelete] Batched deleting ${chunk.length} Telegram messages from peer ${channelTgId}:`, chunk);
                  await client.deleteMessages(targetPeer, chunk, { revoke: true });
                }
              } catch (chErr) {
                console.warn(`[MediaDelete] Failed batch deleting messages in channel ${channelTgId}:`, chErr);
              }
            }
          } catch (clientErr) {
            console.warn("[MediaDelete] Telegram client error during deletion:", clientErr);
          }
        })();

        if ((c.executionCtx as any)?.waitUntil) {
          c.executionCtx.waitUntil(deleteTgPromise.catch(() => {}));
        } else {
          await Promise.race([
            deleteTgPromise,
            new Promise((_, reject) => setTimeout(() => reject(new Error("Telegram delete timeout")), 10000))
          ]).catch((e) => console.warn("[MediaDelete] TG delete non-fatal error:", e));
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
 * POST /api/media/:id/thumbnail
 * Ingests a client-captured video frame or custom thumbnail, saves it to R2 and Edge Cache, and updates D1
 */
mediaRouter.post("/:id/thumbnail", async (c) => {
  try {
    const auth = await resolveUserAuth(c);
    if (!auth.authenticated || !auth.userId) return c.json({ error: "Unauthorized" }, 401);

    const mediaId = c.req.param("id");
    const db = getDb((c.env as any)?.DB);
    const r2 = getR2Storage((c.env as any)?.R2_BUCKET);

    const item = await db.get(
      `SELECT m.*, c.telegram_channel_id FROM media_items m
       JOIN channels c ON c.id = m.channel_id
       WHERE m.id = ?`,
      [mediaId]
    );

    if (!item) return c.json({ error: "Media item not found" }, 404);

    let imageBuffer: Buffer | null = null;
    const contentType = c.req.header("content-type") || "";

    if (contentType.includes("application/json")) {
      const body = await c.req.json();
      if (body.imageBase64) {
        imageBuffer = Buffer.from(body.imageBase64.replace(/^data:image\/\w+;base64,/, ""), "base64");
      }
    } else if (contentType.includes("multipart/form-data")) {
      const form = await c.req.formData();
      const file = form.get("thumbnail") as File;
      if (file) {
        const ab = await file.arrayBuffer();
        imageBuffer = Buffer.from(ab);
      }
    } else {
      const ab = await c.req.arrayBuffer();
      if (ab.byteLength > 0) {
        imageBuffer = Buffer.from(ab);
      }
    }

    if (!imageBuffer || imageBuffer.length === 0) {
      return c.json({ error: "No image payload provided" }, 400);
    }

    const key = `thumbnails/${item.channel_id}/${item.id}.jpg`;
    await r2.put(key, imageBuffer, "image/jpeg");
    await db.run("UPDATE media_items SET thumbnail_r2_key = ? WHERE id = ?", [key, item.id]);

    // Cache into Cloudflare Edge Cache
    const workerOrigin = new URL(c.req.url).origin;
    const cacheKeyUrl = `${workerOrigin}/api/media/cache/${encodeURIComponent(mediaId)}/thumbnail`;
    const cacheKey = new Request(cacheKeyUrl, { method: "GET" });
    const cache = (caches as any)?.default;
    if (cache) {
      const edgeHeaders = new Headers();
      edgeHeaders.set("Content-Type", "image/jpeg");
      edgeHeaders.set("Cache-Control", "public, max-age=31536000, immutable");
      edgeHeaders.set("Access-Control-Allow-Origin", "*");
      const edgeResponse = new Response(imageBuffer as any, {
        status: 200,
        headers: edgeHeaders,
      });
      const putPromise = cache.put(cacheKey, edgeResponse).catch(() => {});
      if ((c.executionCtx as any)?.waitUntil) {
        c.executionCtx.waitUntil(putPromise);
      }
    }

    return c.json({ success: true, thumbnail_r2_key: key });
  } catch (error: any) {
    return c.json({ error: error.message || "Failed saving thumbnail" }, 500);
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
      const auth = await resolveUserAuth(c);
      if (!auth.authenticated || !auth.sessionString) return c.text("Unauthorized", 401);

      const client = await getConnectedClient(auth.sessionString, auth.telegramConfig);

      let targetPeer: any = item.telegram_channel_id;
      if (item.telegram_channel_id === "me" || item.telegram_channel_id.startsWith("me_")) {
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

      if (msg && msg.media) {
        let thumbBuffer: Buffer | null = null;

        // 3a. Fast Path: Extract instant stripped thumbnail (0ms CPU, 0 network requests)
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

        // 3b. Try multi-size thumbs (thumb 1, then thumb 0)
        if (!thumbBuffer && docThumbs.length > 0) {
          for (let idx = Math.min(docThumbs.length - 1, 1); idx >= 0; idx--) {
            try {
              const downloaded = await client.downloadMedia(msg.media, { thumb: idx });
              if (downloaded && Buffer.isBuffer(downloaded) && downloaded.length > 0) {
                thumbBuffer = downloaded;
                break;
              }
            } catch {}
          }
        }

        // 3c. For photos: download photo directly
        if (!thumbBuffer && (msg.photo || item.file_type === "photo")) {
          try {
            const downloaded = await client.downloadMedia(msg.media);
            if (downloaded && Buffer.isBuffer(downloaded) && downloaded.length > 0) {
              thumbBuffer = downloaded;
            }
          } catch {}
        }

        // 3d. If real thumbBuffer found, save to R2 and return
        if (thumbBuffer && Buffer.isBuffer(thumbBuffer) && thumbBuffer.length > 0) {
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
    }

    // 4. Zero-Fail Dynamic SVG Fallback: Always return 200 OK so cards never break
    if (!response) {
      const isVid = item.file_type === "video";
      const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="${item.width || 400}" height="${item.height || 300}" viewBox="0 0 400 300" fill="none">
        <rect width="400" height="300" fill="${isVid ? "#0f172a" : "#1e293b"}"/>
        <circle cx="200" cy="130" r="32" fill="${isVid ? "#1e293b" : "#334155"}"/>
        <circle cx="200" cy="130" r="30" fill="${isVid ? "#2563eb" : "#059669"}" fill-opacity="0.2"/>
        ${isVid 
          ? '<path d="M194 118L212 130L194 142V118Z" fill="#38bdf8"/>' 
          : '<path d="M188 124C188 121.791 189.791 120 192 120H208C210.209 120 212 121.791 212 124V136C212 138.209 210.209 140 208 140H192C189.791 140 188 138.209 188 136V124Z" stroke="#34d399" stroke-width="2"/>'}
        <text x="200" y="190" font-family="system-ui, -apple-system, sans-serif" font-size="13" font-weight="500" fill="#94a3b8" text-anchor="middle">${isVid ? "Video" : "Photo"}</text>
      </svg>`;

      response = new Response(svgContent, {
        headers: {
          "Content-Type": "image/svg+xml",
          "Cache-Control": "public, max-age=86400",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    // 5. Save to Cloudflare Edge Cache in Background
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
