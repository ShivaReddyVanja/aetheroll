import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import crypto from "crypto";
import { Api } from "telegram";
import { CustomFile, uploadFile } from "telegram/client/uploads.js";
import { getDb } from "../../lib/db.ts";
import { decryptSession, generateAetherollSignature } from "../../lib/crypto.ts";
import { resolveUserAuth } from "../../lib/auth.ts";
import { getR2Storage } from "../../lib/r2.ts";
import { getConnectedClient, getDefaultTelegramConfig } from "../../lib/telegram.ts";
import { MAX_TELEGRAM_FILE_SIZE } from "./types.ts";

export const uploadMediaRoute = new Hono();

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

uploadMediaRoute.get("/upload/ws", async (c) => {
  return forwardToUploadDO(c);
});

uploadMediaRoute.post("/upload/init", async (c) => {
  return forwardToUploadDO(c);
});

uploadMediaRoute.post("/upload/chunk", async (c) => {
  return forwardToUploadDO(c);
});

uploadMediaRoute.post("/upload/complete", async (c) => {
  return forwardToUploadDO(c);
});

/**
 * POST /upload
 * Directly uploads photo/video file to Telegram channel via MTProto
 */
uploadMediaRoute.post("/upload", async (c) => {
  const authDo = (c.env as any)?.AUTH_DO;
  if (authDo && typeof authDo.idFromName === "function") {
    return forwardToUploadDO(c);
  }

  // Fallback for local Node / SQLite dev environment
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

    const nowSeconds = Math.floor(Date.now() / 1000);
    const signature = await generateAetherollSignature(
      file.size,
      nowSeconds,
      (c.env as any)?.SESSION_ENCRYPTION_KEY
    );

    const inputFile = await uploadFile(client, {
      file: customFile,
      workers: 4,
      maxBufferSize: 2 * 1024 * 1024 * 1024,
    });

    const sentMsg = await client.sendFile(targetPeer, {
      file: inputFile,
      caption: signature,
      forceDocument: true,
      attributes: [
        new Api.DocumentAttributeFilename({
          fileName: file.name,
        }),
        ...(isVideo
          ? [
              new Api.DocumentAttributeVideo({
                duration: 0,
                w: 1920,
                h: 1080,
                supportsStreaming: true,
              }),
            ]
          : [
              new Api.DocumentAttributeImageSize({
                w: 1920,
                h: 1080,
              }),
            ]),
      ],
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

/**
 * POST /register
 * Registration of media uploaded directly from the browser to Telegram
 */
uploadMediaRoute.post("/register", async (c) => {
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
