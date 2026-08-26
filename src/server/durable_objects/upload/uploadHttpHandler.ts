import crypto from "crypto";
import { Api, helpers } from "telegram";
import { CustomFile } from "telegram/client/uploads.js";
import { getDb } from "../../lib/db.ts";
import { getR2Storage } from "../../lib/r2.ts";
import { generateAetherollSignature } from "../../lib/crypto.ts";
import { emitGalleryEvent } from "../../lib/ledger.ts";
import { MAX_TELEGRAM_FILE_SIZE } from "../common/ratePacer.ts";
import type { UploadSessionState } from "../common/types.ts";
import { ClientSessionManager } from "../auth/clientSessionManager.ts";

export class UploadHttpHandler {
  uploadSessions: Map<string, UploadSessionState>;

  constructor() {
    this.uploadSessions = new Map();
  }

  async handleUpload(
    request: Request,
    envObj: any,
    clientSessionManager: ClientSessionManager
  ): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.endsWith("/init")) {
      return this.handleUploadInit(request, envObj, clientSessionManager);
    }
    if (url.pathname.endsWith("/chunk")) {
      return this.handleUploadChunk(request, envObj, clientSessionManager);
    }
    if (url.pathname.endsWith("/complete")) {
      return this.handleUploadComplete(request, envObj, clientSessionManager);
    }
    return this.handleUploadOneShot(request, envObj, clientSessionManager);
  }

  async handleUploadInit(
    request: Request,
    envObj: any,
    clientSessionManager: ClientSessionManager
  ): Promise<Response> {
    try {
      const { client, userId, error } = await clientSessionManager.getOrConnectUserClient(request, envObj);
      if (!client || !userId) {
        return new Response(JSON.stringify({ error: error || "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      const body = await request.json();
      const { channel_id, file_name, file_size, total_chunks, mime_type } = body;

      if (!channel_id || !file_name || !file_size || !total_chunks) {
        return new Response(
          JSON.stringify({ error: "channel_id, file_name, file_size, and total_chunks required" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      if (Number(file_size) > MAX_TELEGRAM_FILE_SIZE) {
        return new Response(
          JSON.stringify({ error: "File exceeds Telegram's 2,000 MB (2 GB) upload limit" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      const db = getDb(envObj?.DB);
      const channel = await db.get(
        `SELECT c.* FROM channels c
         JOIN gallery_channels gc ON gc.channel_id = c.id
         WHERE c.id = ? AND gc.user_id = ?`,
        [channel_id, userId]
      );
      if (!channel) {
        return new Response(JSON.stringify({ error: "Channel not found or unauthorized" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      const uploadId = crypto.randomUUID();
      const fileId = helpers.readBigIntFromBuffer(helpers.generateRandomBytes(8), true, true);
      const isBig = file_size > 10 * 1024 * 1024;
      const isVideo = mime_type ? mime_type.startsWith("video/") : false;

      this.uploadSessions.set(uploadId, {
        userId,
        fileId,
        totalParts: total_chunks,
        uploadedParts: new Set(),
        fileName: file_name,
        fileSize: file_size,
        channelId: channel_id,
        isBig,
        isVideo,
        mimeType: mime_type || (isVideo ? "video/mp4" : "image/jpeg"),
        expiresAt: Date.now() + 60 * 60 * 1000,
      });

      return new Response(
        JSON.stringify({
          success: true,
          upload_id: uploadId,
          chunk_size: 1024 * 1024,
          total_chunks,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    } catch (err: any) {
      console.error("[UploadInit Error]:", err);
      return new Response(
        JSON.stringify({ error: err.message || "Init upload failed" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  async handleUploadChunk(
    request: Request,
    envObj: any,
    clientSessionManager: ClientSessionManager
  ): Promise<Response> {
    const startT0 = Date.now();
    try {
      const { client, userId, error } = await clientSessionManager.getOrConnectUserClient(request, envObj);
      if (!client || !userId) {
        return new Response(JSON.stringify({ error: error || "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      const formData = await request.formData();
      const uploadId = formData.get("upload_id") as string;
      const chunkIndex = parseInt(formData.get("chunk_index") as string, 10);
      const chunkBlob = formData.get("chunk") as Blob;

      if (!uploadId || isNaN(chunkIndex) || !chunkBlob) {
        return new Response(
          JSON.stringify({ error: "upload_id, chunk_index, and chunk required" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      const uploadSession = this.uploadSessions.get(uploadId);
      if (!uploadSession || uploadSession.userId !== userId) {
        return new Response(JSON.stringify({ error: "Upload session expired or invalid" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      let chunkBuffer: Buffer;
      if (chunkBlob && typeof (chunkBlob as any).arrayBuffer === "function") {
        chunkBuffer = Buffer.from(await chunkBlob.arrayBuffer());
      } else if (typeof chunkBlob === "string") {
        chunkBuffer = Buffer.from(chunkBlob, "binary");
      } else {
        return new Response(
          JSON.stringify({ error: "Invalid chunk payload format (expected binary blob)" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      const isBig = uploadSession.isBig;
      const partReq = isBig
        ? new Api.upload.SaveBigFilePart({
            fileId: uploadSession.fileId,
            filePart: chunkIndex,
            fileTotalParts: uploadSession.totalParts,
            bytes: chunkBuffer,
          })
        : new Api.upload.SaveFilePart({
            fileId: uploadSession.fileId,
            filePart: chunkIndex,
            bytes: chunkBuffer,
          });

      const sender = await client.getSender(client.session.dcId);
      await Promise.race([
        sender.send(partReq),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Telegram MTProto upload part timed out after 30s")), 30000)
        ),
      ]);

      uploadSession.uploadedParts.add(chunkIndex);

      return new Response(
        JSON.stringify({
          success: true,
          chunk_index: chunkIndex,
          uploaded_count: uploadSession.uploadedParts.size,
          total_parts: uploadSession.totalParts,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    } catch (err: any) {
      console.error(`[UploadChunk Error after ${Date.now() - startT0}ms]:`, err.message, err.stack);
      return new Response(
        JSON.stringify({
          error: err.message || "Upload chunk failed",
          details: err.stack,
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  async handleUploadComplete(
    request: Request,
    envObj: any,
    clientSessionManager: ClientSessionManager
  ): Promise<Response> {
    try {
      const { client, userId, error } = await clientSessionManager.getOrConnectUserClient(request, envObj);
      if (!client || !userId) {
        return new Response(JSON.stringify({ error: error || "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      const db = getDb(envObj?.DB);
      const body = await request.json();
      const {
        upload_id,
        channel_id,
        width,
        height,
        duration,
        blur_hash,
        thumbnail_base64,
        captured_at,
      } = body;

      const uploadSession = this.uploadSessions.get(upload_id);
      if (!uploadSession || uploadSession.userId !== userId) {
        return new Response(JSON.stringify({ error: "Upload session expired or invalid" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (uploadSession.uploadedParts.size < uploadSession.totalParts) {
        return new Response(
          JSON.stringify({
            error: `Incomplete upload: only ${uploadSession.uploadedParts.size}/${uploadSession.totalParts} chunks uploaded`,
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      const channel = await db.get(
        `SELECT c.* FROM channels c
         JOIN gallery_channels gc ON gc.channel_id = c.id
         WHERE c.id = ? AND gc.user_id = ?`,
        [channel_id || uploadSession.channelId, userId]
      );
      if (!channel) {
        return new Response(JSON.stringify({ error: "Channel not found or unauthorized" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

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

      const inputFile = uploadSession.isBig
        ? new Api.InputFileBig({
            id: uploadSession.fileId,
            parts: uploadSession.totalParts,
            name: uploadSession.fileName,
          })
        : new Api.InputFile({
            id: uploadSession.fileId,
            parts: uploadSession.totalParts,
            name: uploadSession.fileName,
            md5Checksum: "",
          });

      let thumbBuf: Buffer | undefined = undefined;
      if (thumbnail_base64) {
        try {
          thumbBuf = Buffer.from(thumbnail_base64.replace(/^data:image\/\w+;base64,/, ""), "base64");
        } catch {}
      }

      const nowSeconds = Math.floor(Date.now() / 1000);
      const signature = await generateAetherollSignature(
        uploadSession.fileSize,
        nowSeconds,
        envObj?.SESSION_ENCRYPTION_KEY
      );

      const isVideo = uploadSession.isVideo;
      const sentMsg = await client.sendFile(targetPeer, {
        file: inputFile,
        thumb: thumbBuf,
        caption: signature,
        forceDocument: true,
        attributes: [
          new Api.DocumentAttributeFilename({
            fileName: uploadSession.fileName,
          }),
          ...(isVideo
            ? [
                new Api.DocumentAttributeVideo({
                  duration: Math.round(Number(duration) || 0),
                  w: Number(width) || 1920,
                  h: Number(height) || 1080,
                  supportsStreaming: true,
                }),
              ]
            : [
                new Api.DocumentAttributeImageSize({
                  w: Number(width) || 1920,
                  h: Number(height) || 1080,
                }),
              ]),
        ],
      });

      const realMessageId = sentMsg.id;
      const mediaId = crypto.randomUUID();
      let thumbnailR2Key: string | null = null;

      if (thumbnail_base64) {
        const r2 = getR2Storage(envObj?.R2_BUCKET);
        thumbnailR2Key = `thumbnails/${channel.id}/${mediaId}.jpg`;
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
          channel.id,
          userId,
          realMessageId,
          isVideo ? "video" : "photo",
          uploadSession.mimeType,
          uploadSession.fileSize,
          Number(width) || 1920,
          Number(height) || 1080,
          duration != null ? Number(duration) : isVideo ? 0 : null,
          blur_hash || "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
          thumbnailR2Key,
          captured_at || new Date().toISOString(),
        ]
      );

      // Emit WAL Event in background
      const eventMsgId = await emitGalleryEvent(client, targetPeer, realMessageId, "CREATE", {
        blur_hash: blur_hash || "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
        captured_at: captured_at || new Date().toISOString(),
      }).catch(() => null);

      if (eventMsgId) {
        try {
          await db.run(
            `INSERT OR IGNORE INTO media_event_messages (id, channel_id, media_item_id, media_telegram_msg_id, event_telegram_msg_id)
             VALUES (?, ?, ?, ?, ?)`,
            [crypto.randomUUID(), uploadSession.channelId, mediaId, realMessageId, eventMsgId]
          );
        } catch {}
      }

      // Remove session
      this.uploadSessions.delete(upload_id);

      return new Response(
        JSON.stringify({ success: true, mediaId, telegramMessageId: realMessageId }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    } catch (err: any) {
      console.error("[UploadComplete Error]:", err);
      return new Response(
        JSON.stringify({ error: err.message || "Upload complete failed" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  async handleUploadOneShot(
    request: Request,
    envObj: any,
    clientSessionManager: ClientSessionManager
  ): Promise<Response> {
    try {
      const { client, userId, error } = await clientSessionManager.getOrConnectUserClient(request, envObj);
      if (!client || !userId) {
        return new Response(JSON.stringify({ error: error || "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      const formData = await request.formData();
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
        return new Response(JSON.stringify({ error: "File and channel_id are required" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (file.size > MAX_TELEGRAM_FILE_SIZE) {
        return new Response(
          JSON.stringify({ error: "File exceeds Telegram's 2,000 MB (2 GB) upload limit" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      const db = getDb(envObj?.DB);
      const channel = await db.get(
        `SELECT c.* FROM channels c
         JOIN gallery_channels gc ON gc.channel_id = c.id
         WHERE c.id = ? AND gc.user_id = ?`,
        [channelId, userId]
      );

      if (!channel) {
        return new Response(JSON.stringify({ error: "Channel not found or unauthorized" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      console.log(`[UploadOneShot] Received file: ${file.name} (${file.size} bytes), target channel: ${channelId}`);

      console.log(`[UploadOneShot] MTProto client ready on DC ${client.session.dcId}. Reading file buffer...`);
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

      let thumbBuf: Buffer | undefined = undefined;
      if (thumbnailBase64) {
        try {
          thumbBuf = Buffer.from(thumbnailBase64.replace(/^data:image\/\w+;base64,/, ""), "base64");
        } catch {}
      }

      const nowSeconds = Math.floor(Date.now() / 1000);
      const signature = await generateAetherollSignature(
        file.size,
        nowSeconds,
        envObj?.SESSION_ENCRYPTION_KEY
      );

      console.log(`[UploadOneShot] Streaming file to Telegram targetPeer (${targetPeer})...`);
      let sentMsg: any;
      try {
        sentMsg = await client.sendFile(targetPeer, {
          file: customFile,
          thumb: thumbBuf,
          caption: signature,
          workers: 1,
          forceDocument: true,
          attributes: [
            new Api.DocumentAttributeFilename({
              fileName: file.name,
            }),
            ...(isVideo
              ? [
                  new Api.DocumentAttributeVideo({
                    duration: Math.round(Number(formData.get("duration")) || 0),
                    w: Number(formData.get("width")) || 1920,
                    h: Number(formData.get("height")) || 1080,
                    supportsStreaming: true,
                  }),
                ]
              : [
                  new Api.DocumentAttributeImageSize({
                    w: Number(formData.get("width")) || 1920,
                    h: Number(formData.get("height")) || 1080,
                  }),
                ]),
          ],
        });
        console.log(`[UploadOneShot] Telegram sendFile SUCCESS! Message ID: ${sentMsg.id}`);
      } catch (sendErr: any) {
        if (sendErr?.errorMessage === "CHAT_WRITE_FORBIDDEN" || sendErr?.message?.includes("CHAT_WRITE_FORBIDDEN")) {
          return new Response(
            JSON.stringify({
              error:
                "You do not have post/admin permissions in this Telegram channel. Please select 'Saved Messages' or a private channel/group you own.",
            }),
            { status: 403, headers: { "Content-Type": "application/json" } }
          );
        }
        throw sendErr;
      }

      const realMessageId = sentMsg.id;

      const customWidth = formData.get("width") ? parseInt(formData.get("width") as string, 10) : undefined;
      const customHeight = formData.get("height") ? parseInt(formData.get("height") as string, 10) : undefined;
      const customDuration = formData.get("duration") ? parseFloat(formData.get("duration") as string) : undefined;

      let width = customWidth || 1920;
      let height = customHeight || 1080;
      let duration: number | null = customDuration || (isVideo ? 0 : null);

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
          if (!customWidth) width = videoAttr.w;
          if (!customHeight) height = videoAttr.h;
          if (!customDuration && videoAttr.duration) duration = videoAttr.duration;
        }
      }

      const mediaId = crypto.randomUUID();
      let thumbnailR2Key: string | null = null;

      if (thumbnailBase64) {
        const r2 = getR2Storage(envObj?.R2_BUCKET);
        thumbnailR2Key = `thumbnails/${channelId}/${mediaId}.jpg`;
        const thumbBuf = Buffer.from(thumbnailBase64.replace(/^data:image\/\w+;base64,/, ""), "base64");
        await r2.put(thumbnailR2Key, thumbBuf, "image/jpeg").catch(() => {});
      }

      await db.run(
        `INSERT INTO media_items (
           id, channel_id, uploader_user_id, telegram_message_id, file_type,
           mime_type, file_size_bytes, width, height, duration_seconds,
           blur_hash, thumbnail_r2_key, captured_at, latitude, longitude
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(channel_id, telegram_message_id) DO UPDATE SET
           file_size_bytes = excluded.file_size_bytes,
           width = excluded.width,
           height = excluded.height,
           duration_seconds = excluded.duration_seconds,
           latitude = COALESCE(excluded.latitude, media_items.latitude),
           longitude = COALESCE(excluded.longitude, media_items.longitude)`,
        [
          mediaId,
          channelId,
          userId,
          realMessageId,
          isVideo ? "video" : "photo",
          file.type || (isVideo ? "video/mp4" : "image/jpeg"),
          file.size,
          width,
          height,
          duration,
          blurHash,
          thumbnailR2Key,
          capturedAt,
          latitude,
          longitude,
        ]
      );

      // Emit Telegram WAL Event in background
      const eventMsgId = await emitGalleryEvent(client, targetPeer, realMessageId, "CREATE", {
        blur_hash: blurHash,
        captured_at: capturedAt,
      }).catch(() => null);

      if (eventMsgId) {
        try {
          await db.run(
            `INSERT OR IGNORE INTO media_event_messages (id, channel_id, media_item_id, media_telegram_msg_id, event_telegram_msg_id)
             VALUES (?, ?, ?, ?, ?)`,
            [crypto.randomUUID(), channelId, mediaId, realMessageId, eventMsgId]
          );
        } catch {}
      }

      return new Response(
        JSON.stringify({ success: true, mediaId, telegramMessageId: realMessageId }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    } catch (err: any) {
      console.error("[TelegramAuthDO Upload Error]:", err);
      return new Response(
        JSON.stringify({ error: err.message || "Failed uploading to Telegram" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  }
}
