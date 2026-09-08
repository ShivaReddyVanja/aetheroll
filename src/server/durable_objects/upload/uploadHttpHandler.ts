import crypto from "crypto";
import { Api, helpers } from "telegram";
import { CustomFile, uploadFile } from "telegram/client/uploads.js";
import { getDb } from "../../lib/db.ts";
import { getR2Storage } from "../../lib/r2.ts";
import { generateAetherollSignature } from "../../lib/crypto.ts";
import { emitGalleryEvent } from "../../lib/ledger.ts";
import { MAX_TELEGRAM_FILE_SIZE, SlidingWindowRatePacer } from "../common/ratePacer.ts";
import type { UploadSessionState } from "../common/types.ts";
import { ClientSessionManager } from "../auth/clientSessionManager.ts";

const TG_PART_SIZE = 512 * 1024; // 512 KB Telegram MTProto part size
const CLIENT_CHUNK_SIZE = 4 * 1024 * 1024; // 4 MB client chunk size for fast mobile ingestion
const MAX_BUFFER_PARTS = 16; // 8 MB backpressure threshold (keeps DO RAM under 40MB, safe from 128MB limit)
const RESUME_BUFFER_PARTS = 8; // 4 MB drain threshold to resume
const UPLOAD_CONCURRENCY = 4; // 4 concurrent MTProto workers streaming to Telegram

export class UploadHttpHandler {
  uploadSessions: Map<string, UploadSessionState>;

  constructor() {
    this.uploadSessions = new Map();
  }

  private notifyWorkers(session: UploadSessionState) {
    if (!session.workerWaiters) return;
    const waiters = Array.from(session.workerWaiters);
    session.workerWaiters.clear();
    for (const resolve of waiters) resolve();
  }

  private notifyBackpressure(session: UploadSessionState) {
    if (!session.backpressureWaiters) return;
    if ((session.inboundQueue?.size || 0) <= RESUME_BUFFER_PARTS || session.fatalError) {
      const waiters = Array.from(session.backpressureWaiters);
      session.backpressureWaiters.clear();
      for (const resolve of waiters) resolve();
    }
  }

  private ensureWorkersStarted(
    session: UploadSessionState,
    client: any,
    ratePacer?: SlidingWindowRatePacer
  ) {
    if (session.workersRunning) return;
    session.workersRunning = true;

    for (let w = 1; w <= UPLOAD_CONCURRENCY; w++) {
      this.runUploadWorker(session, client, w, ratePacer).catch((err) => {
        console.error(`[UploadWorker ${w} Error]:`, err);
      });
    }
  }

