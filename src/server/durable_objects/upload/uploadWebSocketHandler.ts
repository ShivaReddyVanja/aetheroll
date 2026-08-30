import { Api, helpers } from "telegram";
import crypto from "crypto";
import { getDb } from "../../lib/db.ts";
import { decryptSession, generateAetherollSignature } from "../../lib/crypto.ts";
import { extractSessionToken, extractAllSessionTokens } from "../../lib/auth.ts";
import { getR2Storage } from "../../lib/r2.ts";
import { getDefaultTelegramConfig, getConnectedClient } from "../../lib/telegram.ts";
import { emitGalleryEvent } from "../../lib/ledger.ts";
import { SlidingWindowRatePacer, MAX_TELEGRAM_FILE_SIZE } from "../common/ratePacer.ts";
import { ClientSessionManager } from "../auth/clientSessionManager.ts";
import { flushSessionBilling } from "../../lib/billing/index.ts";

export class UploadWebSocketHandler {
  async handleUploadWebSocket(
    ws: WebSocket,
    envObj: any,
    request: Request | undefined,
    clientSessionManager: ClientSessionManager,
    ratePacer: SlidingWindowRatePacer
  ) {
    let client: any = null;
    let uploadAbortController = new AbortController();
    const TG_PART_SIZE = 512 * 1024;
    const UPLOAD_CONCURRENCY = 4;
    const wsStartTime = performance.now();
    let billingFlushed = false;

    const flushWsBilling = (userIdOverride?: string) => {
      if (billingFlushed) return;
      billingFlushed = true;
      return flushSessionBilling({
        startTime: wsStartTime,
        userId: userIdOverride || uploadState?.userId,
        purpose: "UPLOAD_FILE",
        dbBinding: envObj?.DB,
      });
    };

    const logToClient = (stage: string, detail: any) => {
      console.log(`[UploadWS:${stage}]`, detail);
      try {
        ws.send(JSON.stringify({ type: "debug_log", stage, detail, timestamp: Date.now() }));
      } catch {}
    };

    let uploadState: {
      userId: string;
      channelId: string;
      fileId: any;
      fileName: string;
      fileSize: number;
      mimeType: string;
      totalParts: number;
      uploadedParts: Set<number>;
      inboundQueue: Map<number, Buffer>;
      nextPartToProcess: number;
      isFinalizing?: boolean;
      width?: number;
      height?: number;
      duration?: number;
      blurHash?: string;
      thumbnailBase64?: string;
      capturedAt?: string;
      latitude?: number | null;
      longitude?: number | null;
      isBig: boolean;
      isVideo: boolean;
      targetPeer?: any;
    } | null = null;

    let workerWaiters: Set<() => void> = new Set();

    const notifyWorkers = () => {
      // Wake ALL sleeping workers at once, not just one
      const waiters = Array.from(workerWaiters);
      workerWaiters.clear();
      for (const resolve of waiters) resolve();
    };

    const finalizeUpload = async () => {
      if (!uploadState || !client || uploadState.isFinalizing) return;
      uploadState.isFinalizing = true;

      try {
        logToClient("ALL_MTPROTO_PARTS_UPLOADED", { totalParts: uploadState.totalParts });

        const inputFile = uploadState.isBig
          ? new Api.InputFileBig({
              id: uploadState.fileId,
              parts: uploadState.totalParts,
              name: uploadState.fileName,
            })
          : new Api.InputFile({
              id: uploadState.fileId,
              parts: uploadState.totalParts,
              name: uploadState.fileName,
              md5Checksum: "",
            });

        const nowSeconds = Math.floor(Date.now() / 1000);
        const signature = await generateAetherollSignature(
          uploadState.fileSize,
          nowSeconds,
          envObj?.SESSION_ENCRYPTION_KEY
        );

        const media = new Api.InputMediaUploadedDocument({
          file: inputFile,
          mimeType: uploadState.mimeType || (uploadState.isVideo ? "video/mp4" : "image/jpeg"),
          attributes: [
            new Api.DocumentAttributeFilename({
              fileName: uploadState.fileName,
            }),
            ...(uploadState.isVideo
              ? [
                  new Api.DocumentAttributeVideo({
                    duration: Math.round(uploadState.duration || 0),
                    w: uploadState.width || 1920,
                    h: uploadState.height || 1080,
                    supportsStreaming: true,
                  }),
                ]
              : [
                  new Api.DocumentAttributeImageSize({
                    w: uploadState.width || 1920,
                    h: uploadState.height || 1080,
                  }),
                ]),
          ],
        });

        logToClient("INVOKING_SEND_MEDIA", { targetPeer: uploadState.targetPeer, isVideo: uploadState.isVideo });

        let sentMsg: any = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            sentMsg = await Promise.race([
              client.invoke(
                new Api.messages.SendMedia({
                  peer: uploadState.targetPeer,
                  media,
                  message: signature,
                  randomId: helpers.readBigIntFromBuffer(helpers.generateRandomBytes(8), true, true),
                })
              ),
              new Promise((_, reject) => setTimeout(() => reject(new Error("SendMedia timed out after 20s")), 20000)),
            ]);
            if (sentMsg) break;
          } catch (sendErr: any) {
            console.warn(`[SendMedia Attempt ${attempt}/3 failed]:`, sendErr?.message);
            if (attempt === 3) throw sendErr;
            await new Promise((r) => setTimeout(r, 1000));
          }
        }

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

        logToClient("TELEGRAM_SEND_FILE_SUCCESS", { realMessageId });
        const mediaId = crypto.randomUUID();
        const db = getDb(envObj?.DB);

        let thumbnailR2Key: string | null = null;
        if (uploadState.thumbnailBase64 && envObj?.R2_BUCKET) {
          try {
            const r2 = getR2Storage(envObj.R2_BUCKET);
            thumbnailR2Key = `thumbnails/${uploadState.channelId}/${mediaId}.jpg`;
            const thumbBuf = Buffer.from(uploadState.thumbnailBase64.replace(/^data:image\/\w+;base64,/, ""), "base64");
            await r2.put(thumbnailR2Key, thumbBuf, "image/jpeg").catch(() => {});
          } catch {}
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
            uploadState.channelId,
            uploadState.userId,
            realMessageId,
            uploadState.isVideo ? "video" : "photo",
            uploadState.mimeType,
            uploadState.fileSize,
            uploadState.width || 1920,
            uploadState.height || 1080,
            uploadState.duration || null,
            uploadState.blurHash,
            thumbnailR2Key,
            uploadState.capturedAt,
            uploadState.latitude || null,
            uploadState.longitude || null,
          ]
        );

