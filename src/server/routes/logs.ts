import { Hono } from "hono";
import { EventEmitter } from "events";

export const logsRouter = new Hono();

// In-memory telemetry log buffer and emitter for local Node mode
const localLogEmitter = (globalThis as any).__LOCAL_LOG_EMITTER__ || new EventEmitter();
(globalThis as any).__LOCAL_LOG_EMITTER__ = localLogEmitter;
const localLogBacklog: any[] = (globalThis as any).__LOCAL_LOG_BACKLOG__ || [];
(globalThis as any).__LOCAL_LOG_BACKLOG__ = localLogBacklog;

export function isTelemetryEnabled(env?: any): boolean {
  const flag =
    env?.ENABLE_TELEMETRY ??
    process.env?.ENABLE_TELEMETRY ??
    process.env?.NEXT_PUBLIC_ENABLE_TELEMETRY;
  if (flag === true || flag === 1) return true;
  if (typeof flag === "string") {
    const lower = flag.trim().toLowerCase();
    return lower === "true" || lower === "1" || lower === "yes" || lower === "enabled";
  }
  return false;
}

export function emitLocalLog(category: string, level: string, message: string, meta?: any) {
  if (!isTelemetryEnabled()) return;

  const entry = {
    id: Math.random().toString(36).substring(2, 9),
    timestamp: Date.now(),
    category,
    level,
    message,
    meta,
  };
  localLogBacklog.push(entry);
  if (localLogBacklog.length > 200) localLogBacklog.shift();
  localLogEmitter.emit("log", entry);
}

/**
 * GET /api/logs/stream
 * Server-Sent Events (SSE) stream for real-time engine telemetry and diagnostics
 */
logsRouter.get("/stream", async (c) => {
  if (!isTelemetryEnabled(c.env)) {
    return c.text("Not Found", 404);
  }

  const authDo = (c.env as any)?.AUTH_DO;

  if (authDo && typeof authDo.idFromName === "function") {
    // Connect to central global telemetry Durable Object
    const doId = authDo.idFromName("global_telemetry");
    const stub = authDo.get(doId);

    const headers = new Headers(c.req.raw.headers);
    headers.set("x-enable-telemetry", String((c.env as any)?.ENABLE_TELEMETRY || ""));

    const req = new Request(c.req.url, {
      method: "GET",
      headers,
    });

    const res = await stub.fetch(req);
    const origin = c.req.header("origin") || "*";
    const resHeaders = new Headers(res.headers);
    resHeaders.set("Access-Control-Allow-Origin", origin);
    resHeaders.set("Access-Control-Allow-Credentials", "true");

    return new Response(res.body, {
      status: res.status,
      headers: resHeaders,
    });
  }

  // Fallback for local Node.js dev mode (ReadableStream SSE)
  const stream = new ReadableStream({
    start: (controller) => {
      // Send backlog
      for (const log of localLogBacklog) {
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(log)}\n\n`));
      }

      const onLog = (entry: any) => {
        try {
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(entry)}\n\n`));
        } catch {}
      };

      localLogEmitter.on("log", onLog);

      // Heartbeat every 15s to keep connection alive
      const interval = setInterval(() => {
        try {
          controller.enqueue(new TextEncoder().encode(`: heartbeat\n\n`));
        } catch {
          clearInterval(interval);
        }
      }, 15000);

      // Cleanup
      c.req.raw.signal?.addEventListener("abort", () => {
        localLogEmitter.off("log", onLog);
        clearInterval(interval);
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
    },
  });
});

/**
 * GET /api/logs/status
 * Check if telemetry is enabled on the server
 */
logsRouter.get("/status", async (c) => {
  const enabled = isTelemetryEnabled(c.env);
  const origin = c.req.header("origin") || "*";
  return c.json(
    { enabled },
    200,
    {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Credentials": "true",
    }
  );
});
