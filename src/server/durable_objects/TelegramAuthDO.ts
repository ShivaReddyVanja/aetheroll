import { Api, utils } from "telegram";
import { SlidingWindowRatePacer, MAX_TELEGRAM_FILE_SIZE, toBigInt } from "./common/ratePacer.ts";
import { TelemetryLogger } from "./telemetry/telemetryLogger.ts";
import { ClientSessionManager } from "./auth/clientSessionManager.ts";
import { QrAuthHandler } from "./auth/qrAuthHandler.ts";
import { PhoneAuthHandler } from "./auth/phoneAuthHandler.ts";
import { MediaLocationResolver } from "./streaming/mediaLocationResolver.ts";
import { ParallelSegmentFetcher } from "./streaming/parallelSegmentFetcher.ts";
import { StreamHandler } from "./streaming/streamHandler.ts";
import { UploadWebSocketHandler } from "./upload/uploadWebSocketHandler.ts";
import { UploadHttpHandler } from "./upload/uploadHttpHandler.ts";
import { emitGalleryEvent, emitGalleryBatch } from "../lib/ledger.ts";
import { getDb } from "../lib/db.ts";
import { flushSessionBilling, type BillingPurpose } from "../lib/billing/index.ts";

export { SlidingWindowRatePacer, MAX_TELEGRAM_FILE_SIZE, toBigInt };
export type * from "./common/types.ts";

/**
 * TelegramAuthDO - Cloudflare Durable Object Singleton
 * Stateful MTProto coordinator for live QR auth, rate-paced multi-worker streaming & uploads.
 */
export class TelegramAuthDO {
  state: any;
  env: any;

  // Subsystem Modules
  ratePacer: SlidingWindowRatePacer;
  telemetryLogger: TelemetryLogger;
  clientSessionManager: ClientSessionManager;
  qrAuthHandler: QrAuthHandler;
  phoneAuthHandler: PhoneAuthHandler;
  mediaLocationResolver: MediaLocationResolver;
  segmentFetcher: ParallelSegmentFetcher;
  streamHandler: StreamHandler;
  uploadWebSocketHandler: UploadWebSocketHandler;
  uploadHttpHandler: UploadHttpHandler;

  constructor(state: any, env: any) {
    this.state = state;
    this.env = env;

    this.ratePacer = new SlidingWindowRatePacer(25, 1000);
    this.telemetryLogger = new TelemetryLogger(state, env);
    this.clientSessionManager = new ClientSessionManager();
    this.qrAuthHandler = new QrAuthHandler(env);
    this.phoneAuthHandler = new PhoneAuthHandler(env);
    this.mediaLocationResolver = new MediaLocationResolver();
    this.segmentFetcher = new ParallelSegmentFetcher();
    this.streamHandler = new StreamHandler();
    this.uploadWebSocketHandler = new UploadWebSocketHandler();
    this.uploadHttpHandler = new UploadHttpHandler();
  }

  // Backward compatibility getters for internal maps
  get activeSessions() {
    return this.qrAuthHandler.activeSessions;
  }
  get userClients() {
    return this.clientSessionManager.userClients;
  }
  get uploadSessions() {
    return this.uploadHttpHandler.uploadSessions;
  }
  get mediaLocationCache() {
    return this.mediaLocationResolver.mediaLocationCache;
  }
  get segmentRingCache() {
    return this.segmentFetcher.segmentRingCache;
  }
  get prefetchedChunks() {
    return this.segmentFetcher.prefetchedChunks;
  }
  get inFlightSegments() {
    return this.segmentFetcher.inFlightSegments;
  }
  get recentLogs() {
    return this.telemetryLogger.recentLogs;
  }
  get logStreamControllers() {
    return this.telemetryLogger.logStreamControllers;
  }
  get streamAbortController() {
    return this.streamHandler.streamAbortController;
  }

  // Backward compatible proxy methods
  getOrConnectUserClient(request: Request, envObj: any) {
    return this.clientSessionManager.getOrConnectUserClient(request, envObj);
  }

  sweepIdleClients() {
    return this.clientSessionManager.sweepIdleClients();
  }

  isTelemetryActive(envObj?: any): boolean {
    return this.telemetryLogger.isTelemetryActive(envObj);
  }

  logEvent(
    category: "EDGE_CACHE" | "STREAM" | "PREFETCH" | "UPLOAD" | "MTPROTO" | "RAM" | "AUTH",
    level: "info" | "success" | "warn" | "error",
    message: string,
    meta?: any,
    forwardToCentral: boolean = true
  ) {
    return this.telemetryLogger.logEvent(category, level, message, meta, forwardToCentral);
  }

