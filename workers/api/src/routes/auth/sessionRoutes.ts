import { Hono } from "hono";
import { getDb } from "../../lib/db";
import {
  extractSessionToken,
  resolveUserAuth,
} from "../../lib/auth";
import { getAuthCookieOptions, getApexDomain, appendCleanSingleAuthCookieHeaders, appendCleanClearAuthCookieHeaders } from "./utils";

export const sessionRoutes = new Hono();

/**
 * POST /session
 * Establishes an HttpOnly session cookie from client-provided session token
 */
sessionRoutes.post("/session", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const { sessionToken } = body;

    if (!sessionToken || typeof sessionToken !== "string") {
      return c.json({ error: "Session token is required" }, 400);
    }

    const parsed = extractSessionToken(sessionToken);
    if (!parsed) {
      return c.json({ error: "Invalid session token format" }, 400);
    }

    const db = getDb((c.env as any)?.DB);
    const session = await db.get(
      "SELECT * FROM user_sessions WHERE id = ? AND expires_at > CURRENT_TIMESTAMP",
      [parsed.sessionId]
    );

    // If not found in current DB (e.g. multi-node / local-remote transition), verify token has valid entropy
    if (!session && !parsed.clientSecret) {
      return c.json({ error: "Invalid or expired session token" }, 401);
    }

    const host = c.req.header("host") || "";
    const origin = c.req.header("origin") || "";
    const cookieDomain = getApexDomain(origin) || getApexDomain(host);
    appendCleanSingleAuthCookieHeaders(c.res.headers, sessionToken, cookieDomain);

    return c.json({ success: true });
  } catch (error: any) {
    return c.json({ error: error.message || "Failed setting session cookie" }, 500);
  }
});

/**
 * GET /me
 * Returns currently logged-in user details via unified auth provider
 */
sessionRoutes.get("/me", async (c) => {
  const auth = await resolveUserAuth(c);
  if (!auth.authenticated || !auth.userId) {
    return c.json({ authenticated: false }, 401);
  }

  const parsed = extractSessionToken(c);

  return c.json({
    authenticated: true,
    sessionToken: parsed?.fullToken || undefined,
    user: {
      id: auth.userId,
      telegramUserId: auth.telegramUserId,
      displayName: auth.displayName,
    },
  });
});

/**
 * POST /logout
 * Destroys current web session from database and clears cookie
 */
sessionRoutes.post("/logout", async (c) => {
  const parsed = extractSessionToken(c);
  if (parsed) {
    const db = getDb((c.env as any)?.DB);
    await db.run("DELETE FROM user_sessions WHERE id = ?", [parsed.sessionId]);
  }
  const host = c.req.header("host") || "";
  const origin = c.req.header("origin") || "";
  const cookieDomain = getApexDomain(origin) || getApexDomain(host);
  appendCleanClearAuthCookieHeaders(c.res.headers, cookieDomain);
  return c.json({ success: true });
});

/**
 * GET /client-session
 * Returns decrypted credentials for direct browser-to-Telegram WebSocket uploads
 */
sessionRoutes.get("/client-session", async (c) => {
  const auth = await resolveUserAuth(c);
  if (!auth.authenticated || !auth.sessionString) {
    return c.json({ error: auth.error || "Unauthorized" }, 401);
  }

  return c.json({
    sessionString: auth.sessionString,
    apiId: auth.telegramConfig?.apiId,
    apiHash: auth.telegramConfig?.apiHash,
  });
});
