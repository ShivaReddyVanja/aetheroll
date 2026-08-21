import QRCode from "qrcode";
import crypto from "crypto";
import { Api, helpers } from "telegram";
import bigInt from "big-integer";
import { getDb } from "../lib/db";
import { encryptSession, decryptSession } from "../lib/crypto";
import { extractSessionToken, generateCompositeSessionToken } from "../lib/auth";
import { getR2Storage } from "../lib/r2";
import {
  createTelegramClient,
  getConnectedClient,
  getDefaultTelegramConfig,
  startQrLogin,
  checkQrLoginStatus,
} from "../lib/telegram";
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
  activeSessions: Map<string, { client: any; qrImage?: string; token?: Buffer; tokenBuffer?: Buffer; qrUrl?: string; expires?: number; authenticatedUser?: any; sessionToken?: string; error?: string }>;
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
  mediaLocationCache: Map<string, { fileLocation: any; dcId?: number; expires: number }>;
  inFlightPrefetches: Map<string, Promise<Buffer | null>>;
  prefetchedChunks: Map<string, { buffer: Buffer; expires: number }>;
  recentLogs: Array<{
    id: string;
    timestamp: number;
    category: "EDGE_CACHE" | "STREAM" | "PREFETCH" | "UPLOAD" | "MTPROTO" | "RAM" | "AUTH";
    level: "info" | "success" | "warn" | "error";
    message: string;
    meta?: any;
  }>;
  logStreamControllers: Set<ReadableStreamDefaultController>;

  constructor(state: any, env: any) {
    this.state = state;
    this.env = env;
    this.activeSessions = new Map();
    this.userClients = new Map();
    this.uploadSessions = new Map();
    this.mediaLocationCache = new Map();
    this.inFlightPrefetches = new Map();
    this.prefetchedChunks = new Map();
    this.recentLogs = [];
    this.logStreamControllers = new Set();
  }

  /**
   * Unified session resolution and MTProto client warmup with Dual-Key decryption & idle tracking
   */
  async getOrConnectUserClient(
    request: Request,
    envObj: any
  ): Promise<{ client: any; userId?: string; sessionId?: string; error?: string }> {
    this.sweepIdleClients();

    const parsed = extractSessionToken(request);
    if (!parsed) {
      return { client: null, error: "Unauthorized: Missing session token" };
    }

    const cached = this.userClients.get(parsed.fullToken) || this.userClients.get(parsed.sessionId);
    if (cached && cached.client && cached.client.connected) {
      cached.lastUsed = Date.now();
      return { client: cached.client, userId: (cached.client as any).__userId, sessionId: parsed.sessionId };
    }

    const db = getDb(envObj?.DB);
    const session = await db.get(
      `SELECT u.id as user_id, u.telegram_user_id, u.display_name, u.session_string, s.expires_at
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > CURRENT_TIMESTAMP`,
      [parsed.sessionId]
    );

    if (!session) {
      return { client: null, error: "Unauthorized: Session not found or expired" };
    }

    try {
      const decrypted = await decryptSession(
        session.session_string,
        envObj?.SESSION_ENCRYPTION_KEY,
        parsed.clientSecret
      );
      const config = getDefaultTelegramConfig(envObj);
      const client = await getConnectedClient(decrypted, config);
      (client as any).__userId = session.user_id;

      this.userClients.set(parsed.fullToken, { client, lastUsed: Date.now() });
      this.userClients.set(parsed.sessionId, { client, lastUsed: Date.now() });
      return { client, userId: session.user_id, sessionId: parsed.sessionId };
    } catch (decryptErr: any) {
      return { client: null, error: "Unauthorized: Session decryption failed" };
    }
  }

  /**
   * 15-minute sliding inactivity sweeper that disconnects idle sessions from RAM
   */
  sweepIdleClients() {
    const now = Date.now();
    const IDLE_LIMIT = 15 * 60 * 1000;
    for (const [key, entry] of this.userClients.entries()) {
      if (now - entry.lastUsed > IDLE_LIMIT) {
        try {
          if (entry.client && typeof entry.client.disconnect === "function") {
            entry.client.disconnect();
          }
        } catch {}
        this.userClients.delete(key);
      }
    }
  }

  isTelemetryActive(envObj?: any): boolean {
    const flag =
      envObj?.ENABLE_TELEMETRY ??
      this.env?.ENABLE_TELEMETRY ??
      process.env?.ENABLE_TELEMETRY ??
      process.env?.NEXT_PUBLIC_ENABLE_TELEMETRY;
    if (flag === true || flag === 1) return true;
    if (typeof flag === "string") {
      const lower = flag.trim().toLowerCase();
      return lower === "true" || lower === "1" || lower === "yes" || lower === "enabled";
    }
    return false;
  }

  logEvent(
    category: "EDGE_CACHE" | "STREAM" | "PREFETCH" | "UPLOAD" | "MTPROTO" | "RAM" | "AUTH",
    level: "info" | "success" | "warn" | "error",
    message: string,
    meta?: any,
    forwardToCentral: boolean = true
  ) {
    if (!this.isTelemetryActive(this.env)) {
      return; // 0 memory allocation, 0 CPU overhead, 0 data leakage
    }

    const entry = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: Date.now(),
      category,
      level,
      message,
      meta,
    };
    this.recentLogs.push(entry);
    if (this.recentLogs.length > 250) {
      this.recentLogs.shift();
    }
    const data = `data: ${JSON.stringify(entry)}\n\n`;
    const encoded = new TextEncoder().encode(data);
    for (const controller of Array.from(this.logStreamControllers)) {
      try {
        controller.enqueue(encoded);
      } catch {
        this.logStreamControllers.delete(controller);
      }
    }

    // Only forward to central global_telemetry DO if forwardToCentral is true AND we are not already global_telemetry
    if (forwardToCentral) {
      try {
        const authDo = this.env?.AUTH_DO;
        if (authDo && typeof authDo.idFromName === "function") {
          const centralId = authDo.idFromName("global_telemetry");
          if (this.state?.id && this.state.id.toString() !== centralId.toString()) {
            const telemetryDo = authDo.get(centralId);
            telemetryDo
              .fetch("https://telegram-gallery.cache/log", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(entry),
              })
              .catch(() => {});
          }
        }
      } catch {}
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    const headerApiId = request.headers.get("x-tg-api-id");
    const headerApiHash = request.headers.get("x-tg-api-hash");
    const headerTestMode = request.headers.get("x-tg-test-mode");
    const headerEncKey = request.headers.get("x-tg-enc-key");
    const headerTelemetry = request.headers.get("x-enable-telemetry");

    const effectiveEnv = {
      ...this.env,
      TELEGRAM_API_ID: headerApiId || this.env?.TELEGRAM_API_ID || process.env?.TELEGRAM_API_ID,
      TELEGRAM_API_HASH: headerApiHash || this.env?.TELEGRAM_API_HASH || process.env?.TELEGRAM_API_HASH,
      TELEGRAM_TEST_MODE: headerTestMode || this.env?.TELEGRAM_TEST_MODE || process.env?.TELEGRAM_TEST_MODE,
      SESSION_ENCRYPTION_KEY: headerEncKey || this.env?.SESSION_ENCRYPTION_KEY || process.env?.SESSION_ENCRYPTION_KEY,
      ENABLE_TELEMETRY: headerTelemetry || this.env?.ENABLE_TELEMETRY || process.env?.ENABLE_TELEMETRY,
    };

    // 0. Live Log Stream (Server-Sent Events) - Strictly gated behind isTelemetryActive
    if (url.pathname.includes("/logs/stream") || url.pathname.endsWith("/stream-logs")) {
      if (!this.isTelemetryActive(effectiveEnv)) {
        return new Response("Not Found", { status: 404 });
      }

      const stream = new ReadableStream({
        start: (controller) => {
          this.logStreamControllers.add(controller);
          // Immediately flush recent backlog
          for (const log of this.recentLogs) {
            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(log)}\n\n`));
          }

          // Initial welcome event
          if (this.recentLogs.length === 0) {
            controller.enqueue(
              new TextEncoder().encode(
                `data: ${JSON.stringify({
                  id: "init",
                  timestamp: Date.now(),
                  category: "SYSTEM",
                  level: "info",
                  message: "Connected to Live Cloudflare Telemetry Stream",
                })}\n\n`
              )
            );
          }
        },
        cancel: (controller) => {
          this.logStreamControllers.delete(controller);
        },
      });

      const origin = request.headers.get("origin") || "*";
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Credentials": "true",
        },
      });
    }

    // 0b. External Log Ingestion - Strictly gated behind isTelemetryActive (non-recursive)
    if (url.pathname.endsWith("/log") && request.method === "POST") {
      if (!this.isTelemetryActive(effectiveEnv)) {
        return new Response("Not Found", { status: 404 });
      }

      const body = (await request.json().catch(() => ({}))) as any;
      if (body?.category && body?.message) {
        this.logEvent(body.category, body.level || "info", body.message, body.meta, false);
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

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

    // 5. HTTP QR Generation endpoint
    if (url.pathname.endsWith("/qr") && request.method === "GET") {
      return this.handleQrHttp(effectiveEnv);
    }

    // 6. HTTP QR Check polling endpoint
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

        // Dual-Key Zero-Knowledge Token Generation
        const { sessionId, clientSecret, sessionToken } = generateCompositeSessionToken();
        const encryptedSession = await encryptSession(
          sessionString,
          this.env?.SESSION_ENCRYPTION_KEY,
          clientSecret
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

        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

        await db.run(
          "INSERT INTO user_sessions (id, user_id, expires_at) VALUES (?, ?, ?)",
          [sessionId, userId, expiresAt]
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
      console.error("[TelegramAuthDO WS Exception]:", err);
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
    try {
      const targetEnv = envObj || this.env;
      const { token, expires, client, tokenBuffer } = await startQrLogin(targetEnv);

      // Generate pure SVG QR code
      const qrSvg = await QRCode.toString(token, {
        type: "svg",
        width: 280,
        margin: 2,
        color: { dark: "#000000", light: "#ffffff" },
      });
      const qrImage = `data:image/svg+xml;utf8,${encodeURIComponent(qrSvg)}`;

      this.activeSessions.set(qrId, {
        client,
        tokenBuffer,
        expires,
        qrImage,
        qrUrl: token,
      });

      return new Response(
        JSON.stringify({
          qrId,
          qrUrl: token,
          qrImage,
          expires,
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    } catch (err: any) {
      const errMsg = err?.errorMessage || err?.message || (typeof err === "object" ? (err.description || JSON.stringify(err)) : String(err));
      console.error("[handleQrHttp Error]:", errMsg, err);
      return new Response(JSON.stringify({ error: errMsg || "Failed generating QR" }), {
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
    if (!sessionState || !sessionState.client || !sessionState.tokenBuffer) {
      return new Response(JSON.stringify({ error: "Session expired or invalid" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      const targetEnv = envObj || this.env;
      const check = await checkQrLoginStatus(sessionState.client, sessionState.tokenBuffer, targetEnv);

      if (check.success && check.sessionString && check.user) {
        const db = getDb(targetEnv?.DB);
        const telegramUserId = check.user.id?.toString() || check.user.id;
        const displayName =
          [check.user.firstName, check.user.lastName].filter(Boolean).join(" ") ||
          check.user.username ||
          "Telegram User";

        // Dual-Key Zero-Knowledge Token Generation
        const { sessionId, clientSecret, sessionToken } = generateCompositeSessionToken();
        const encryptedSession = await encryptSession(
          check.sessionString,
          targetEnv?.SESSION_ENCRYPTION_KEY,
          clientSecret
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

        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

        await db.run(
          "INSERT INTO user_sessions (id, user_id, expires_at) VALUES (?, ?, ?)",
          [sessionId, userId, expiresAt]
        );

        const cookieValue = `tg_session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`;
        const response = new Response(
          JSON.stringify({
            success: true,
            sessionToken,
            user: {
              id: userId,
              telegramUserId,
              displayName,
            },
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
    } catch (checkErr: any) {
      console.error("[handleCheckHttp Error]:", checkErr);
      return new Response(JSON.stringify({ error: checkErr.message || "Failed checking login" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  private async resolveMediaLocation(client: any, item: any): Promise<any> {
    const now = Date.now();
    const cached = this.mediaLocationCache.get(item.id);
    if (cached && cached.expires > now) {
      return cached.fileLocation;
    }

    let targetPeer: any = item.telegram_channel_id;
    if (item.telegram_channel_id !== "me") {
      try { targetPeer = await client.getInputEntity(item.telegram_channel_id); }
      catch { try { targetPeer = await client.getEntity(item.telegram_channel_id); } catch {} }
    }

    const msgId = Number(item.telegram_message_id);
    const messages = await client.getMessages(targetPeer, { ids: [msgId] });
    const msg = messages[0];
    if (!msg || !msg.media) return null;

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
      this.mediaLocationCache.set(item.id, {
        fileLocation,
        expires: now + 60 * 60 * 1000, // 1 hour TTL
      });
    }

    return fileLocation;
  }

  private storeChunkInRam(chunkKey: string, buffer: Buffer) {
    const now = Date.now();
    // Keep max 8 chunks in memory (~4MB max) to stay well within Cloudflare Worker memory limits
    if (this.prefetchedChunks.size >= 8) {
      const oldestKey = this.prefetchedChunks.keys().next().value;
      if (oldestKey) this.prefetchedChunks.delete(oldestKey);
    }
    this.prefetchedChunks.set(chunkKey, {
      buffer,
      expires: now + 3 * 60 * 1000, // 3 minutes TTL
    });
  }

  private async fetchSingleChunk(
    client: any,
    item: any,
    fileLocation: any,
    alignedOffset: number,
    r2: any
  ): Promise<Buffer | null> {
    const chunkKey = `${item.id}:${alignedOffset}`;
    const now = Date.now();

    // 1. Check RAM Cache (0ms)
    const ramCached = this.prefetchedChunks.get(chunkKey);
    if (ramCached && ramCached.expires > now) {
      this.logEvent("RAM", "success", `⚡ [RAM Hit 0ms] Chunk offset=${alignedOffset} (512KB)`);
      return ramCached.buffer;
    }

    // 2. Check R2 Cache (sub-15ms)
    const chunkR2Key = `chunks/${item.id}/${alignedOffset}.bin`;
    try {
      const r2Start = Date.now();
      const r2Cached: any = await r2.get(chunkR2Key);
      if (r2Cached) {
        const buf = Buffer.isBuffer(r2Cached)
          ? r2Cached
          : Buffer.from(typeof r2Cached.arrayBuffer === "function" ? await r2Cached.arrayBuffer() : r2Cached);
        this.storeChunkInRam(chunkKey, buf);
        this.logEvent("RAM", "info", `📦 [R2 Hit ${Date.now() - r2Start}ms] Chunk offset=${alignedOffset} (512KB)`);
        return buf;
      }
    } catch {}

    // 3. Check In-Flight Promise (deduplication of parallel requests)
    const existingInFlight = this.inFlightPrefetches.get(chunkKey);
    if (existingInFlight) {
      this.logEvent("PREFETCH", "info", `🔗 [In-Flight Promise Share] Joining existing fetch for offset=${alignedOffset}`);
      return existingInFlight;
    }

    // 4. Launch new MTProto GetFile RPC
    const fetchPromise = (async (): Promise<Buffer | null> => {
      const mtprotoStart = Date.now();
      try {
        const CHUNK_SIZE = 512 * 1024;
        let chunkBuf: Buffer | null = null;

        if (fileLocation) {
          try {
            this.logEvent("MTPROTO", "warn", `📡 [Telegram RPC] GetFile offset=${alignedOffset} (512KB)...`);
            const req = new Api.upload.GetFile({
              location: fileLocation,
              offset: toBigInt(alignedOffset),
              limit: CHUNK_SIZE,
            });
            const res: any = await Promise.race([
              client.invoke(req),
              new Promise((_, reject) => setTimeout(() => reject(new Error("GetFile MTProto timeout")), 8000)),
            ]);
            if (res && res.bytes) {
              chunkBuf = Buffer.from(res.bytes);
              this.logEvent("MTPROTO", "success", `✅ [Telegram RPC] Received 512KB in ${Date.now() - mtprotoStart}ms (offset=${alignedOffset})`);
            }
          } catch (invokeErr: any) {
            this.logEvent("MTPROTO", "error", `❌ [Telegram RPC Error offset=${alignedOffset}]: ${invokeErr?.message}`);
            // Invalidate location cache if Telegram file reference expired
            if (invokeErr?.errorMessage === "FILE_REFERENCE_EXPIRED") {
              this.mediaLocationCache.delete(item.id);
            }
          }
        }

        if (chunkBuf && chunkBuf.length > 0) {
          this.storeChunkInRam(chunkKey, chunkBuf);
          // Async background R2 write (0ms impact on stream)
          r2.put(chunkR2Key, chunkBuf, "application/octet-stream").catch(() => {});
          return chunkBuf;
        }

        return null;
      } finally {
        this.inFlightPrefetches.delete(chunkKey);
      }
    })();

    this.inFlightPrefetches.set(chunkKey, fetchPromise);
    return fetchPromise;
  }

  private async handleStream(request: Request, envObj: any): Promise<Response> {
    try {
      const url = new URL(request.url);
      const mediaId = url.searchParams.get("media_id");
      if (!mediaId) return new Response("media_id required", { status: 400 });

      const { client, userId, error } = await this.getOrConnectUserClient(request, envObj);
      if (!client) return new Response(error || "Unauthorized", { status: 401 });

      const db = getDb(envObj?.DB);
      const item = await db.get(
        `SELECT m.*, c.telegram_channel_id FROM media_items m
         JOIN channels c ON c.id = m.channel_id
         WHERE m.id = ?`,
        [mediaId]
      );
      if (!item) return new Response("Media item not found", { status: 404 });

      const totalSize = Number(item.file_size_bytes) || 0;
      const rangeHeader = request.headers.get("range");
      const r2 = getR2Storage(envObj?.R2_BUCKET);

      // 1. Resolve Media Location (cached in RAM for 1 hour)
      let fileLocation = await this.resolveMediaLocation(client, item);
      if (!fileLocation) {
        this.mediaLocationCache.delete(item.id);
        fileLocation = await this.resolveMediaLocation(client, item);
        if (!fileLocation) return new Response("Media not found in Telegram", { status: 404 });
      }

      if (!rangeHeader) {
        // Full media download fallback
        const msgId = Number(item.telegram_message_id);
        let targetPeer: any = item.telegram_channel_id;
        if (item.telegram_channel_id !== "me") {
          try { targetPeer = await client.getInputEntity(item.telegram_channel_id); }
          catch { try { targetPeer = await client.getEntity(item.telegram_channel_id); } catch {} }
        }
        const messages = await client.getMessages(targetPeer, { ids: [msgId] });
        const msg = messages[0];
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

      // 2. Parse Range header: `bytes=start-end`
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
      this.logEvent("STREAM", "info", `🎬 [Stream Request] ${item.id.slice(0, 8)}... Range: ${start}-${end}/${totalSize} (${((end - start + 1) / 1024).toFixed(0)}KB)`);

      // 3. Speculative Read-Ahead Prefetch
      // Next chunk (K + 1)
      const nextAlignedStart = alignedStart + CHUNK_SIZE;
      if (nextAlignedStart < totalSize) {
        this.logEvent("PREFETCH", "info", `🚀 [Read-Ahead] Prefetching Chunk K+1 (offset=${nextAlignedStart})`);
        this.fetchSingleChunk(client, item, fileLocation, nextAlignedStart, r2).catch(() => {});
      }

      // Initial Playback Optimization: Speculatively prefetch Tail chunk(s) containing MP4 `moov` atom
      if (alignedStart === 0 && totalSize > CHUNK_SIZE) {
        const lastChunkOffset = Math.floor((totalSize - 1) / CHUNK_SIZE) * CHUNK_SIZE;
        if (lastChunkOffset > 0 && lastChunkOffset !== nextAlignedStart) {
          this.logEvent("PREFETCH", "success", `🎯 [Tail moov] Speculative prefetch for atom index (offset=${lastChunkOffset})`);
          this.fetchSingleChunk(client, item, fileLocation, lastChunkOffset, r2).catch(() => {});
        }
        // If file is large (> 5MB), also prefetch second-to-last chunk in case moov spans > 512KB
        if (lastChunkOffset > CHUNK_SIZE * 2) {
          const secondLastChunkOffset = lastChunkOffset - CHUNK_SIZE;
          this.fetchSingleChunk(client, item, fileLocation, secondLastChunkOffset, r2).catch(() => {});
        }
      }

      // 4. Fetch the requested chunk K
      const chunkBuffer = await this.fetchSingleChunk(client, item, fileLocation, alignedStart, r2);
      if (!chunkBuffer || chunkBuffer.length === 0) {
        return new Response("Chunk unavailable", { status: 502 });
      }

      const sliceStart = start - alignedStart;
      const sliceEnd = Math.min(sliceStart + (end - start + 1), chunkBuffer.length);
      const exactSlice = chunkBuffer.subarray(sliceStart, sliceEnd);
      if (exactSlice.length === 0) {
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${totalSize}` },
        });
      }
      const actualEnd = start + exactSlice.length - 1;

      const videoMimeType = item.file_type === "video"
        ? (item.mime_type === "video/webm" ? "video/webm" : "video/mp4")
        : (item.mime_type || "image/jpeg");

      return new Response(exactSlice as any, {
        status: 206,
        headers: {
          "Content-Range": `bytes ${start}-${actualEnd}/${totalSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": exactSlice.length.toString(),
          "Content-Type": videoMimeType,
          "Cache-Control": "public, max-age=31536000, immutable",
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
      totalBrowserChunks: number;
      totalTelegramParts: number;
      uploadedTelegramParts: Set<number>;
      inFlightUploads: Set<Promise<any>>;
      isFinalizing?: boolean;
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

    const TG_PART_SIZE = 512 * 1024;

    const logToClient = (stage: string, detail: any) => {
      console.log(`[UploadWS:${stage}]`, detail);
      try {
        ws.send(JSON.stringify({ type: "debug_log", stage, detail, timestamp: Date.now() }));
      } catch {}
    };

    const finalizeUpload = async () => {
      if (!uploadState || !client) return;
      try {
        logToClient("ALL_MTPROTO_PARTS_UPLOADED", { totalParts: uploadState.totalTelegramParts });

        const inputFile = uploadState.isBig
          ? new Api.InputFileBig({
              id: uploadState.fileId,
              parts: uploadState.totalTelegramParts,
              name: uploadState.fileName,
            })
          : new Api.InputFile({
              id: uploadState.fileId,
              parts: uploadState.totalTelegramParts,
              name: uploadState.fileName,
              md5Checksum: "",
            });

        const media = uploadState.isVideo
          ? new Api.InputMediaUploadedDocument({
              file: inputFile,
              mimeType: uploadState.mimeType || "video/mp4",
              attributes: [
                new Api.DocumentAttributeVideo({
                  duration: Math.round(uploadState.duration || 0),
                  w: uploadState.width || 1920,
                  h: uploadState.height || 1080,
                  supportsStreaming: true,
                }),
              ],
            })
          : new Api.InputMediaUploadedPhoto({
              file: inputFile,
            });

        logToClient("INVOKING_SEND_MEDIA", { targetPeer: uploadState.targetPeer, isVideo: uploadState.isVideo });
        const sentMsg: any = await client.invoke(
          new Api.messages.SendMedia({
            peer: uploadState.targetPeer,
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
             blur_hash, thumbnail_r2_key, captured_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(channel_id, telegram_message_id) DO UPDATE SET
             file_size_bytes = excluded.file_size_bytes,
             width = excluded.width,
             height = excluded.height,
             duration_seconds = excluded.duration_seconds`,
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
          ]
        );

        // Background WAL event
        await emitGalleryEvent(client, uploadState.targetPeer, realMessageId, "CREATE", {
          blur_hash: uploadState.blurHash,
          captured_at: uploadState.capturedAt,
        }).catch(() => {});

        ws.send(JSON.stringify({
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
        }));
        logToClient("UPLOAD_COMPLETE_DONE", { mediaId });
      } catch (finalizeErr: any) {
        console.error("[UploadFinalize Error]:", finalizeErr);
        logToClient("UPLOAD_FINALIZE_ERROR", { error: finalizeErr.message });
        try {
          ws.send(JSON.stringify({ type: "error", error: finalizeErr.message || "Failed finalizing upload" }));
        } catch {}
      }
    };

    const uploadSingleTgPart = async (partIndex: number, partBuffer: Buffer) => {
      if (!uploadState || !client) return;
      const isLarge = uploadState.isBig;
      const partReq = isLarge
        ? new Api.upload.SaveBigFilePart({
            fileId: uploadState.fileId,
            filePart: partIndex,
            fileTotalParts: uploadState.totalTelegramParts,
            bytes: partBuffer,
          })
        : new Api.upload.SaveFilePart({
            fileId: uploadState.fileId,
            filePart: partIndex,
            bytes: partBuffer,
          });

      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const partT0 = Date.now();
          await Promise.race([
            client.invoke(partReq),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error(`MTProto part #${partIndex} timeout after 10s`)), 10000)
            ),
          ]);
          break;
        } catch (partErr: any) {
          console.warn(`[UploadPart #${partIndex}] Attempt ${attempt}/3 failed:`, partErr?.message);
          if (attempt === 3) throw partErr;
          await new Promise((r) => setTimeout(r, 400));
        }
      }

      // Immediately clear buffer reference from memory
      (partBuffer as any) = null;

      uploadState.uploadedTelegramParts.add(partIndex);
      const overallPercent = 40 + Math.round((uploadState.uploadedTelegramParts.size / uploadState.totalTelegramParts) * 55);

      logToClient("TELEGRAM_STREAM_PROGRESS", {
        part: uploadState.uploadedTelegramParts.size,
        total: uploadState.totalTelegramParts,
        percent: overallPercent,
      });

      try {
        ws.send(JSON.stringify({
          type: "telegram_progress",
          progressPercent: Math.round((uploadState.uploadedTelegramParts.size / uploadState.totalTelegramParts) * 100),
          percent: overallPercent,
        }));
      } catch {}

      // If all parts are uploaded, finalize immediately!
      if (uploadState.uploadedTelegramParts.size === uploadState.totalTelegramParts && !uploadState.isFinalizing) {
        uploadState.isFinalizing = true;
        await finalizeUpload();
      }
    };

    ws.addEventListener("close", (ev: any) => {
      console.log(`[UploadWS] Client disconnected (code: ${ev?.code}, reason: ${ev?.reason})`);
    });

    ws.addEventListener("error", (err: any) => {
      console.error("[UploadWS] Error on socket:", err);
    });

    ws.addEventListener("message", async (event: any) => {
      try {
        const rawData = event.data;

        // 1. Text / JSON Message: Control Frames ("init")
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
            const parsed = extractSessionToken({ headers: new Headers({ "x-tg-session": msg.token }) });
            if (!parsed) {
              ws.send(JSON.stringify({ type: "error", error: "Authentication token required" }));
              return;
            }

            const db = getDb(envObj?.DB);
            const session = await db.get(
              `SELECT u.id as user_id, u.session_string FROM user_sessions s
               JOIN users u ON u.id = s.user_id
               WHERE s.id = ? AND s.expires_at > CURRENT_TIMESTAMP`,
              [parsed.sessionId]
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

            let clientRecord = this.userClients.get(parsed.fullToken) || this.userClients.get(parsed.sessionId);
            client = clientRecord?.client;

            if (!client || !client.connected) {
              logToClient("CONNECTING_MTPROTO", { userId: session.user_id });
              const decrypted = await decryptSession(
                session.session_string,
                envObj?.SESSION_ENCRYPTION_KEY,
                parsed.clientSecret
              );
              client = await getConnectedClient(decrypted, getDefaultTelegramConfig(envObj));
              this.userClients.set(parsed.fullToken, { client, lastUsed: Date.now() });
              this.userClients.set(parsed.sessionId, { client, lastUsed: Date.now() });
            }

            logToClient("MTPROTO_READY", { dcId: client.session.dcId, connected: client.connected });

            const fileSize = Number(msg.fileSize) || 0;
            const isBig = fileSize > 10 * 1024 * 1024;
            const isVideo = msg.mimeType ? msg.mimeType.startsWith("video/") : false;
            const fileId = helpers.readBigIntFromBuffer(helpers.generateRandomBytes(8), true, true);
            const totalTelegramParts = Math.ceil(fileSize / TG_PART_SIZE);
            const totalBrowserChunks = Number(msg.totalChunks) || Math.ceil(fileSize / (1024 * 1024));

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
              totalBrowserChunks,
              totalTelegramParts,
              uploadedTelegramParts: new Set<number>(),
              inFlightUploads: new Set<Promise<any>>(),
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
              totalChunks: totalBrowserChunks,
              chunkSize: 1024 * 1024,
            }));
            logToClient("INIT_CONFIRMED", { fileName: uploadState?.fileName, isBig, totalBrowserChunks, totalTelegramParts });
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
        let chunkBytes = binaryBuf.subarray(4);

        // Immediately send chunk_ack to browser so browser pipeline continues at full line speed!
        const browserTransferPercent = Math.min(
          Math.round(((chunkIndex + 1) / uploadState.totalBrowserChunks) * 40),
          40
        );

        logToClient("CHUNK_RECEIVED_OK", {
          chunkIndex,
          chunkBytes: chunkBytes.length,
          totalBrowserChunks: uploadState.totalBrowserChunks,
          percent: browserTransferPercent,
        });

        ws.send(JSON.stringify({
          type: "chunk_ack",
          chunkIndex,
          uploadedCount: chunkIndex + 1,
          totalChunks: uploadState.totalBrowserChunks,
          percent: browserTransferPercent,
        }));

        // Immediately slice 1MB chunk into 512KB MTProto parts and relay concurrently to Telegram!
        const basePartIndex = chunkIndex * 2;
        const sub0 = chunkBytes.subarray(0, Math.min(TG_PART_SIZE, chunkBytes.length));
        const sub1 = chunkBytes.length > TG_PART_SIZE ? chunkBytes.subarray(TG_PART_SIZE) : null;

        // Clear raw buffer references
        (chunkBytes as any) = null;
        (binaryBuf as any) = null;

        // Dispatch subpart 0 to Telegram
        const p0 = uploadSingleTgPart(basePartIndex, sub0);
        uploadState.inFlightUploads.add(p0);
        p0.finally(() => uploadState?.inFlightUploads.delete(p0));

        // Dispatch subpart 1 to Telegram if present
        if (sub1 && sub1.length > 0) {
          const p1 = uploadSingleTgPart(basePartIndex + 1, sub1);
          uploadState.inFlightUploads.add(p1);
          p1.finally(() => uploadState?.inFlightUploads.delete(p1));
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
      const { client, userId, error } = await this.getOrConnectUserClient(request, envObj);
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

  private async handleUploadChunk(request: Request, envObj: any): Promise<Response> {
    const startT0 = Date.now();
    try {
      const { client, userId, error } = await this.getOrConnectUserClient(request, envObj);
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
      const partResult = await Promise.race([
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

  private async handleUploadComplete(request: Request, envObj: any): Promise<Response> {
    try {
      const { client, userId, error } = await this.getOrConnectUserClient(request, envObj);
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

      let thumbBuf: Buffer | undefined = undefined;
      if (thumbnail_base64) {
        try {
          thumbBuf = Buffer.from(thumbnail_base64.replace(/^data:image\/\w+;base64,/, ""), "base64");
        } catch {}
      }

      const isVideo = uploadSession.isVideo;
      const sentMsg = await client.sendFile(targetPeer, {
        file: inputFile,
        thumb: thumbBuf,
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
      const { client, userId, error } = await this.getOrConnectUserClient(request, envObj);
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

      if (!file || !channelId) {
        return new Response(JSON.stringify({ error: "File and channel_id are required" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
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

      let thumbBuf: Buffer | undefined = undefined;
      if (thumbnailBase64) {
        try {
          thumbBuf = Buffer.from(thumbnailBase64.replace(/^data:image\/\w+;base64,/, ""), "base64");
        } catch {}
      }

      console.log(`[UploadOneShot] Streaming file to Telegram targetPeer (${targetPeer})...`);
      let sentMsg: any;
      try {
        sentMsg = await client.sendFile(targetPeer, {
          file: customFile,
          thumb: thumbBuf,
          workers: 1,
          forceDocument: false,
          attributes: isVideo
            ? [
                new Api.DocumentAttributeVideo({
                  duration: Math.round(Number(formData.get("duration")) || 0),
                  w: Number(formData.get("width")) || 1920,
                  h: Number(formData.get("height")) || 1080,
                  supportsStreaming: true,
                }),
              ]
            : undefined,
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
          mediaId, channelId, userId, realMessageId, isVideo ? "video" : "photo",
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
