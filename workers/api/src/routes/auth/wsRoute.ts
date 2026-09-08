import { Hono } from "hono";
import { forwardToAuthDO } from "./utils";

export const wsRoute = new Hono();

/**
 * GET /ws
 * WebSocket endpoint routed to Durable Object singleton (TelegramAuthDO)
 */
wsRoute.get("/ws", async (c) => {
  if ((c.env as any)?.AUTH_DO) {
    return forwardToAuthDO(c);
  }
  return c.text("WebSocket Durable Object not configured for this environment", 500);
});