  /**
   * Helper to classify route purpose for billing metrics
   */
  private classifyPurpose(pathname: string): BillingPurpose {
    if (pathname.includes("/upload")) return "UPLOAD_FILE";
    if (pathname.includes("/logs/stream") || pathname.includes("/stream-logs")) return "GENERAL";
    if (pathname.includes("/stream")) return "STREAM_MEDIA";
    if (pathname.includes("/ledger/emit")) return "WAL_EMIT";
    if (pathname.includes("/ledger/batch")) return "WAL_BATCH";
    if (pathname.includes("/delete")) return "MEDIA_DELETE";
    if (pathname.includes("/thumbnail")) return "THUMBNAIL_FETCH";
    if (pathname.includes("/ws") || pathname.includes("/qr") || pathname.includes("/phone")) return "AUTH";
    return "GENERAL";
  }

  /**
   * Main Durable Object HTTP / WebSocket fetch dispatcher with billing metrics tracking
   */
  async fetch(request: Request): Promise<Response> {
    const startTime = performance.now();
    const url = new URL(request.url);
    const purpose = this.classifyPurpose(url.pathname);

    let response: Response;
    try {
      response = await this.handleFetch(request, url);
    } catch (err: any) {
      response = new Response(JSON.stringify({ error: err.message || "Internal DO Error" }), { status: 500 });
    }

    if (this.env?.DB) {
      const resolvedUserId = this.clientSessionManager.resolveUserIdFromRequest(request) || "anonymous";
      const flushPromise = flushSessionBilling({
        startTime,
        userId: resolvedUserId,
        purpose,
        dbBinding: this.env.DB,
      });

      if (this.state && typeof this.state.waitUntil === "function") {
        this.state.waitUntil(flushPromise);
      }
    }

    return response;
  }

  private async handleFetch(request: Request, url: URL): Promise<Response> {

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
      return this.telemetryLogger.handleStreamLogs(request, effectiveEnv);
    }

    // 0b. External Log Ingestion - Strictly gated behind isTelemetryActive (non-recursive)
    if (url.pathname.endsWith("/log") && request.method === "POST") {
      return this.telemetryLogger.handleIngestLog(request, effectiveEnv);
    }

    // 1. Upload WebSocket stream endpoint
    if (
      url.pathname.includes("/upload/ws") ||
      (url.pathname.includes("/upload") && request.headers.get("Upgrade") === "websocket")
    ) {
      const webSocketPair = new (globalThis as any).WebSocketPair();
      const [clientWs, serverWs] = Object.values(webSocketPair) as [WebSocket, any];

      if (typeof serverWs?.accept === "function") {
        serverWs.accept();
      }
      this.uploadWebSocketHandler.handleUploadWebSocket(
        serverWs,
        effectiveEnv,
        request,
        this.clientSessionManager,
        this.ratePacer
      );

      return new Response(null, {
        status: 101,
        webSocket: clientWs,
      } as any);
    }

    // 2. Upload media HTTP endpoint with persistent warm MTProto connection
    if (url.pathname.includes("/upload") || url.pathname.includes("/api/media/upload")) {
      return this.uploadHttpHandler.handleUpload(request, effectiveEnv, this.clientSessionManager, this.ratePacer, this.state?.storage);
    }

    // 3. Stream media chunks endpoint with persistent warm MTProto connection
    if (url.pathname.includes("/stream") || url.pathname.includes("/api/stream")) {
      return this.streamHandler.handleStream(
        request,
        effectiveEnv,
        this.clientSessionManager,
        this.mediaLocationResolver,
        this.segmentFetcher,
        this.ratePacer,
        this.telemetryLogger
      );
    }