  private async runUploadWorker(
    session: UploadSessionState,
    client: any,
    workerId: number,
    ratePacer?: SlidingWindowRatePacer
  ) {
    const signal = session.abortController.signal;

    while (!signal.aborted) {
      if (session.uploadedParts.size === session.totalParts || session.fatalError) {
        break;
      }

      // Find next queued part that hasn't been dispatched yet
      let targetPartIndex: number | null = null;
      for (const [partIdx] of session.inboundQueue.entries()) {
        if (!session.uploadedParts.has(partIdx) && !session.dispatchedParts.has(partIdx)) {
          targetPartIndex = partIdx;
          break;
        }
      }

      if (targetPartIndex === null) {
        // No parts ready in queue; wait until notified or 200ms fallback
        await new Promise<void>((resolve) => {
          session.workerWaiters.add(resolve);
          setTimeout(() => {
            session.workerWaiters.delete(resolve);
            resolve();
          }, 200);
        });
        continue;
      }

      const partBuffer = session.inboundQueue.get(targetPartIndex);
      if (!partBuffer) continue;

      // Mark as dispatched and remove from inboundQueue
      session.dispatchedParts.add(targetPartIndex);
      session.inboundQueue.delete(targetPartIndex);

      // Notify backpressure waiters since a part was freed from inboundQueue
      this.notifyBackpressure(session);

      const isLarge = session.isBig;
      const partReq = isLarge
        ? new Api.upload.SaveBigFilePart({
            fileId: session.fileId,
            filePart: targetPartIndex,
            fileTotalParts: session.totalParts,
            bytes: partBuffer,
          })
        : new Api.upload.SaveFilePart({
            fileId: session.fileId,
            filePart: targetPartIndex,
            bytes: partBuffer,
          });

      let success = false;
      for (let attempt = 1; attempt <= 3; attempt++) {
        if (signal.aborted) break;

        try {
          if (ratePacer) {
            await ratePacer.acquire();
          }
          if (signal.aborted) break;

          await Promise.race([
            client.invoke(partReq),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error(`Telegram part #${targetPartIndex} timeout after 30s`)), 30000)
            ),
          ]);

          success = true;
          break;
        } catch (partErr: any) {
          console.warn(
            `[UploadWorker ${workerId} | Part #${targetPartIndex}] Attempt ${attempt}/3 failed:`,
            partErr?.message
          );
          if (attempt === 3) {
            session.fatalError = partErr;
            session.abortController.abort();
            this.notifyWorkers(session);
            this.notifyBackpressure(session);
            return;
          }
          await new Promise((r) => setTimeout(r, 400));
        }
      }

      if (success && !signal.aborted) {
        session.uploadedParts.add(targetPartIndex);
        session.dispatchedParts.delete(targetPartIndex);
        this.notifyBackpressure(session);
      } else if (!success) {
        session.dispatchedParts.delete(targetPartIndex);
      }
    }
  }

  async handleUpload(
    request: Request,
    envObj: any,
    clientSessionManager: ClientSessionManager,
    ratePacer?: SlidingWindowRatePacer,
    storage?: any
  ): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.endsWith("/init")) {
      return this.handleUploadInit(request, envObj, clientSessionManager, storage);
    }
    if (url.pathname.endsWith("/chunk")) {
      return this.handleUploadChunk(request, envObj, clientSessionManager, ratePacer, storage);
    }
    if (url.pathname.endsWith("/complete")) {
      return this.handleUploadComplete(request, envObj, clientSessionManager, storage);
    }
    if (url.pathname.endsWith("/abort")) {
      return this.handleUploadAbort(request, envObj, clientSessionManager, storage);
    }
    return this.handleUploadOneShot(request, envObj, clientSessionManager);
  }

  async handleUploadInit(
    request: Request,
    envObj: any,
    clientSessionManager: ClientSessionManager,
    storage?: any
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

      const sizeNum = Number(file_size);
      const totalParts = Math.ceil(sizeNum / TG_PART_SIZE);
      const clientTotalChunks = total_chunks ? Number(total_chunks) : Math.ceil(sizeNum / CLIENT_CHUNK_SIZE);

      if (!channel_id || !file_name || !sizeNum || !totalParts) {
        return new Response(
          JSON.stringify({ error: "channel_id, file_name, and file_size required" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      if (sizeNum > MAX_TELEGRAM_FILE_SIZE) {
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
      const isBig = sizeNum > 10 * 1024 * 1024;
      const isVideo = mime_type ? mime_type.startsWith("video/") : false;
      const abortController = new AbortController();

      this.uploadSessions.set(uploadId, {
        userId,
        fileId,
        totalParts,
        uploadedParts: new Set(),
        fileName: file_name,
        fileSize: sizeNum,
        channelId: channel_id,
        isBig,
        isVideo,
        mimeType: mime_type || (isVideo ? "video/mp4" : "image/jpeg"),
        expiresAt: Date.now() + 2 * 60 * 60 * 1000, // 2-hour session lifetime
        inboundQueue: new Map(),
        dispatchedParts: new Set(),
        workerWaiters: new Set(),
        backpressureWaiters: new Set(),
        fatalError: null,
        abortController,
        workersRunning: false,
      });

      if (storage) {
        try {
          await storage.put(`session_${uploadId}`, {
            uploadId,
            userId,
            channelId: channel_id,
            fileName: file_name,
            fileSize: sizeNum,
            fileIdStr: fileId.toString(),
            totalParts,
            isBig,
            isVideo,
            mimeType: mime_type || (isVideo ? "video/mp4" : "image/jpeg"),
            createdAt: Date.now(),
          });
        } catch (sErr) {
          console.warn("[UploadInit Storage Put Error]:", sErr);
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          upload_id: uploadId,
          chunk_size: CLIENT_CHUNK_SIZE, // 4 MB client ingestion chunk
          total_chunks: clientTotalChunks,
          part_size: TG_PART_SIZE, // 512 KB Telegram MTProto part size
          total_parts: totalParts,
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
    clientSessionManager: ClientSessionManager,
    ratePacer?: SlidingWindowRatePacer,
    storage?: any
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
      const offsetField = formData.get("offset") as string;

      if (!uploadId || isNaN(chunkIndex) || !chunkBlob) {
        return new Response(
          JSON.stringify({ error: "upload_id, chunk_index, and chunk required" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      let uploadSession = this.uploadSessions.get(uploadId);
      if (!uploadSession && storage) {
        try {
          const persisted = (await storage.get(`session_${uploadId}`)) as any;
          if (persisted && persisted.userId === userId) {
            uploadSession = {
              userId: persisted.userId,
              fileId: BigInt(persisted.fileIdStr),
              totalParts: persisted.totalParts,
              uploadedParts: new Set(),
              fileName: persisted.fileName,
              fileSize: persisted.fileSize,
              channelId: persisted.channelId,
              isBig: persisted.isBig,
              isVideo: persisted.isVideo,
              mimeType: persisted.mimeType,
              expiresAt: Date.now() + 2 * 60 * 60 * 1000,
              inboundQueue: new Map(),
              dispatchedParts: new Set(),
              workerWaiters: new Set(),
              backpressureWaiters: new Set(),
              fatalError: null,
              abortController: new AbortController(),
              workersRunning: false,
            };
            this.uploadSessions.set(uploadId, uploadSession);
          }
        } catch (sErr) {
          console.warn("[UploadChunk Storage Restore Error]:", sErr);
        }
      }

      if (!uploadSession || uploadSession.userId !== userId) {
        return new Response(JSON.stringify({ error: "Upload session expired or invalid" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (uploadSession.fatalError) {
        return new Response(JSON.stringify({ error: uploadSession.fatalError.message || "Upload failed" }), {
          status: 500,
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

      // Determine byte offset of chunk: either provided by client or derived from chunk_index * CLIENT_CHUNK_SIZE
      const chunkOffset = offsetField != null && !isNaN(parseInt(offsetField, 10))
        ? parseInt(offsetField, 10)
        : chunkIndex * CLIENT_CHUNK_SIZE;

      // Slice chunk buffer into 512 KB Telegram-compliant parts and add to inboundQueue
      const startPartIndex = Math.floor(chunkOffset / TG_PART_SIZE);
      for (let offsetInChunk = 0; offsetInChunk < chunkBuffer.length; offsetInChunk += TG_PART_SIZE) {
        const partIdx = startPartIndex + Math.floor(offsetInChunk / TG_PART_SIZE);
        const partBytes = chunkBuffer.subarray(
          offsetInChunk,
          Math.min(offsetInChunk + TG_PART_SIZE, chunkBuffer.length)
        );
        if (!uploadSession.uploadedParts.has(partIdx)) {
          uploadSession.inboundQueue.set(partIdx, Buffer.from(partBytes));
        }
      }

      // Ensure the 4 concurrent background MTProto upload workers are running
      this.ensureWorkersStarted(uploadSession, client, ratePacer);

      // Wake up workers to process the newly queued parts immediately
      this.notifyWorkers(uploadSession);

      // Backpressure Gate:
      // If inboundQueue exceeds MAX_BUFFER_PARTS (48 parts = 24 MB), await until workers drain it to <= 12 MB
      if (uploadSession.inboundQueue.size > MAX_BUFFER_PARTS && !uploadSession.abortController.signal.aborted) {
        await new Promise<void>((resolve) => {
          uploadSession.backpressureWaiters.add(resolve);
          setTimeout(() => {
            uploadSession.backpressureWaiters.delete(resolve);
            resolve();
          }, 30000);
        });
      }

      if (uploadSession.fatalError) {
        return new Response(JSON.stringify({ error: uploadSession.fatalError.message || "Upload failed" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(
        JSON.stringify({
          success: true,
          chunk_index: chunkIndex,
          queued_parts: uploadSession.inboundQueue.size,
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
    clientSessionManager: ClientSessionManager,
    storage?: any
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

      // Await MTProto worker pool if there are in-flight parts or workers running
      if (uploadSession.inboundQueue && (uploadSession.inboundQueue.size > 0 || (uploadSession.dispatchedParts?.size || 0) > 0)) {
        const completeT0 = Date.now();
        while (
          uploadSession.uploadedParts.size < uploadSession.totalParts &&
          !uploadSession.fatalError &&
          !uploadSession.abortController?.signal?.aborted &&
          (uploadSession.inboundQueue?.size > 0 || (uploadSession.dispatchedParts?.size || 0) > 0)
        ) {
          if (Date.now() - completeT0 > 120000) { // 2-minute safety timeout
            break;
          }
          this.notifyWorkers(uploadSession);
          await new Promise((r) => setTimeout(r, 200));
        }
      }

      if (uploadSession.fatalError) {
        return new Response(
          JSON.stringify({ error: `Upload worker failed: ${uploadSession.fatalError.message}` }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }

      if (uploadSession.uploadedParts.size < uploadSession.totalParts) {
        return new Response(
          JSON.stringify({
            error: `Incomplete upload: only ${uploadSession.uploadedParts.size}/${uploadSession.totalParts} parts uploaded`,
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

      let realMessageId = sentMsg.id;
      if (sentMsg.updates) {
        for (const u of sentMsg.updates) {
          if (u.id) {
            realMessageId = u.id;
            break;
          }
          if (u.message && u.message.id) {
            realMessageId = u.message.id;
            break;
          }
        }
      }
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

      const mediaItem = {
        id: mediaId,
        channel_id: channel.id,
        telegram_message_id: realMessageId,
        file_type: isVideo ? "video" : "photo",
        mime_type: uploadSession.mimeType,
        file_size_bytes: uploadSession.fileSize,
        width: Number(width) || 1920,
        height: Number(height) || 1080,
        duration_seconds: duration != null ? Number(duration) : isVideo ? 0 : null,
        blur_hash: blur_hash || "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
        thumbnail_r2_key: thumbnailR2Key,
        captured_at: captured_at || new Date().toISOString(),
      };

      this.uploadSessions.delete(upload_id);
      if (storage) {
        await storage.delete(`session_${upload_id}`).catch(() => {});
      }

      return new Response(
        JSON.stringify({
          success: true,
          mediaId,
          telegramMessageId: realMessageId,
          mediaItem,
          item: mediaItem,
        }),
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

  /**
   * POST /api/media/upload/abort
   * Immediately removes a partial upload session from in-memory state.
   * Called client-side when a chunked upload is cancelled or permanently failed,
   * preventing stale DO memory entries from living out their 2-hour expiresAt window.
   */
  async handleUploadAbort(
    request: Request,
    envObj: any,
    clientSessionManager: ClientSessionManager,
    storage?: any
  ): Promise<Response> {
    try {
      const { userId, error } = await clientSessionManager.getOrConnectUserClient(request, envObj);
      if (!userId) {
        return new Response(JSON.stringify({ error: error || "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }
      const body = await request.json().catch(() => ({}));
      const { upload_id } = body;
      if (upload_id) {
        const session = this.uploadSessions.get(upload_id);
        // Only delete if owned by this user — prevent cross-user session eviction
        if (session && session.userId === userId) {
          session.abortController.abort();
          session.inboundQueue.clear();
          session.workerWaiters.clear();
          session.backpressureWaiters.clear();
          this.uploadSessions.delete(upload_id);
        }
        await storage?.delete(`session_${upload_id}`);
      }
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch {
      // Always 200 — this is a best-effort cleanup endpoint
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
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

      console.log(`[UploadOneShot] Uploading MTProto parts for file (${file.size} bytes)...`);
      const inputFile = await uploadFile(client, {
        file: customFile,
        workers: 4,
        maxBufferSize: 2 * 1024 * 1024 * 1024,
      });

      console.log(`[UploadOneShot] Streaming file to Telegram targetPeer (${targetPeer})...`);
      let sentMsg: any;
      try {
        sentMsg = await client.sendFile(targetPeer, {
          file: inputFile,
          thumb: thumbBuf,
          caption: signature,
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
