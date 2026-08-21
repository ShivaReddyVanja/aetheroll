import QRCode from "qrcode";
import crypto from "crypto";
import { Api, helpers } from "telegram";
import bigInt from "big-integer";
import { getDb } from "../lib/db";
import { encryptSession, decryptSession } from "../lib/crypto";
import { getR2Storage } from "../lib/r2";
import { createTelegramClient, getConnectedClient, getDefaultTelegramConfig } from "../lib/telegram";
import { uploadFile, CustomFile } from "telegram/client/uploads";
import { emitGalleryEvent } from "../lib/ledger";

function toBigInt(val: number | string, radix?: number) {
  const fn: any = typeof bigInt === "function" ? bigInt : (bigInt as any).default;
  if (typeof val === "string" && val.startsWith("0x")) {
    return fn(val.slice(2), 16);
  }
  return radix ? fn(val, radix) : fn(val);
}

export class TelegramAuthDO {
  state: any;
  env: any;
  activeSessions: Map<string, { client: any; qrImage?: string; token?: Buffer; expires?: number; authenticatedUser?: any; sessionToken?: string; error?: string }>;
  userClients: Map<string, { client: any; lastUsed: number }>;
  uploadSessions: Map<string, {
    userId: string;
    fileId: any;
    totalParts: number;
    uploadedParts: Set<number>;
    fileName: string;
    fileSize: number;
    channelId: string;
    isBig: boolean;
    isVideo: boolean;
    mimeType: string;
    expiresAt: number;
  }>;

  constructor(state: any, env: any) {
    this.state = state;
    this.env = env;
    this.activeSessions = new Map();
    this.userClients = new Map();
    this.uploadSessions = new Map();
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    const headerApiId = request.headers.get("x-tg-api-id");
    const headerApiHash = request.headers.get("x-tg-api-hash");
    const headerTestMode = request.headers.get("x-tg-test-mode");
    const headerEncKey = request.headers.get("x-tg-enc-key");

    const effectiveEnv = {
      ...this.env,
      TELEGRAM_API_ID: headerApiId || this.env?.TELEGRAM_API_ID || process.env?.TELEGRAM_API_ID,
      TELEGRAM_API_HASH: headerApiHash || this.env?.TELEGRAM_API_HASH || process.env?.TELEGRAM_API_HASH,
      TELEGRAM_TEST_MODE: headerTestMode || this.env?.TELEGRAM_TEST_MODE || process.env?.TELEGRAM_TEST_MODE,
      SESSION_ENCRYPTION_KEY: headerEncKey || this.env?.SESSION_ENCRYPTION_KEY || process.env?.SESSION_ENCRYPTION_KEY,
    };

    // 1. Upload WebSocket stream endpoint
    if (url.pathname.includes("/upload/ws") || (url.pathname.includes("/upload") && request.headers.get("Upgrade") === "websocket")) {
      const webSocketPair = new (globalThis as any).WebSocketPair();
      const [clientWs, serverWs] = Object.values(webSocketPair) as [WebSocket, any];

      if (typeof serverWs?.accept === "function") {
        serverWs.accept();
      }
      this.handleUploadWebSocket(serverWs, effectiveEnv);

      return new Response(null, {
        status: 101,
        webSocket: clientWs,
      } as any);
    }

    // 2. Upload media endpoint with persistent warm MTProto connection
    if (url.pathname.includes("/upload") || url.pathname.includes("/api/media/upload")) {
      return this.handleUpload(request, effectiveEnv);
    }

    // 3. Stream media chunks endpoint with persistent warm MTProto connection
    if (url.pathname.includes("/stream") || url.pathname.includes("/api/stream")) {
      return this.handleStream(request, effectiveEnv);
    }

    // 4. WebSocket endpoint for real-time bidirectional QR auth
    if (request.headers.get("Upgrade") === "websocket" || url.pathname.endsWith("/ws")) {
      const webSocketPair = new (globalThis as any).WebSocketPair();
      const [clientWs, serverWs] = Object.values(webSocketPair) as [WebSocket, any];

      if (typeof serverWs?.accept === "function") {
        serverWs.accept();
      }
      this.handleWebSocket(serverWs, effectiveEnv);

      return new Response(null, {
        status: 101,
        webSocket: clientWs,
      } as any);
    }

    // 3. HTTP QR Generation endpoint
    if (url.pathname.endsWith("/qr") && request.method === "GET") {
      return this.handleQrHttp(effectiveEnv);
    }

    // 4. HTTP QR Check polling endpoint
    if (url.pathname.endsWith("/check") && request.method === "POST") {
      const body = (await request.json().catch(() => ({}))) as any;
      return this.handleCheckHttp(body?.qrId, effectiveEnv);
    }

    return new Response("Not found in Auth DO", { status: 404 });
  }

