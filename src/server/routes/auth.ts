import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { streamSSE } from "hono/streaming";
import QRCode from "qrcode";
import crypto from "crypto";
import { getDb } from "../lib/db";
import { encryptSession, decryptSession } from "../lib/crypto";
import { startQrLogin, checkQrLoginStatus, createTelegramClient, getDefaultTelegramConfig } from "../lib/telegram";

export const authRouter = new Hono();

// Memory store for in-flight QR login sessions before completion (local fallback)
const activeLoginSessions = new Map<string, { client: any; tokenBuffer: Buffer; expires: number }>();

function cleanupExpiredLoginSessions() {
  const now = Date.now() / 1000;
  for (const [id, session] of activeLoginSessions.entries()) {
    if (session.expires < now) {
      try {
        session.client.disconnect();
      } catch {}
      activeLoginSessions.delete(id);
    }
  }
}

/**
 * GET /api/auth/qr-stream
 * Server-Sent Events (SSE) stream for Cloudflare Workers & Serverless.
 * Holds open the MTProto client on the exact same isolate until scanned or expired.
 */
authRouter.get("/qr-stream", async (c) => {
  return streamSSE(c, async (stream) => {
    let client: any = null;

    try {
      const config = getDefaultTelegramConfig(c.env);
      const challenge = await startQrLogin(config);
      client = challenge.client;

      // Generate pure SVG QR code (zero canvas dependencies)
      const qrSvg = await QRCode.toString(challenge.token, {
        type: "svg",
        width: 280,
        margin: 2,
        color: {
          dark: "#000000",
          light: "#ffffff",
        },
      });
      const qrImageDataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(qrSvg)}`;

      // Send initial QR Code to browser
      await stream.writeSSE({
        event: "qr",
        data: JSON.stringify({
          qrUrl: challenge.token,
          qrImage: qrImageDataUrl,
          expires: challenge.expires,
        }),
      });

      stream.onAbort(() => {
        try {
          if (client) client.disconnect();
        } catch {}
      });

      const startTime = Date.now();
      const maxDuration = 60 * 1000; // 60 seconds validity window

      while (!stream.aborted && Date.now() - startTime < maxDuration) {
        await stream.sleep(2000);
        if (stream.aborted) break;

        try {
          const check = await checkQrLoginStatus(client, challenge.tokenBuffer, config);

          if (check.success && check.sessionString && check.user) {
            const db = getDb((c.env as any)?.DB);
            const telegramUserId = check.user.id?.toString() || check.user.id;
            const displayName =
              [check.user.firstName, check.user.lastName].filter(Boolean).join(" ") ||
              check.user.username ||
              "Telegram User";
            const encryptedSession = await encryptSession(
              check.sessionString,
              (c.env as any)?.SESSION_ENCRYPTION_KEY
            );

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

            const sessionToken = crypto.randomBytes(32).toString("hex");
            const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

            await db.run(
              "INSERT INTO user_sessions (id, user_id, expires_at) VALUES (?, ?, ?)",
              [sessionToken, userId, expiresAt]
            );

            await stream.writeSSE({
              event: "authenticated",
              data: JSON.stringify({
                success: true,
                sessionToken,
                user: {
                  id: userId,
                  telegramUserId,
                  displayName,
                },
              }),
            });

            try {
              if (client) client.disconnect();
            } catch {}
            return;
          }
        } catch (err: any) {
          if (err?.message?.includes("expired")) {
            await stream.writeSSE({
              event: "expired",
              data: JSON.stringify({ error: "QR Token expired" }),
            });
            break;
          }
        }
      }

      // Expired without scan
      await stream.writeSSE({
        event: "expired",
        data: JSON.stringify({ error: "QR Token expired" }),
      });
    } catch (err: any) {
      console.error("[QR Stream Error]:", err);
      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({ error: err.message || "Failed to start QR stream" }),
      });
    } finally {
      try {
        if (client) client.disconnect();
      } catch {}
    }
  });
});

/**
 * POST /api/auth/session
 * Sets the HttpOnly session cookie after SSE authentication
 */
authRouter.post("/session", async (c) => {
  try {
    const { sessionToken } = await c.req.json();
    if (!sessionToken) return c.json({ error: "sessionToken required" }, 400);

    const db = getDb((c.env as any)?.DB);
    const session = await db.get(
      "SELECT * FROM user_sessions WHERE id = ? AND expires_at > CURRENT_TIMESTAMP",
      [sessionToken]
    );

    if (!session) {
      return c.json({ error: "Invalid or expired session token" }, 401);
    }

    setCookie(c, "tg_session", sessionToken, {
      path: "/",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Lax",
      maxAge: 30 * 24 * 60 * 60,
    });

    return c.json({ success: true });
  } catch (error: any) {
    return c.json({ error: error.message || "Failed setting session cookie" }, 500);
  }
});

function forwardToAuthDO(c: any) {
  const id = c.env.AUTH_DO.idFromName("telegram_auth_singleton");
  const stub = c.env.AUTH_DO.get(id);

  const headers = new Headers(c.req.raw.headers);
  if (c.env?.TELEGRAM_API_ID) headers.set("x-tg-api-id", String(c.env.TELEGRAM_API_ID));
  if (c.env?.TELEGRAM_API_HASH) headers.set("x-tg-api-hash", String(c.env.TELEGRAM_API_HASH));
  if (c.env?.TELEGRAM_TEST_MODE) headers.set("x-tg-test-mode", String(c.env.TELEGRAM_TEST_MODE));
  if (c.env?.SESSION_ENCRYPTION_KEY) headers.set("x-tg-enc-key", String(c.env.SESSION_ENCRYPTION_KEY));

  const req = new Request(c.req.raw, { headers });
  return stub.fetch(req);
}

/**
 * GET /api/auth/ws
 * WebSocket endpoint routed to Durable Object singleton (TelegramAuthDO)
 */
authRouter.get("/ws", async (c) => {
  if ((c.env as any)?.AUTH_DO) {
    return forwardToAuthDO(c);
  }
  return c.text("WebSocket Durable Object not configured for this environment", 500);
});

/**
 * GET /api/auth/qr
 * Generates a new Telegram QR login challenge (Stateful via Durable Object)
 */
authRouter.get("/qr", async (c) => {
  if ((c.env as any)?.AUTH_DO) {
    return forwardToAuthDO(c);
  }

  // Local development fallback
  try {
    cleanupExpiredLoginSessions();
    const { token, expires, client, tokenBuffer } = await startQrLogin(c.env);
    const qrId = crypto.randomUUID();

    activeLoginSessions.set(qrId, {
      client,
      tokenBuffer,
      expires,
    });

    // Generate pure SVG QR code (zero canvas dependencies, 100% Cloudflare Worker compatible)
    const qrSvg = await QRCode.toString(token, {
      type: "svg",
      width: 280,
      margin: 2,
      color: {
        dark: "#000000",
        light: "#ffffff",
      },
    });
    const qrImageDataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(qrSvg)}`;

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
 * Polls if user confirmed the QR code in Telegram App (Stateful via Durable Object)
 */
authRouter.post("/qr/check", async (c) => {
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
      const displayName = [check.user.firstName, check.user.lastName].filter(Boolean).join(" ") || check.user.username || "Telegram User";
      const encryptedSession = await encryptSession(check.sessionString, (c.env as any)?.SESSION_ENCRYPTION_KEY);

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

/**
 * GET /api/auth/client-session
 * Returns decrypted credentials for direct browser-to-Telegram WebSocket uploads
 */
authRouter.get("/client-session", async (c) => {
  const token = getCookie(c, "tg_session");
  if (!token) return c.json({ error: "Unauthorized" }, 401);

  const db = getDb((c.env as any)?.DB);
  const session = await db.get(
    `SELECT u.id, u.telegram_user_id, u.session_string
     FROM user_sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > CURRENT_TIMESTAMP`,
    [token]
  );

  if (!session) return c.json({ error: "Unauthorized" }, 401);

  const config = getDefaultTelegramConfig(c.env);
  const decryptedSession = await decryptSession(
    session.session_string,
    (c.env as any)?.SESSION_ENCRYPTION_KEY
  );

  return c.json({
    sessionString: decryptedSession,
    apiId: config.apiId,
    apiHash: config.apiHash,
  });
});
