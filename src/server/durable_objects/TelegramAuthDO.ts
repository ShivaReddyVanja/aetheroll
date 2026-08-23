import { Api, utils } from "telegram";
import { SlidingWindowRatePacer, MAX_TELEGRAM_FILE_SIZE, toBigInt } from "./common/ratePacer.ts";
import { TelemetryLogger } from "./telemetry/telemetryLogger.ts";
import { ClientSessionManager } from "./auth/clientSessionManager.ts";
import { QrAuthHandler } from "./auth/qrAuthHandler.ts";
import { MediaLocationResolver } from "./streaming/mediaLocationResolver.ts";
import { ParallelSegmentFetcher } from "./streaming/parallelSegmentFetcher.ts";
import { StreamHandler } from "./streaming/streamHandler.ts";
import { UploadWebSocketHandler } from "./upload/uploadWebSocketHandler.ts";
import { UploadHttpHandler } from "./upload/uploadHttpHandler.ts";

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
   * Main Durable Object HTTP / WebSocket fetch dispatcher
   */
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
      return this.uploadHttpHandler.handleUpload(request, effectiveEnv, this.clientSessionManager);
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
          const stripped = [...photoSizes, ...docThumbs].find(
            (s: any) => s instanceof Api.PhotoStrippedSize || s.className === "PhotoStrippedSize" || s.bytes
          );

          if (stripped && stripped.bytes) {
            try {
              thumbBuffer = Buffer.from(utils.strippedPhotoToJpg(stripped.bytes));
            } catch {}
          }

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

          if (!thumbBuffer && msg.photo) {
            try {
              const downloaded = await client.downloadMedia(msg.media);
              if (downloaded && Buffer.isBuffer(downloaded) && downloaded.length > 0) {
                thumbBuffer = downloaded;
              }
            } catch {}
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

    return new Response("Not found in Auth DO", { status: 404 });
  }
}