  private async handleWebSocket(ws: WebSocket, envObj?: any) {
    let client: any = null;
    let isCancelled = false;

    ws.addEventListener("close", () => {
      isCancelled = true;
      try {
        if (client) client.disconnect();
      } catch {}
    });

    ws.addEventListener("error", () => {
      isCancelled = true;
      try {
        if (client) client.disconnect();
      } catch {}
    });

    try {
      const targetEnv = envObj || this.env;
      const config = getDefaultTelegramConfig(targetEnv);
      client = createTelegramClient(config);
      await client.connect();

      const user = await client.signInUserWithQrCode(
        { apiId: config.apiId, apiHash: config.apiHash },
        {
          qrCode: async ({ token, expires }: { token: Buffer; expires: number }) => {
            if (isCancelled) return;
            const tokenBase64Url = Buffer.from(token).toString("base64url");
            const tgUrl = `tg://login?token=${tokenBase64Url}`;

            const qrSvg = await QRCode.toString(tgUrl, {
              type: "svg",
              width: 280,
              margin: 2,
              color: { dark: "#000000", light: "#ffffff" },
            });
            const qrImageDataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(qrSvg)}`;

            try {
              ws.send(
                JSON.stringify({
                  type: "qr",
                  qrUrl: tgUrl,
                  qrImage: qrImageDataUrl,
                  expires,
                })
              );
            } catch {}
          },
          onError: async (err: Error) => {
            console.error("[TelegramAuthDO WS Error]:", err);
            if (!isCancelled) {
              try {
                ws.send(JSON.stringify({ type: "error", error: err.message || "Authentication error" }));
              } catch {}
            }
            return true;
          },
        }
      );

      if (user && !isCancelled) {
        const sessionString = (client.session as any).save();
        const db = getDb(this.env?.DB);
        const telegramUserId = (user as any).id?.toString() || (user as any).id;
        const displayName =
          [(user as any).firstName, (user as any).lastName].filter(Boolean).join(" ") ||
          (user as any).username ||
          "Telegram User";
        const encryptedSession = await encryptSession(
          sessionString,
          this.env?.SESSION_ENCRYPTION_KEY
        );

        let dbUser = await db.get("SELECT * FROM users WHERE telegram_user_id = ?", [telegramUserId]);
        const userId = dbUser?.id || crypto.randomUUID();

        if (!dbUser) {
          await db.run(
            "INSERT INTO users (id, telegram_user_id, display_name, session_string) VALUES (?, ?, ?, ?)",
            [userId, telegramUserId, displayName, encryptedSession]
          );
        } else {
          await db.run(
            "UPDATE users SET display_name = ?, session_string = ? WHERE id = ?",
            [displayName, encryptedSession, userId]
          );
        }

        const sessionToken = crypto.randomBytes(32).toString("hex");
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

        await db.run(
          "INSERT INTO user_sessions (id, user_id, expires_at) VALUES (?, ?, ?)",
          [sessionToken, userId, expiresAt]
        );

        try {
          ws.send(
            JSON.stringify({
              type: "authenticated",
              sessionToken,
              user: {
                id: userId,
                telegramUserId,
                displayName,
              },
            })
          );
        } catch {}
      }
    } catch (err: any) {
      console.error("[TelegramAuthDO Exception]:", err);
      if (!isCancelled) {
        try {
          ws.send(JSON.stringify({ type: "error", error: err.message || "Failed to initialize login" }));
        } catch {}
      }
    } finally {
      try {
        if (client) client.disconnect();
      } catch {}
    }
  }

  private async handleQrHttp(envObj?: any): Promise<Response> {
    const qrId = crypto.randomUUID();
    const sessionState: any = { qrId };
    this.activeSessions.set(qrId, sessionState);

    try {
      const targetEnv = envObj || this.env;
      const config = getDefaultTelegramConfig(targetEnv);
      const client = createTelegramClient(config);
      sessionState.client = client;
      await client.connect();

      // Start auth flow in background inside DO
      const authPromise = client.signInUserWithQrCode(
        { apiId: config.apiId, apiHash: config.apiHash },
        {
          qrCode: async ({ token, expires }: { token: Buffer; expires: number }) => {
            const tokenBase64Url = Buffer.from(token).toString("base64url");
            const tgUrl = `tg://login?token=${tokenBase64Url}`;
            const qrSvg = await QRCode.toString(tgUrl, {
              type: "svg",
              width: 280,
              margin: 2,
              color: { dark: "#000000", light: "#ffffff" },
            });
            sessionState.qrImage = `data:image/svg+xml;utf8,${encodeURIComponent(qrSvg)}`;
            sessionState.qrUrl = tgUrl;
            sessionState.expires = expires;
          },
          onError: async (err: Error) => {
            sessionState.error = err.message;
            return true;
          },
        }
      );

      authPromise
        .then(async (user: any) => {
          if (user) {
            const sessionString = (client.session as any).save();
            const db = getDb(targetEnv?.DB);
            const telegramUserId = user.id?.toString() || user.id;
            const displayName =
              [user.firstName, user.lastName].filter(Boolean).join(" ") ||
              user.username ||
              "Telegram User";
            const encryptedSession = await encryptSession(
              sessionString,
              targetEnv?.SESSION_ENCRYPTION_KEY
            );

            let dbUser = await db.get("SELECT * FROM users WHERE telegram_user_id = ?", [telegramUserId]);
            const userId = dbUser?.id || crypto.randomUUID();

            if (!dbUser) {
              await db.run(
                "INSERT INTO users (id, telegram_user_id, display_name, session_string) VALUES (?, ?, ?, ?)",
                [userId, telegramUserId, displayName, encryptedSession]
              );
            } else {
              await db.run(
                "UPDATE users SET display_name = ?, session_string = ? WHERE id = ?",
                [displayName, encryptedSession, userId]
              );
            }

            const sessionToken = crypto.randomBytes(32).toString("hex");
            const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

            await db.run(
              "INSERT INTO user_sessions (id, user_id, expires_at) VALUES (?, ?, ?)",
              [sessionToken, userId, expiresAt]
            );

            sessionState.authenticatedUser = {
              id: userId,
              telegramUserId,
              displayName,
            };
            sessionState.sessionToken = sessionToken;
          }
        })
        .catch((err: any) => {
          sessionState.error = err?.message || "Auth error";
        });

      // Wait briefly for initial QR generation
      for (let i = 0; i < 20; i++) {
        if (sessionState.qrImage) break;
        await new Promise((r) => setTimeout(r, 200));
      }

      if (!sessionState.qrImage) {
        throw new Error("Failed generating initial QR code");
      }

      return new Response(
        JSON.stringify({
          qrId,
          qrUrl: sessionState.qrUrl,
          qrImage: sessionState.qrImage,
          expires: sessionState.expires,
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    } catch (err: any) {
      return new Response(JSON.stringify({ error: err.message || "Failed generating QR" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  private async handleCheckHttp(qrId?: string, envObj?: any): Promise<Response> {
    if (!qrId) {
      return new Response(JSON.stringify({ error: "qrId required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const sessionState = this.activeSessions.get(qrId);
    if (!sessionState) {
      return new Response(JSON.stringify({ error: "Session expired or invalid" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (sessionState.error) {
      this.activeSessions.delete(qrId);
      return new Response(JSON.stringify({ error: sessionState.error }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (sessionState.authenticatedUser && sessionState.sessionToken) {
      const cookieValue = `tg_session=${sessionState.sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`;
      const response = new Response(
        JSON.stringify({
          success: true,
          sessionToken: sessionState.sessionToken,
          user: sessionState.authenticatedUser,
        }),
        {
          headers: {
            "Content-Type": "application/json",
            "Set-Cookie": cookieValue,
          },
        }
      );
      this.activeSessions.delete(qrId);
      return response;
    }

    return new Response(JSON.stringify({ success: false }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  private async handleStream(request: Request, envObj: any): Promise<Response> {
    try {
      const url = new URL(request.url);
      const mediaId = url.searchParams.get("media_id");
      if (!mediaId) return new Response("media_id required", { status: 400 });

      // Get tg_session from cookie or header
      const cookieHeader = request.headers.get("cookie") || "";
      const match = cookieHeader.match(/tg_session=([^;]+)/);
      const token = match ? match[1] : request.headers.get("x-tg-session");
      if (!token) return new Response("Unauthorized", { status: 401 });

      const db = getDb(envObj?.DB);
      const session = await db.get(
        `SELECT u.id as user_id, u.session_string FROM user_sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.id = ? AND s.expires_at > CURRENT_TIMESTAMP`,
        [token]
      );
      if (!session) return new Response("Unauthorized", { status: 401 });

      const item = await db.get(
        `SELECT m.*, c.telegram_channel_id FROM media_items m
         JOIN channels c ON c.id = m.channel_id
         WHERE m.id = ?`,
        [mediaId]
      );
      if (!item) return new Response("Media item not found", { status: 404 });

      const totalSize = Number(item.file_size_bytes) || 0;
      const rangeHeader = request.headers.get("range");

      // 1. Check R2 Cache first for instant 0ms chunk streaming
      const r2 = getR2Storage(envObj?.R2_BUCKET);

      // 2. Reuse warm, persistent MTProto client stored in Durable Object RAM
      let clientRecord = this.userClients.get(session.user_id);
      let client = clientRecord?.client;

      if (!client || !client.connected) {
        const decrypted = await decryptSession(session.session_string, envObj?.SESSION_ENCRYPTION_KEY);
        client = await getConnectedClient(decrypted, getDefaultTelegramConfig(envObj));
        this.userClients.set(session.user_id, { client, lastUsed: Date.now() });
      }

      let targetPeer: any = item.telegram_channel_id;
      if (item.telegram_channel_id !== "me") {
        try { targetPeer = await client.getInputEntity(item.telegram_channel_id); }
        catch { try { targetPeer = await client.getEntity(item.telegram_channel_id); } catch {} }
      }

      const msgId = Number(item.telegram_message_id);
      const messages = await client.getMessages(targetPeer, { ids: [msgId] });
      const msg = messages[0];
      if (!msg || !msg.media) return new Response("Media not found in Telegram", { status: 404 });

      if (!rangeHeader) {
        // Full media download
        const fullBuffer = await client.downloadMedia(msg.media, {});
        return new Response(fullBuffer as any, {
          status: 200,
          headers: {
            "Content-Type": item.mime_type || "application/octet-stream",
            "Content-Length": (fullBuffer?.length || totalSize).toString(),
            "Accept-Ranges": "bytes",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges",
          },
        });
      }

      // Parse Range header: `bytes=start-end`
      const parts = rangeHeader.replace(/bytes=/, "").split("-");
      let start = parseInt(parts[0], 10);
      let requestedEnd = parts[1] ? parseInt(parts[1], 10) : undefined;
      const CHUNK_SIZE = 512 * 1024;
      let end = requestedEnd !== undefined ? requestedEnd : Math.min(start + CHUNK_SIZE - 1, totalSize - 1);

      if (isNaN(start)) start = 0;
      if (isNaN(end) || end >= totalSize) end = totalSize - 1;
      if (start > end || start >= totalSize) {
        return new Response(null, {
          status: 416,
          headers: {
            "Content-Range": `bytes */${totalSize}`,
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges",
          },
        });
      }

      const alignedStart = Math.floor(start / CHUNK_SIZE) * CHUNK_SIZE;
      const chunkR2Key = `chunks/${item.id}/${alignedStart}.bin`;

      // Fast Path: Fetch chunk from R2 if previously streamed
      let chunkBuffer: Buffer | null = null;
      try {
        const r2Cached: any = await r2.get(chunkR2Key);
        if (r2Cached) {
          chunkBuffer = Buffer.isBuffer(r2Cached)
            ? r2Cached
            : Buffer.from(typeof r2Cached.arrayBuffer === "function" ? await r2Cached.arrayBuffer() : r2Cached);
        }
      } catch {}

      if (!chunkBuffer) {
        // Fetch 512KB slice from Telegram MTProto on warm persistent connection
        const doc = msg.media.document || (msg.media.className === "MessageMediaDocument" ? msg.media.document : null);
        const photo = msg.media.photo || (msg.media.className === "MessageMediaPhoto" ? msg.media.photo : null);

        let fileLocation: any = null;
        if (doc && doc.id && doc.accessHash && doc.fileReference) {
          fileLocation = new Api.InputDocumentFileLocation({
            id: doc.id,
            accessHash: doc.accessHash,
            fileReference: doc.fileReference,
            thumbSize: "",
          });
        } else if (photo && photo.id && photo.accessHash && photo.fileReference) {
          const sizes = photo.sizes || [];
          const largest = sizes[sizes.length - 1];
          fileLocation = new Api.InputPhotoFileLocation({
            id: photo.id,
            accessHash: photo.accessHash,
            fileReference: photo.fileReference,
            thumbSize: largest?.type || "x",
          });
        }

        if (fileLocation) {
          try {
            const req = new Api.upload.GetFile({
              location: fileLocation,
              offset: toBigInt(alignedStart),
              limit: CHUNK_SIZE,
            });
            const res: any = await client.invoke(req);
            if (res && res.bytes) {
              chunkBuffer = Buffer.from(res.bytes);
            }
          } catch (invokeErr) {
            console.warn("[TelegramAuthDO Stream] Direct GetFile warning:", invokeErr);
          }
        }

        // Fallback to client.downloadMedia if direct RPC failed
        if (!chunkBuffer) {
          try {
            const fullBuf = await client.downloadMedia(msg.media, {});
            if (fullBuf && fullBuf.length > 0) {
              const b = Buffer.from(fullBuf);
              chunkBuffer = b.subarray(alignedStart, alignedStart + CHUNK_SIZE);
            }
          } catch (dlErr) {
            console.warn("[TelegramAuthDO Stream] downloadMedia fallback error:", dlErr);
          }
        }

        if (chunkBuffer && chunkBuffer.length > 0) {
          // Cache in R2 in background for 0ms future playback
          r2.put(chunkR2Key, chunkBuffer, "application/octet-stream").catch(() => {});
        }
      }

      const sliceStart = start - alignedStart;
      const sliceEnd = Math.min(sliceStart + (end - start + 1), chunkBuffer?.length || 0);
      const exactSlice = chunkBuffer ? chunkBuffer.subarray(sliceStart, sliceEnd) : Buffer.alloc(0);
      const actualEnd = start + exactSlice.length - 1;

      return new Response(exactSlice as any, {
        status: 206,
        headers: {
          "Content-Range": `bytes ${start}-${actualEnd}/${totalSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": exactSlice.length.toString(),
          "Content-Type": item.mime_type || "video/mp4",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges",
        },
      });
    } catch (err: any) {
      console.error("[TelegramAuthDO Stream Error]:", err);
      return new Response(err.message || "Streaming failed", { status: 500 });
    }
  }

  private async handleUploadWebSocket(ws: WebSocket, envObj: any) {
    let client: any = null;
    let uploadState: {
      userId: string;
      channelId: string;
      fileId: any;
      fileName: string;
      fileSize: number;
      mimeType: string;
      totalChunks: number;
      chunks?: Buffer[];
      uploadedParts: Set<number>;
      width?: number;
      height?: number;
      duration?: number;
      blurHash?: string;
      thumbnailBase64?: string;
      capturedAt?: string;
      isBig: boolean;
      isVideo: boolean;
      targetPeer?: any;
    } | null = null;

    const logToClient = (stage: string, detail: any) => {
      console.log(`[UploadWS:${stage}]`, detail);
      try {
        ws.send(JSON.stringify({ type: "debug_log", stage, detail, timestamp: Date.now() }));
      } catch {}
    };

    ws.addEventListener("close", (ev: any) => {
      console.log(`[UploadWS] Client disconnected (code: ${ev?.code}, reason: ${ev?.reason})`);
    });

    ws.addEventListener("error", (err: any) => {
      console.error("[UploadWS] Error on socket:", err);
    });

    ws.addEventListener("message", async (event: any) => {
      const msgT0 = Date.now();
      try {
        const rawData = event.data;

        // 1. Text / JSON Message: Control Frames ("init", "complete")
        if (typeof rawData === "string") {
          let msg: any;
          try {
            msg = JSON.parse(rawData);
          } catch {
            ws.send(JSON.stringify({ type: "error", error: "Invalid JSON format" }));
            return;
          }

          if (msg.type === "init") {
            logToClient("INIT_RECEIVED", { fileName: msg.fileName, fileSize: msg.fileSize, totalChunks: msg.totalChunks });
            const token = msg.token;
            if (!token) {
              ws.send(JSON.stringify({ type: "error", error: "Authentication token required" }));
              return;
            }

            const db = getDb(envObj?.DB);
            const session = await db.get(
              `SELECT u.id as user_id, u.session_string FROM user_sessions s
               JOIN users u ON u.id = s.user_id
               WHERE s.id = ? AND s.expires_at > CURRENT_TIMESTAMP`,
              [token]
            );

            if (!session) {
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

            let clientRecord = this.userClients.get(session.user_id);
            client = clientRecord?.client;

            if (!client || !client.connected) {
              logToClient("CONNECTING_MTPROTO", { userId: session.user_id });
              const decrypted = await decryptSession(session.session_string, envObj?.SESSION_ENCRYPTION_KEY);
              client = await getConnectedClient(decrypted, getDefaultTelegramConfig(envObj));
              this.userClients.set(session.user_id, { client, lastUsed: Date.now() });
            }

            logToClient("MTPROTO_READY", { dcId: client.session.dcId, connected: client.connected });

            const fileSize = Number(msg.fileSize) || 0;
            const isBig = fileSize > 10 * 1024 * 1024;
            const isVideo = msg.mimeType ? msg.mimeType.startsWith("video/") : false;
            const fileId = helpers.readBigIntFromBuffer(helpers.generateRandomBytes(8), true, true);
            const totalChunks = Number(msg.totalChunks) || Math.ceil(fileSize / (128 * 1024));

            let targetPeer: any = channel.telegram_channel_id;
            if (channel.telegram_channel_id === "me") {
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
              totalChunks,
              chunks: new Array(totalChunks),
              uploadedParts: new Set<number>(),
              width: msg.width,
              height: msg.height,
              duration: msg.duration,
              blurHash: msg.blurHash || "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
              thumbnailBase64: msg.thumbnailBase64 || "",
              capturedAt: msg.capturedAt || new Date().toISOString(),
              isBig,
              isVideo,
              targetPeer,
            };

            ws.send(JSON.stringify({
              type: "init_ok",
              uploadId: fileId.toString(),
              totalChunks,
              chunkSize: 128 * 1024,
            }));
            logToClient("INIT_CONFIRMED", { fileName: uploadState?.fileName, isBig, totalChunks });
            return;
          }
        }

        // 2. Binary Chunk Frame: [ 4-byte Int32 chunkIndex | chunk bytes ]
        let binaryBuf: Buffer;
        if (rawData instanceof ArrayBuffer) {
          binaryBuf = Buffer.from(rawData);
        } else if (ArrayBuffer.isView(rawData)) {
          binaryBuf = Buffer.from(rawData.buffer, rawData.byteOffset, rawData.byteLength);
        } else if (Buffer.isBuffer(rawData)) {
          binaryBuf = rawData;
        } else {
          logToClient("UNEXPECTED_DATA_TYPE", { type: typeof rawData });
          return;
        }

        if (!uploadState || !client) {
          logToClient("CHUNK_BEFORE_INIT_ERROR", "Received binary chunk before init handshake");
          ws.send(JSON.stringify({ type: "error", error: "Received chunk before init" }));
          return;
        }

        if (binaryBuf.length < 5) {
          logToClient("FRAME_TOO_SHORT", { byteLength: binaryBuf.length });
          ws.send(JSON.stringify({ type: "error", error: "Chunk frame too short (missing 4-byte header)" }));
          return;
        }

        const chunkIndex = binaryBuf.readInt32BE(0);
        const chunkBytes = binaryBuf.subarray(4);

        if (!uploadState.chunks) uploadState.chunks = new Array(uploadState.totalChunks);
        uploadState.chunks[chunkIndex] = chunkBytes;
        uploadState.uploadedParts.add(chunkIndex);

        // Chunks received: 0% -> 40%
        const browserTransferPercent = Math.min(
          Math.round((uploadState.uploadedParts.size / uploadState.totalChunks) * 40),
          40
        );

        logToClient("CHUNK_RECEIVED_OK", {
          chunkIndex,
          chunkBytes: chunkBytes.length,
          received: uploadState.uploadedParts.size,
          total: uploadState.totalChunks,
          percent: browserTransferPercent,
        });

        ws.send(JSON.stringify({
          type: "chunk_ack",
          chunkIndex,
          uploadedCount: uploadState.uploadedParts.size,
          totalChunks: uploadState.totalChunks,
          percent: browserTransferPercent,
        }));

        // When all browser chunks have arrived, stream directly to Telegram via GramJS sendFile
        if (uploadState.uploadedParts.size === uploadState.totalChunks) {
          logToClient("ALL_BROWSER_CHUNKS_ARRIVED", { total: uploadState.totalChunks });
          const fullBuffer = Buffer.concat(uploadState.chunks.filter(Boolean));
          await this.streamFullBufferToTelegram(ws, client, uploadState, fullBuffer, envObj, logToClient);
        }
      } catch (err: any) {
        console.error("[UploadWS Error]:", err);
        logToClient("UPLOAD_FATAL_ERROR", { error: err.message, stack: err.stack });
        try {
          ws.send(JSON.stringify({ type: "error", error: err.message || "Upload stream failed" }));
        } catch {}
      }
    });
  }

  private async streamFullBufferToTelegram(
    ws: WebSocket,
    client: any,
    state: any,
    fullBuffer: Buffer,
    envObj: any,
    logToClient: any
  ) {
    try {
      const partSize = 128 * 1024;
      const partCount = Math.ceil(fullBuffer.length / partSize);
      const isLarge = fullBuffer.length > 10 * 1024 * 1024;
      const fileId = helpers.readBigIntFromBuffer(helpers.generateRandomBytes(8), true, true);
      logToClient("MTPROTO_PARTS_START", { partCount, isLarge, partSize, dcId: client.session.dcId });

      let lastPercent = 40;
      for (let i = 0; i < partCount; i++) {
        const start = i * partSize;
        const end = Math.min(start + partSize, fullBuffer.length);
        const chunk = fullBuffer.subarray(start, end);

        const partReq = isLarge
          ? new Api.upload.SaveBigFilePart({
              fileId,
              filePart: i,
              fileTotalParts: partCount,
              bytes: chunk,
            })
          : new Api.upload.SaveFilePart({
              fileId,
              filePart: i,
              bytes: chunk,
            });

        const partT0 = Date.now();
        await client.invoke(partReq);
        const durationMs = Date.now() - partT0;

        const overallPercent = 40 + Math.round(((i + 1) / partCount) * 55);
        if (overallPercent > lastPercent || (i + 1) % 5 === 0 || i === partCount - 1) {
          lastPercent = overallPercent;
          logToClient("TELEGRAM_STREAM_PROGRESS", {
            part: i + 1,
            total: partCount,
            percent: overallPercent,
            durationMs,
          });
          try {
            ws.send(JSON.stringify({
              type: "telegram_progress",
              progressPercent: Math.round(((i + 1) / partCount) * 100),
              percent: overallPercent,
            }));
          } catch {}
        }
      }

      const inputFile = isLarge
        ? new Api.InputFileBig({
            id: fileId,
            parts: partCount,
            name: state.fileName,
          })
        : new Api.InputFile({
            id: fileId,
            parts: partCount,
            name: state.fileName,
            md5Checksum: "",
          });

      logToClient("FILE_UPLOADED_TO_MTPROTO", { parts: inputFile.parts });

      const media = state.isVideo
        ? new Api.InputMediaUploadedDocument({
            file: inputFile,
            mimeType: state.mimeType || "video/mp4",
            attributes: [
              new Api.DocumentAttributeVideo({
                duration: Math.round(state.duration || 0),
                w: state.width || 1920,
                h: state.height || 1080,
                supportsStreaming: true,
              }),
            ],
          })
        : new Api.InputMediaUploadedPhoto({
            file: inputFile,
          });

      logToClient("INVOKING_SEND_MEDIA", { targetPeer: state.targetPeer, isVideo: state.isVideo });
      const sentMsg: any = await client.invoke(
        new Api.messages.SendMedia({
          peer: state.targetPeer,
          media,
          message: "",
          randomId: helpers.readBigIntFromBuffer(helpers.generateRandomBytes(8), true, true),
        })
      );

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
      if (state.thumbnailBase64 && envObj?.R2_BUCKET) {
        try {
          const r2 = getR2Storage(envObj.R2_BUCKET);
          thumbnailR2Key = `thumbnails/${state.channelId}/${mediaId}.jpg`;
          const thumbBuf = Buffer.from(state.thumbnailBase64.replace(/^data:image\/\w+;base64,/, ""), "base64");
          await r2.put(thumbnailR2Key, thumbBuf, "image/jpeg").catch(() => {});
        } catch {}
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
          state.channelId,
          state.userId,
          realMessageId,
          state.isVideo ? "video" : "photo",
          state.mimeType,
          state.fileSize,
          state.width || 1920,
          state.height || 1080,
          state.duration || null,
          state.blurHash,
          thumbnailR2Key,
          state.capturedAt,
        ]
      );

      // Background WAL event
      await emitGalleryEvent(client, state.targetPeer, realMessageId, "CREATE", {
        blur_hash: state.blurHash,
        captured_at: state.capturedAt,
      }).catch(() => {});

      ws.send(JSON.stringify({
        type: "complete",
        success: true,
        mediaId,
        telegramMessageId: realMessageId,
        item: {
          id: mediaId,
          channel_id: state.channelId,
          telegram_message_id: realMessageId,
          file_type: state.isVideo ? "video" : "photo",
          mime_type: state.mimeType,
          file_size_bytes: state.fileSize,
          width: state.width || 1920,
          height: state.height || 1080,
          duration_seconds: state.duration || null,
          blur_hash: state.blurHash,
          thumbnail_r2_key: thumbnailR2Key,
          captured_at: state.capturedAt,
        },
      }));
      logToClient("UPLOAD_COMPLETE_DONE", { mediaId });
    } catch (err: any) {
      console.error("[UploadWS stream error]:", err);
      logToClient("TELEGRAM_STREAM_ERROR", { error: err.message, stack: err.stack });
      ws.send(JSON.stringify({ type: "error", error: err.message || "Failed streaming file to Telegram" }));
    }
  }

  private async finalizeUploadWs(ws: WebSocket, client: any, state: any, envObj: any, logToClient?: any) {
    try {
      const log = logToClient || console.log;
      log("FINALIZING_MEDIA", { fileName: state.fileName, totalParts: state.totalChunks });

      const inputFile = state.isBig
        ? new Api.InputFileBig({
            id: state.fileId,
            parts: state.totalChunks,
            name: state.fileName,
          })
        : new Api.InputFile({
            id: state.fileId,
            parts: state.totalChunks,
            name: state.fileName,
            md5Checksum: "",
          });

      const media = state.isVideo
        ? new Api.InputMediaUploadedDocument({
            file: inputFile,
            mimeType: state.mimeType || "video/mp4",
            attributes: [
              new Api.DocumentAttributeVideo({
                duration: Math.round(state.duration || 0),
                w: state.width || 1920,
                h: state.height || 1080,
                supportsStreaming: true,
              }),
            ],
          })
        : new Api.InputMediaUploadedPhoto({
            file: inputFile,
          });

      log("INVOKING_SEND_MEDIA", { targetPeer: state.targetPeer, isVideo: state.isVideo });
      const sentMsg: any = await client.invoke(
        new Api.messages.SendMedia({
          peer: state.targetPeer,
          media,
          message: "",
          randomId: helpers.readBigIntFromBuffer(helpers.generateRandomBytes(8), true, true),
        })
      );

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

      log("SEND_MEDIA_SUCCESS", { realMessageId });
      const mediaId = crypto.randomUUID();
      const db = getDb(envObj?.DB);

      let thumbnailR2Key: string | null = null;
      if (state.thumbnailBase64 && envObj?.R2_BUCKET) {
        try {
          const r2 = getR2Storage(envObj.R2_BUCKET);
          thumbnailR2Key = `thumbnails/${state.channelId}/${mediaId}.jpg`;
          const thumbBuf = Buffer.from(state.thumbnailBase64.replace(/^data:image\/\w+;base64,/, ""), "base64");
          await r2.put(thumbnailR2Key, thumbBuf, "image/jpeg").catch(() => {});
        } catch {}
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
          state.channelId,
          state.userId,
          realMessageId,
          state.isVideo ? "video" : "photo",
          state.mimeType,
          state.fileSize,
          state.width || 1920,
          state.height || 1080,
          state.duration || null,
          state.blurHash,
          thumbnailR2Key,
          state.capturedAt,
        ]
      );

      // Background WAL event
      await emitGalleryEvent(client, state.targetPeer, realMessageId, "CREATE", {
        blur_hash: state.blurHash,
        captured_at: state.capturedAt,
      }).catch(() => {});

      ws.send(JSON.stringify({
        type: "complete",
        success: true,
        mediaId,
        telegramMessageId: realMessageId,
        item: {
          id: mediaId,
          channel_id: state.channelId,
          telegram_message_id: realMessageId,
          file_type: state.isVideo ? "video" : "photo",
          mime_type: state.mimeType,
          file_size_bytes: state.fileSize,
          width: state.width || 1920,
          height: state.height || 1080,
          duration_seconds: state.duration || null,
          blur_hash: state.blurHash,
          thumbnail_r2_key: thumbnailR2Key,
          captured_at: state.capturedAt,
        },
      }));
      log("UPLOAD_COMPLETE_DONE", { mediaId });
    } catch (err: any) {
      console.error("[UploadWS finalize error]:", err);
      ws.send(JSON.stringify({ type: "error", error: err.message || "Failed finalizing upload" }));
    }
  }

  private async handleUpload(request: Request, envObj: any): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.endsWith("/init")) {
      return this.handleUploadInit(request, envObj);
    }
    if (url.pathname.endsWith("/chunk")) {
      return this.handleUploadChunk(request, envObj);
    }
    if (url.pathname.endsWith("/complete")) {
      return this.handleUploadComplete(request, envObj);
    }
    return this.handleUploadOneShot(request, envObj);
  }

  private async handleUploadInit(request: Request, envObj: any): Promise<Response> {
    try {
      const cookieHeader = request.headers.get("cookie") || "";
      const match = cookieHeader.match(/tg_session=([^;]+)/);
      const token = match ? match[1] : request.headers.get("x-tg-session");
      if (!token) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      const db = getDb(envObj?.DB);
      const session = await db.get(
        `SELECT u.id as user_id, u.session_string FROM user_sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.id = ? AND s.expires_at > CURRENT_TIMESTAMP`,
        [token]
      );
      if (!session) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
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

      const channel = await db.get(
        `SELECT c.* FROM channels c
         JOIN gallery_channels gc ON gc.channel_id = c.id
         WHERE c.id = ? AND gc.user_id = ?`,
        [channel_id, session.user_id]
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

      // Eagerly connect/warm up MTProto client and upload sender in RAM so first chunk is instantaneous
      if (!this.userClients.get(session.user_id)?.client?.connected) {
        try {
          const decrypted = await decryptSession(session.session_string, envObj?.SESSION_ENCRYPTION_KEY);
          const client = await getConnectedClient(decrypted, getDefaultTelegramConfig(envObj));
          await client.getSender(client.session.dcId);
          this.userClients.set(session.user_id, { client, lastUsed: Date.now() });
        } catch (warmErr) {
          console.warn("[UploadInit] Client warmup warning:", warmErr);
        }
      }

      this.uploadSessions.set(uploadId, {
        userId: session.user_id,
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
          chunk_size: 1048576,
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

  private async handleUploadChunk(request: Request, envObj: any): Promise<Response> {
    const startT0 = Date.now();
    try {
      const cookieHeader = request.headers.get("cookie") || "";
      const match = cookieHeader.match(/tg_session=([^;]+)/);
      const token = match ? match[1] : request.headers.get("x-tg-session");
      if (!token) {
        console.warn("[UploadChunk] No token in cookie or x-tg-session header");
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      const db = getDb(envObj?.DB);
      const session = await db.get(
        `SELECT u.id as user_id, u.session_string FROM user_sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.id = ? AND s.expires_at > CURRENT_TIMESTAMP`,
        [token]
      );
      if (!session) {
        console.warn("[UploadChunk] Token not found or expired in DB:", token.slice(0, 8) + "...");
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      const formData = await request.formData();
      const uploadId = formData.get("upload_id") as string;
      const chunkIndex = parseInt(formData.get("chunk_index") as string, 10);
      const chunkBlob = formData.get("chunk") as Blob;

      console.log(`[UploadChunk] Request parsed: uploadId=${uploadId}, chunkIndex=${chunkIndex}, hasBlob=${!!chunkBlob}`);

      if (!uploadId || isNaN(chunkIndex) || !chunkBlob) {
        return new Response(
          JSON.stringify({ error: "upload_id, chunk_index, and chunk required" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      const uploadSession = this.uploadSessions.get(uploadId);
      if (!uploadSession || uploadSession.userId !== session.user_id) {
        console.warn(`[UploadChunk] Upload session ${uploadId} not found in DO RAM. Active sessions: ${Array.from(this.uploadSessions.keys()).join(",")}`);
        return new Response(JSON.stringify({ error: "Upload session expired or invalid" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      let clientRecord = this.userClients.get(session.user_id);
      let client = clientRecord?.client;

      if (!client || !client.connected) {
        console.log(`[UploadChunk] MTProto client not connected in RAM for user ${session.user_id}, connecting now...`);
        const decrypted = await decryptSession(session.session_string, envObj?.SESSION_ENCRYPTION_KEY);
        client = await getConnectedClient(decrypted, getDefaultTelegramConfig(envObj));
        this.userClients.set(session.user_id, { client, lastUsed: Date.now() });
        console.log(`[UploadChunk] MTProto client connected to DC ${client.session.dcId}`);
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

      console.log(`[UploadChunk] Getting upload sender for DC ${client.session.dcId}...`);
      const sender = await client.getSender(client.session.dcId);
      console.log(`[UploadChunk] Upload sender isConnected: ${sender.isConnected()}. Invoking send(${isBig ? "SaveBigFilePart" : "SaveFilePart"}, part=${chunkIndex}/${uploadSession.totalParts}, size=${chunkBuffer.length})...`);

      const partResult = await Promise.race([
        sender.send(partReq),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Telegram MTProto upload part timed out after 30s")), 30000)
        ),
      ]);

      console.log(`[UploadChunk] Part ${chunkIndex} ACK from Telegram in ${Date.now() - startT0}ms! Result:`, partResult);
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
          name: err.name,
          stack: err.stack,
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  private async handleUploadComplete(request: Request, envObj: any): Promise<Response> {
    try {
      const cookieHeader = request.headers.get("cookie") || "";
      const match = cookieHeader.match(/tg_session=([^;]+)/);
      const token = match ? match[1] : request.headers.get("x-tg-session");
      if (!token) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      const db = getDb(envObj?.DB);
      const session = await db.get(
        `SELECT u.id as user_id, u.session_string FROM user_sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.id = ? AND s.expires_at > CURRENT_TIMESTAMP`,
        [token]
      );
      if (!session) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

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
      if (!uploadSession || uploadSession.userId !== session.user_id) {
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
        [channel_id || uploadSession.channelId, session.user_id]
      );
      if (!channel) {
        return new Response(JSON.stringify({ error: "Channel not found or unauthorized" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      let clientRecord = this.userClients.get(session.user_id);
      let client = clientRecord?.client;

      if (!client || !client.connected) {
        const decrypted = await decryptSession(session.session_string, envObj?.SESSION_ENCRYPTION_KEY);
        client = await getConnectedClient(decrypted, getDefaultTelegramConfig(envObj));
        this.userClients.set(session.user_id, { client, lastUsed: Date.now() });
      }

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

      const isVideo = uploadSession.isVideo;
      const sentMsg = await client.sendFile(targetPeer, {
        file: inputFile,
        forceDocument: false,
        attributes: isVideo
          ? [
              new Api.DocumentAttributeVideo({
                duration: Math.round(Number(duration) || 0),
                w: Number(width) || 1920,
                h: Number(height) || 1080,
                supportsStreaming: true,
              }),
            ]
          : undefined,
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
          session.user_id,
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
      await emitGalleryEvent(client, targetPeer, realMessageId, "CREATE", {
        blur_hash: blur_hash || "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
        captured_at: captured_at || new Date().toISOString(),
      });

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

  private async handleUploadOneShot(request: Request, envObj: any): Promise<Response> {
    try {
      const cookieHeader = request.headers.get("cookie") || "";
      const match = cookieHeader.match(/tg_session=([^;]+)/);
      const token = match ? match[1] : request.headers.get("x-tg-session");
      if (!token) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      const db = getDb(envObj?.DB);
      const session = await db.get(
        `SELECT u.id as user_id, u.session_string FROM user_sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.id = ? AND s.expires_at > CURRENT_TIMESTAMP`,
        [token]
      );
      if (!session) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
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

      if (!file || !channelId) {
        return new Response(JSON.stringify({ error: "File and channel_id are required" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const channel = await db.get(
        `SELECT c.* FROM channels c
         JOIN gallery_channels gc ON gc.channel_id = c.id
         WHERE c.id = ? AND gc.user_id = ?`,
        [channelId, session.user_id]
      );

      if (!channel) {
        return new Response(JSON.stringify({ error: "Channel not found or unauthorized" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      console.log(`[UploadOneShot] Received file: ${file.name} (${file.size} bytes), target channel: ${channelId}`);
      let clientRecord = this.userClients.get(session.user_id);
      let client = clientRecord?.client;

      if (!client || !client.connected) {
        console.log(`[UploadOneShot] Connecting MTProto client for user ${session.user_id}...`);
        const decrypted = await decryptSession(session.session_string, envObj?.SESSION_ENCRYPTION_KEY);
        client = await getConnectedClient(decrypted, getDefaultTelegramConfig(envObj));
        this.userClients.set(session.user_id, { client, lastUsed: Date.now() });
      }

      console.log(`[UploadOneShot] MTProto client ready on DC ${client.session.dcId}. Reading file buffer...`);
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

      console.log(`[UploadOneShot] Streaming file to Telegram targetPeer (${targetPeer})...`);
      let sentMsg: any;
      try {
        sentMsg = await client.sendFile(targetPeer, {
          file: customFile,
          workers: 1,
          forceDocument: false,
        });
        console.log(`[UploadOneShot] Telegram sendFile SUCCESS! Message ID: ${sentMsg.id}`);
      } catch (sendErr: any) {
        if (sendErr?.errorMessage === "CHAT_WRITE_FORBIDDEN" || sendErr?.message?.includes("CHAT_WRITE_FORBIDDEN")) {
          return new Response(
            JSON.stringify({
              error: "You do not have post/admin permissions in this Telegram channel. Please select 'Saved Messages' or a private channel/group you own.",
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
           blur_hash, thumbnail_r2_key, captured_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(channel_id, telegram_message_id) DO UPDATE SET
           file_size_bytes = excluded.file_size_bytes,
           width = excluded.width,
           height = excluded.height,
           duration_seconds = excluded.duration_seconds`,
        [
          mediaId, channelId, session.user_id, realMessageId, isVideo ? "video" : "photo",
          file.type || (isVideo ? "video/mp4" : "image/jpeg"), file.size, width, height, duration,
          blurHash, thumbnailR2Key, capturedAt
        ]
      );

      // Emit Telegram WAL Event in background
      await emitGalleryEvent(client, targetPeer, realMessageId, "CREATE", {
        blur_hash: blurHash,
        captured_at: capturedAt,
      });

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
