import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import QRCode from "qrcode";
import crypto from "crypto";
import { getDb } from "../lib/db";
import { encryptSession, decryptSession } from "../lib/crypto";
import { startQrLogin, checkQrLoginStatus, createTelegramClient } from "../lib/telegram";

export const authRouter = new Hono();

// Memory store for in-flight QR login sessions before completion
const activeLoginSessions = new Map<string, { client: any; tokenBuffer: Buffer; expires: number }>();

/**
 * Clean up expired QR sessions periodically
 */
setInterval(() => {
  const now = Date.now() / 1000;
  for (const [id, session] of activeLoginSessions.entries()) {
    if (session.expires < now) {
      try {
        session.client.disconnect();
      } catch {}
      activeLoginSessions.delete(id);
    }
  }
}, 30000);

/**
 * GET /api/auth/qr
 * Generates a new Telegram QR login challenge
 */
authRouter.get("/qr", async (c) => {
  try {
    const { token, expires, client, tokenBuffer } = await startQrLogin();
    const qrId = crypto.randomUUID();

    activeLoginSessions.set(qrId, {
      client,
      tokenBuffer,
      expires,
    });

    // Generate QR code base64 image for easy display
    const qrImageDataUrl = await QRCode.toDataURL(token, {
      width: 280,
      margin: 2,
      color: {
        dark: "#000000",
        light: "#ffffff",
      },
    });

    return c.json({
      qrId,
      qrUrl: token,
      qrImage: qrImageDataUrl,
      expires,
    });
  } catch (error: any) {
    console.error("QR Challenge Error:", error);
    return c.json({ error: error.message || "Failed to generate QR login challenge" }, 500);
  }
});

/**
 * POST /api/auth/qr/check
 * Polls if user confirmed the QR code in Telegram App
 */
authRouter.post("/qr/check", async (c) => {
  try {
    const { qrId } = await c.req.json();
    const active = activeLoginSessions.get(qrId);

    if (!active) {
      return c.json({ error: "QR session expired or invalid. Please refresh." }, 400);
    }

    const check = await checkQrLoginStatus(active.client, active.tokenBuffer);

    if (check.success && check.sessionString && check.user) {
      // User authenticated successfully!
      const db = getDb((c.env as any)?.DB);
      const telegramUserId = check.user.id?.toString() || check.user.id;
      const displayName = [check.user.firstName, check.user.lastName].filter(Boolean).join(" ") || check.user.username || "Telegram User";
      const encryptedSession = encryptSession(check.sessionString);

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

      // Create Web Session Cookie (Valid for 30 days)
      const sessionToken = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      await db.run(
        "INSERT INTO user_sessions (id, user_id, expires_at) VALUES (?, ?, ?)",
        [sessionToken, userId, expiresAt]
      );

      // Set HttpOnly cookie
      setCookie(c, "tg_session", sessionToken, {
        path: "/",
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "Lax",
        maxAge: 30 * 24 * 60 * 60,
      });

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
 * GET /api/auth/me
 * Returns currently logged-in user details
 */
authRouter.get("/me", async (c) => {
  const token = getCookie(c, "tg_session");
  if (!token) {
    return c.json({ authenticated: false }, 401);
  }

  const db = getDb((c.env as any)?.DB);
  const session = await db.get(
    `SELECT u.id, u.telegram_user_id, u.display_name, u.avatar_url, s.expires_at
     FROM user_sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > CURRENT_TIMESTAMP`,
    [token]
  );

  if (!session) {
    return c.json({ authenticated: false }, 401);
  }

  return c.json({
    authenticated: true,
    user: {
      id: session.id,
      telegramUserId: session.telegram_user_id,
      displayName: session.display_name,
      avatarUrl: session.avatar_url,
    },
  });
});

/**
 * POST /api/auth/logout
 * Destroys current web session
 */
authRouter.post("/logout", async (c) => {
  const token = getCookie(c, "tg_session");
  if (token) {
    const db = getDb((c.env as any)?.DB);
    await db.run("DELETE FROM user_sessions WHERE id = ?", [token]);
    deleteCookie(c, "tg_session");
  }
  return c.json({ success: true });
});
