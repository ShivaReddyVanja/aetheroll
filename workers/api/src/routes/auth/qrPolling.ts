import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import QRCode from "qrcode";
import crypto from "crypto";
import { getDb } from "../../lib/db";
import { encryptSession } from "../../lib/crypto";
import { generateCompositeSessionToken } from "../../lib/auth";
import { startQrLogin, checkQrLoginStatus } from "../../lib/telegram";
import {
  activeLoginSessions,
  cleanupExpiredLoginSessions,
  getAuthCookieOptions,
  forwardToAuthDO,
  appendCleanSingleAuthCookieHeaders,
} from "./utils";

export const qrPollingRoute = new Hono();

/**
 * GET /qr
 * Generates a new Telegram QR login challenge (Stateful via Durable Object or local fallback)
 */
qrPollingRoute.get("/qr", async (c) => {
  if ((c.env as any)?.AUTH_DO) {
    return forwardToAuthDO(c);
  }

  // Local development fallback using memory session
  try {
    const { token, expires, client, tokenBuffer } = await startQrLogin(c.env);
    const qrId = crypto.randomUUID();

    activeLoginSessions.set(qrId, {
      client,
      tokenBuffer,
      expires,
    });

    const qrSvg = await QRCode.toString(token, {
      type: "svg",
      width: 280,
      margin: 2,
      color: { dark: "#000000", light: "#ffffff" },
    });
    const qrImage = `data:image/svg+xml;utf8,${encodeURIComponent(qrSvg)}`;

    return c.json({
      qrId,
      qrUrl: token,
      qrImage,
      expires,
    });
  } catch (error: any) {
    console.error("QR Challenge Error:", error);
    return c.json({ error: error.message || "Failed to generate QR login challenge" }, 500);
  }
});

/**
 * POST /qr/check
 * Polls if user confirmed the QR code in Telegram App (Stateful via Durable Object or local fallback)
 */
qrPollingRoute.post("/qr/check", async (c) => {
  if ((c.env as any)?.AUTH_DO) {
    return forwardToAuthDO(c);
  }

  // Local development fallback
  try {
    cleanupExpiredLoginSessions();
    const { qrId } = await c.req.json();
    const active = activeLoginSessions.get(qrId);

    if (!active) {
      return c.json({ error: "QR session expired or invalid. Please refresh." }, 400);
    }

    const check = await checkQrLoginStatus(active.client, active.tokenBuffer, c.env);

    if (check.success && check.sessionString && check.user) {
      // User authenticated successfully!
      const db = getDb((c.env as any)?.DB);
      const telegramUserId = check.user.id?.toString() || check.user.id;
      const displayName =
        [check.user.firstName, check.user.lastName].filter(Boolean).join(" ") ||
        check.user.username ||
        "Telegram User";

      // Dual-Key Zero-Knowledge Token Generation
      const { sessionId, clientSecret, sessionToken } = generateCompositeSessionToken();
      const encryptedSession = await encryptSession(
        check.sessionString,
        (c.env as any)?.SESSION_ENCRYPTION_KEY,
        clientSecret
      );

      // Check or insert user
      let user = await db.get("SELECT * FROM users WHERE telegram_user_id = ?", [telegramUserId]);
      const userId = user?.id || crypto.randomUUID();

      if (!user) {
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

      // Create Web Session Record (Stores sessionId only - clientSecret is NEVER stored!)
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      await db.run(
        "INSERT INTO user_sessions (id, user_id, expires_at) VALUES (?, ?, ?)",
        [sessionId, userId, expiresAt]
      );

      // Set HttpOnly single clean session cookie
      const host = c.req.header("host") || "";
      const origin = c.req.header("origin") || "";
      const isBuiltByShiva = host.includes("builtbyshiva.com") || origin.includes("builtbyshiva.com");
      appendCleanSingleAuthCookieHeaders(c.res.headers, sessionToken, isBuiltByShiva);

      // Cleanup memory session
      activeLoginSessions.delete(qrId);

      return c.json({
        success: true,
        user: {
          id: userId,
          telegramUserId,
          displayName,
        },
      });
    }

    return c.json({ success: false });
  } catch (error: any) {
    console.error("QR Check Error:", error);
    return c.json({ error: error.message || "Failed checking login status" }, 500);
  }
});

/**
 * POST /qr/claim
 * Claims session token cookie after WS QR authentication completes
 */
qrPollingRoute.post("/qr/claim", async (c) => {
  if ((c.env as any)?.AUTH_DO) {
    return forwardToAuthDO(c);
  }

  return c.json({ error: "Durable Object disabled or not available for QR claim." }, 400);
});

