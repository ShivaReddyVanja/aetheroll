import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { authRouter } from "./routes/auth";
import { channelsRouter } from "./routes/channels";
import { mediaRouter } from "./routes/media";
import { tagsRouter } from "./routes/tags";
import { streamRouter } from "./routes/stream";

export const app = new Hono().basePath("/api");

// Middleware
app.use("*", logger());
app.use(
  "*",
  cors({
    origin: (origin) => origin || "*",
    credentials: true,
  })
);

// Mount API subrouters
app.route("/auth", authRouter);
app.route("/channels", channelsRouter);
app.route("/media", mediaRouter);
app.route("/tags", tagsRouter);
app.route("/stream", streamRouter);

// Health check
app.get("/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

export default app;
