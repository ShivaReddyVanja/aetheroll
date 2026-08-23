import type { LogEntry } from "../common/types.ts";

export class TelemetryLogger {
  state: any;
  env: any;
  recentLogs: LogEntry[];
  logStreamControllers: Set<ReadableStreamDefaultController>;

  constructor(state: any, env: any) {
    this.state = state;
    this.env = env;
    this.recentLogs = [];
    this.logStreamControllers = new Set();
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

    const entry: LogEntry = {
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

  handleStreamLogs(request: Request, effectiveEnv: any): Response {
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

  async handleIngestLog(request: Request, effectiveEnv: any): Promise<Response> {
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
}