    // 3.5 Clear in-memory caches endpoint
    if (url.pathname.includes("/cache/clear")) {
      this.segmentFetcher.clear();
      this.mediaLocationResolver.clear();
      this.telemetryLogger.logEvent("RAM", "info", "🧹 In-memory RAM segment and chunk caches cleared");
      return new Response(JSON.stringify({ success: true, message: "In-memory DO caches cleared" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // 3.5b WAL Single Event Emit endpoint with persistent warm MTProto connection
    if (url.pathname.includes("/api/ledger/emit") || url.pathname.endsWith("/ledger/emit")) {
      try {
        const { client, error } = await this.clientSessionManager.getOrConnectUserClient(request, effectiveEnv);
        if (!client) {
          return new Response(JSON.stringify({ error: error || "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        const body = (await request.json().catch(() => ({}))) as any;
        const { channelTgId, refMsgId, op, data, customKey } = body;

        let targetPeer: any = channelTgId || "me";
        if (targetPeer !== "me" && !targetPeer.startsWith("me_")) {
          try { targetPeer = await client.getInputEntity(targetPeer); }
          catch { try { targetPeer = await client.getEntity(targetPeer); } catch {} }
        } else {
          targetPeer = "me";
        }

        const encryptionKey = customKey || effectiveEnv.SESSION_ENCRYPTION_KEY;
        const eventMsgId = await emitGalleryEvent(client, targetPeer, refMsgId, op, data, encryptionKey);

        return new Response(JSON.stringify({ success: !!eventMsgId, eventMsgId: eventMsgId || null }), {
          headers: { "Content-Type": "application/json" },
        });
      } catch (err: any) {
        console.error("[DO:LedgerEmit Error]:", err);
        return new Response(JSON.stringify({ error: err.message || "Failed to emit WAL event" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // 3.5c WAL Batch Manifest Emit endpoint with persistent warm MTProto connection
    if (url.pathname.includes("/api/ledger/batch") || url.pathname.endsWith("/ledger/batch")) {
      try {
        const { client, error } = await this.clientSessionManager.getOrConnectUserClient(request, effectiveEnv);
        if (!client) {
          return new Response(JSON.stringify({ error: error || "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        const body = (await request.json().catch(() => ({}))) as any;
        const { channelTgId, ops, customKey } = body;

        let targetPeer: any = channelTgId || "me";
        if (targetPeer !== "me" && !targetPeer.startsWith("me_")) {
          try { targetPeer = await client.getInputEntity(targetPeer); }
          catch { try { targetPeer = await client.getEntity(targetPeer); } catch {} }
        } else {
          targetPeer = "me";
        }

        const encryptionKey = customKey || effectiveEnv.SESSION_ENCRYPTION_KEY;
        const eventMsgId = await emitGalleryBatch(client, targetPeer, channelTgId, ops, encryptionKey);

        return new Response(JSON.stringify({ success: !!eventMsgId, eventMsgId: eventMsgId || null }), {
          headers: { "Content-Type": "application/json" },
        });
      } catch (err: any) {
        console.error("[DO:LedgerBatch Error]:", err);
        return new Response(JSON.stringify({ error: err.message || "Failed to emit WAL batch" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // 3.6 Batch Delete media messages in Telegram with warm MTProto connection
    if (url.pathname.includes("/delete") || url.pathname.includes("/api/media/delete")) {
      try {
        const { client, userId, error } = await this.clientSessionManager.getOrConnectUserClient(request, effectiveEnv);
        if (!client) {
          return new Response(JSON.stringify({ error: error || "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        const body = (await request.json().catch(() => ({}))) as any;
        const channelItemsList: Array<{ channelTgId: string; messageIds: number[] }> = body?.channel_items || [];

        for (const { channelTgId, messageIds } of channelItemsList) {
          if (!messageIds || messageIds.length === 0) continue;
          let targetPeer: any = channelTgId;
          if (targetPeer !== "me" && !targetPeer.startsWith("me_")) {
            try { targetPeer = await client.getInputEntity(targetPeer); }
            catch { try { targetPeer = await client.getEntity(targetPeer); } catch {} }
          } else {
            targetPeer = "me";
          }

          const TG_BATCH_LIMIT = 100;
          for (let i = 0; i < messageIds.length; i += TG_BATCH_LIMIT) {
            const chunk = messageIds.slice(i, i + TG_BATCH_LIMIT);
            await client.deleteMessages(targetPeer, chunk, { revoke: true });
          }
        }

        return new Response(JSON.stringify({ success: true }), {
          headers: { "Content-Type": "application/json" },
        });
      } catch (err: any) {
        console.error("[DO:MediaDelete Error]:", err);
        return new Response(JSON.stringify({ error: err.message || "Failed to delete messages in Telegram" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // 3.7 Fetch media thumbnail with warm MTProto connection
    if (url.pathname.includes("/thumbnail") || url.pathname.includes("/api/media/thumbnail")) {
      try {
        const { client, userId, error } = await this.clientSessionManager.getOrConnectUserClient(request, effectiveEnv);
        if (!client) {
          return new Response(JSON.stringify({ error: error || "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        const channelTgId = request.headers.get("x-target-channel-id") || url.searchParams.get("channel") || "me";
        const msgIdStr = request.headers.get("x-target-msg-id") || url.searchParams.get("msgId");
        const msgId = Number(msgIdStr);
        if (!msgId) {
          return new Response(JSON.stringify({ error: "Missing message ID" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        let targetPeer: any = channelTgId;
        if (targetPeer !== "me" && !targetPeer.startsWith("me_")) {
          try { targetPeer = await client.getInputEntity(targetPeer); }
          catch { try { targetPeer = await client.getEntity(targetPeer); } catch {} }
        } else {
          targetPeer = "me";
        }

        const messages = await client.getMessages(targetPeer, { ids: [msgId] });
        const msg = messages[0];

        if (msg && msg.media) {
          let thumbBuffer: Buffer | null = null;
          const photoSizes = (msg.media as any)?.photo?.sizes || [];
          const docThumbs = (msg.media as any)?.document?.thumbs || [];

          // 1. Try downloading real crisp thumbnail for documents/videos
          if (docThumbs.length > 0) {
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

          // 2. Try downloading real photo (or medium thumbnail) for photos
          if (!thumbBuffer && msg.photo) {
            try {
              const downloaded = await client.downloadMedia(msg.media, { thumb: 1 }).catch(() => null)
                || await client.downloadMedia(msg.media).catch(() => null);
              if (downloaded && Buffer.isBuffer(downloaded) && downloaded.length > 0) {
                thumbBuffer = downloaded;
              }
            } catch {}
          }

          // 3. Last-resort fallback ONLY: 30px stripped preview if network download fails
          if (!thumbBuffer) {
            const stripped = [...photoSizes, ...docThumbs].find(
              (s: any) => s instanceof Api.PhotoStrippedSize || s.className === "PhotoStrippedSize" || s.bytes
            );

            if (stripped && stripped.bytes) {
              try {
                thumbBuffer = Buffer.from(utils.strippedPhotoToJpg(stripped.bytes));
              } catch {}
            }
          }

          if (thumbBuffer && Buffer.isBuffer(thumbBuffer) && thumbBuffer.length > 0) {
            return new Response(thumbBuffer as any, {
              headers: {
                "Content-Type": "image/jpeg",
                "Cache-Control": "public, max-age=31536000, immutable",
              },
            });
          }
        }

        return new Response(JSON.stringify({ error: "Thumbnail not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      } catch (err: any) {
        console.error("[DO:Thumbnail Error]:", err);
        return new Response(JSON.stringify({ error: err.message || "Failed to fetch thumbnail" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // 4. WebSocket endpoint for real-time bidirectional QR auth
    if (request.headers.get("Upgrade") === "websocket" || url.pathname.endsWith("/ws")) {
      const webSocketPair = new (globalThis as any).WebSocketPair();
      const [clientWs, serverWs] = Object.values(webSocketPair) as [WebSocket, any];

      if (typeof serverWs?.accept === "function") {
        serverWs.accept();
      }
      this.qrAuthHandler.handleWebSocket(serverWs, effectiveEnv);

      return new Response(null, {
        status: 101,
        webSocket: clientWs,
      } as any);
    }

    // 5. HTTP QR Generation endpoint
    if (url.pathname.endsWith("/qr") && request.method === "GET") {
      return this.qrAuthHandler.handleQrHttp(effectiveEnv, request);
    }

    // 6. HTTP QR Check polling endpoint
    if (url.pathname.endsWith("/check") && request.method === "POST") {
      const body = (await request.json().catch(() => ({}))) as any;
      return this.qrAuthHandler.handleCheckHttp(body?.qrId, effectiveEnv, request);
    }

    // 6b. QR Auth Claim endpoint (one-time cookie claim from WS qrClaimId)
    if (url.pathname.endsWith("/qr/claim") && request.method === "POST") {
      return this.qrAuthHandler.handleClaimHttp(effectiveEnv, request);
    }

    // 7. Phone Auth Send Code endpoint
    if ((url.pathname.endsWith("/phone/send-code") || url.pathname.endsWith("/send-code")) && request.method === "POST") {
      return this.phoneAuthHandler.handleSendCodeHttp(effectiveEnv, request);
    }

    // 8. Phone Auth Verify Code endpoint
    if ((url.pathname.endsWith("/phone/verify") || url.pathname.endsWith("/verify")) && request.method === "POST") {
      return this.phoneAuthHandler.handleVerifyCodeHttp(effectiveEnv, request);
    }

    return new Response("Not found in Auth DO", { status: 404 });
  }
}

