import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { env } from "hono/adapter";
import { authRouter } from "./routes/auth";
import { channelsRouter } from "./routes/channels";
import { mediaRouter } from "./routes/media";
import { tagsRouter } from "./routes/tags";
import { streamRouter } from "./routes/stream";
import { logsRouter } from "./routes/logs";

export const app = new Hono().basePath("/api");

// Sync Cloudflare Worker environment variables & secrets into process.env
app.use("*", async (c, next) => {
  try {
    const workerEnv = env(c) || (c.env as any) || {};
    if (!globalThis.process) {
      (globalThis as any).process = { env: {} };
    } else if (!globalThis.process.env) {
      (globalThis.process as any).env = {};
    }
    for (const [key, value] of Object.entries(workerEnv)) {
      if (typeof value === "string") {
        process.env[key] = value;
      }
    }
  } catch {}
  await next();
});

// Middleware
app.use("*", logger());
app.use(
  "*",
  cors({
    origin: (origin) => origin || "*",
    credentials: true,
    allowHeaders: ["Content-Type", "x-tg-session", "Authorization", "Cookie", "Upgrade", "x-tg-api-id", "x-tg-api-hash", "x-tg-test-mode", "x-tg-enc-key"],
    allowMethods: ["GET", "HEAD", "PUT", "POST", "DELETE", "PATCH", "OPTIONS"],
    exposeHeaders: ["Content-Length", "Content-Range", "Set-Cookie"],
    maxAge: 86400,
  })
);

// Mount API subrouters
app.route("/auth", authRouter);
app.route("/channels", channelsRouter);
app.route("/media", mediaRouter);
app.route("/tags", tagsRouter);
app.route("/stream", streamRouter);
app.route("/logs", logsRouter);

// Health check
app.get("/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

export { TelegramAuthDO } from "./durable_objects/TelegramAuthDO";
export default app;