        // Background WAL event
        const eventMsgId = await emitGalleryEvent(client, uploadState.targetPeer, realMessageId, "CREATE", {
          blur_hash: uploadState.blurHash,
          captured_at: uploadState.capturedAt,
        }).catch(() => null);

        if (eventMsgId) {
          try {
            await db.run(
              `INSERT OR IGNORE INTO media_event_messages (id, channel_id, media_item_id, media_telegram_msg_id, event_telegram_msg_id)
               VALUES (?, ?, ?, ?, ?)`,
              [crypto.randomUUID(), uploadState.channelId, mediaId, realMessageId, eventMsgId]
            );
          } catch {}
        }

        ws.send(
          JSON.stringify({
            type: "complete",
            success: true,
            mediaId,
            telegramMessageId: realMessageId,
            item: {
              id: mediaId,
              channel_id: uploadState.channelId,
              telegram_message_id: realMessageId,
              file_type: uploadState.isVideo ? "video" : "photo",
              mime_type: uploadState.mimeType,
              file_size_bytes: uploadState.fileSize,
              width: uploadState.width || 1920,
              height: uploadState.height || 1080,
              duration_seconds: uploadState.duration || null,
              blur_hash: uploadState.blurHash,
              thumbnail_r2_key: thumbnailR2Key,
              captured_at: uploadState.capturedAt,
            },
          })
        );
        logToClient("UPLOAD_COMPLETE_DONE", { mediaId });
        await flushWsBilling();
        try {
          ws.close(1000, "Upload complete");
        } catch {}
      } catch (finalizeErr: any) {
        console.error("[UploadFinalize Error]:", finalizeErr);
        logToClient("UPLOAD_FINALIZE_ERROR", { error: finalizeErr.message });
        await flushWsBilling();
        try {
          ws.send(JSON.stringify({ type: "error", error: finalizeErr.message || "Failed finalizing upload" }));
        } catch {}
      }
    };

    // Dynamic Upload Worker Pool (Mirroring fetchSegmentParallel)
    const runUploadWorker = async (workerId: number) => {
      while (!uploadAbortController.signal.aborted && uploadState) {
        if (uploadState.uploadedParts.size === uploadState.totalParts) {
          break;
        }

        // Find next queued part that hasn't been uploaded or dispatched
        let targetPartIndex: number | null = null;
        for (const [partIdx] of uploadState.inboundQueue.entries()) {
          if (!uploadState.uploadedParts.has(partIdx)) {
            targetPartIndex = partIdx;
            break;
          }
        }

        if (targetPartIndex === null) {
          // No parts ready in queue right now; park this worker until notified or 200ms fallback
          await new Promise<void>((resolve) => {
            workerWaiters.add(resolve);
            setTimeout(() => {
              workerWaiters.delete(resolve);
              resolve();
            }, 200);
          });
          continue;
        }

        const partBuffer = uploadState.inboundQueue.get(targetPartIndex);
        if (!partBuffer) continue;

        // Temporarily remove from queue to prevent another worker from taking it
        uploadState.inboundQueue.delete(targetPartIndex);

        const isLarge = uploadState.isBig;
        const partReq = isLarge
          ? new Api.upload.SaveBigFilePart({
              fileId: uploadState.fileId,
              filePart: targetPartIndex,
              fileTotalParts: uploadState.totalParts,
              bytes: partBuffer,
            })
          : new Api.upload.SaveFilePart({
              fileId: uploadState.fileId,
              filePart: targetPartIndex,
              bytes: partBuffer,
            });

        let success = false;
        for (let attempt = 1; attempt <= 3; attempt++) {
          if (uploadAbortController.signal.aborted) break;

          try {
            // Acquire rate pacer token (<= 25 rps across all parallel workers)
            await ratePacer.acquire();
            if (uploadAbortController.signal.aborted) break;

            const t0 = Date.now();
            await Promise.race([
              client.invoke(partReq),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error(`Part #${targetPartIndex} timeout after 25s`)), 25000)
              ),
            ]);

            const lat = Date.now() - t0;
            success = true;
            logToClient("PART_UPLOADED_OK", { workerId, partIndex: targetPartIndex, attempt, latency: lat });
            break;
          } catch (partErr: any) {
            console.warn(
              `[UploadWorker ${workerId} | Part #${targetPartIndex}] Attempt ${attempt}/3 failed:`,
              partErr?.message
            );
            if (attempt === 3) {
              logToClient("PART_FATAL_ERROR", { partIndex: targetPartIndex, error: partErr?.message });
              try {
                ws.send(
                  JSON.stringify({
                    type: "error",
                    error: `Upload part #${targetPartIndex} failed: ${partErr?.message}`,
                  })
                );
              } catch {}
              uploadAbortController.abort();
              return;
            }
            await new Promise((r) => setTimeout(r, 400));
          }
        }

        if (success && !uploadAbortController.signal.aborted && uploadState) {
          uploadState.uploadedParts.add(targetPartIndex);
          const percent = Math.round((uploadState.uploadedParts.size / uploadState.totalParts) * 100);

          try {
            ws.send(
              JSON.stringify({
                type: "part_ack",
                partIndex: targetPartIndex,
                progressPercent: percent,
                uploadedParts: uploadState.uploadedParts.size,
                totalParts: uploadState.totalParts,
              })
            );
          } catch {}

          if (uploadState.uploadedParts.size === uploadState.totalParts && !uploadState.isFinalizing) {
            await finalizeUpload();
            break;
          }
        }
      }
    };

    ws.addEventListener("close", (ev: any) => {
      uploadAbortController.abort();
      console.log(`[UploadWS] Client disconnected (code: ${ev?.code}, reason: ${ev?.reason})`);
      flushWsBilling();
    });

    ws.addEventListener("error", (err: any) => {
      uploadAbortController.abort();
      console.error("[UploadWS] Error on socket:", err);
    });

    ws.addEventListener("message", async (event: any) => {
      try {
        const rawData = event.data;

        // 1. Control Frames ("init")
        if (typeof rawData === "string") {
          let msg: any;
          try {
            msg = JSON.parse(rawData);
          } catch {
            ws.send(JSON.stringify({ type: "error", error: "Invalid JSON format" }));
            return;
          }

          if (msg.type === "init") {
            logToClient("INIT_RECEIVED", { fileName: msg.fileName, fileSize: msg.fileSize, totalParts: msg.totalChunks });
            const candidates = extractAllSessionTokens(msg.token || request);
            if (candidates.length === 0) {
              ws.send(JSON.stringify({ type: "error", error: "Authentication token required" }));
              return;
            }

            const db = getDb(envObj?.DB);
            let session: any = null;
            let parsed: any = null;

            for (const candidate of candidates) {
              const res = await db.get(
                `SELECT u.id as user_id, u.session_string FROM user_sessions s
                 JOIN users u ON u.id = s.user_id
                 WHERE s.id = ? AND s.expires_at > CURRENT_TIMESTAMP`,
                [candidate.sessionId]
              );
              if (res) {
                session = res;
                parsed = candidate;
                break;
              }
            }

            if (!session || !parsed) {
              logToClient("AUTH_FAILED", "Session token invalid or expired");
              ws.send(JSON.stringify({ type: "error", error: "Unauthorized session token" }));
              return;
            }

            const channelId = msg.channelId;
            const channel = await db.get(
              `SELECT c.* FROM channels c
               JOIN gallery_channels gc ON gc.channel_id = c.id
               WHERE c.id = ? AND gc.user_id = ?`,
              [channelId, session.user_id]
            );

            if (!channel) {
              logToClient("CHANNEL_UNAUTHORIZED", { channelId });
              ws.send(JSON.stringify({ type: "error", error: "Channel not found or unauthorized" }));
              return;
            }

            let clientRecord =
              clientSessionManager.userClients.get(parsed.fullToken) ||
              clientSessionManager.userClients.get(parsed.sessionId);
            client = clientRecord?.client;

            if (!client || !client.connected) {
              logToClient("CONNECTING_MTPROTO", { userId: session.user_id });
              const decrypted = await decryptSession(
                session.session_string,
                envObj?.SESSION_ENCRYPTION_KEY,
                parsed.clientSecret
              );
              client = await getConnectedClient(decrypted, getDefaultTelegramConfig(envObj));
              clientSessionManager.userClients.set(parsed.fullToken, { client, lastUsed: Date.now() });
              clientSessionManager.userClients.set(parsed.sessionId, { client, lastUsed: Date.now() });
            }

            logToClient("MTPROTO_READY", { dcId: client.session.dcId, connected: client.connected });

            const fileSize = Number(msg.fileSize) || 0;
            if (fileSize > MAX_TELEGRAM_FILE_SIZE) {
              logToClient("FILE_TOO_LARGE", { fileSize, max: MAX_TELEGRAM_FILE_SIZE });
              ws.send(JSON.stringify({ type: "error", error: "File exceeds Telegram's 2,000 MB (2 GB) upload limit" }));
              return;
            }

            const isBig = fileSize > 10 * 1024 * 1024;
            const isVideo = msg.mimeType ? msg.mimeType.startsWith("video/") : false;
            const fileId = helpers.readBigIntFromBuffer(helpers.generateRandomBytes(8), true, true);
            const totalParts = Math.ceil(fileSize / TG_PART_SIZE);

            let targetPeer: any = channel.telegram_channel_id;
            if (channel.telegram_channel_id === "me" || channel.telegram_channel_id.startsWith("me_")) {
              targetPeer = "me";
            } else {
              try {
                targetPeer = await client.getInputEntity(channel.telegram_channel_id);
              } catch {
                try {
                  targetPeer = await client.getEntity(channel.telegram_channel_id);
                } catch {
                  targetPeer = channel.telegram_channel_id;
                }
              }
            }

            uploadState = {
              userId: session.user_id,
              channelId,
              fileId,
              fileName: msg.fileName || "upload",
              fileSize,
              mimeType: msg.mimeType || (isVideo ? "video/mp4" : "image/jpeg"),
              totalParts,
              uploadedParts: new Set<number>(),
              inboundQueue: new Map<number, Buffer>(),
              nextPartToProcess: 0,
              width: msg.width,
              height: msg.height,
              duration: msg.duration,
              blurHash: msg.blurHash || "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
              thumbnailBase64: msg.thumbnailBase64 || "",
              capturedAt: msg.capturedAt || new Date().toISOString(),
              latitude: msg.latitude != null ? Number(msg.latitude) : null,
              longitude: msg.longitude != null ? Number(msg.longitude) : null,
              isBig,
              isVideo,
              targetPeer,
            };

            ws.send(
              JSON.stringify({
                type: "init_ok",
                uploadId: fileId.toString(),
                totalParts,
                partSize: TG_PART_SIZE,
              })
            );
            logToClient("INIT_CONFIRMED", { fileName: uploadState.fileName, isBig, totalParts });

            // Spawn the fixed-size upload worker pool (4 concurrent workers)
            for (let w = 1; w <= UPLOAD_CONCURRENCY; w++) {
              runUploadWorker(w).catch((err) => {
                console.error(`[UploadWorker ${w} Crash]:`, err);
              });
            }

            return;
          }
        }

        // 2. Binary Part Frame: [ 4-byte Int32 partIndex | 512KB part bytes ]
        let binaryBuf: Buffer;
        if (rawData instanceof ArrayBuffer) {
          binaryBuf = Buffer.from(rawData);
        } else if (ArrayBuffer.isView(rawData)) {
          binaryBuf = Buffer.from(rawData.buffer, rawData.byteOffset, rawData.byteLength);
        } else if (Buffer.isBuffer(rawData)) {
          binaryBuf = rawData;
        } else {
          return;
        }

        if (!uploadState || !client) {
          ws.send(JSON.stringify({ type: "error", error: "Received chunk before init" }));
          return;
        }

        if (binaryBuf.length < 5) {
          ws.send(JSON.stringify({ type: "error", error: "Chunk frame too short" }));
          return;
        }

        const partIndex = binaryBuf.readInt32BE(0);
        const partBytes = binaryBuf.subarray(4);

        // Place into worker queue and notify upload workers
        uploadState.inboundQueue.set(partIndex, Buffer.from(partBytes));
        notifyWorkers();
      } catch (err: any) {
        console.error("[UploadWS Error]:", err);
        logToClient("UPLOAD_FATAL_ERROR", { error: err.message });
        try {
          ws.send(JSON.stringify({ type: "error", error: err.message || "Upload stream failed" }));
        } catch {}
      }
    });
  }
}
