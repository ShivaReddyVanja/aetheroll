import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import crypto from "crypto";
import { getDb } from "../../lib/db.ts";
import { encryptSession } from "../../lib/crypto.ts";
import { generateCompositeSessionToken } from "../../lib/auth.ts";
import { sendPhoneCode, verifyPhoneCode } from "../../lib/telegram.ts";
import { getAuthCookieOptions } from "./utils.ts";

export const phoneAuthRoute = new Hono();

// Active in-memory phone login sessions
const activePhoneLoginSessions = new Map<
  string,
  { client: any; phoneNumber: string; phoneCodeHash: string; expires: number }
>();

function cleanupExpiredPhoneSessions() {
  const now = Date.now();
  for (const [id, session] of activePhoneLoginSessions.entries()) {
    if (session.expires < now) {
      try {
        session.client.disconnect();
      } catch {}
      activePhoneLoginSessions.delete(id);
    }
  }
}

/**
 * POST /api/auth/phone/send-code
 * Body: { phoneNumber: string }
 */
phoneAuthRoute.post("/phone/send-code", async (c) => {
  try {
    cleanupExpiredPhoneSessions();
    const { phoneNumber } = await c.req.json();

    if (!phoneNumber || typeof phoneNumber !== "string") {
      return c.json({ error: "Valid phone number is required" }, 400);
    }

    const cleanPhone = phoneNumber.trim().replace(/[^\d+]/g, "");
    if (!cleanPhone.startsWith("+") || cleanPhone.length < 8) {
      return c.json({ error: "Please enter a valid phone number with country code (e.g. +1234567890)" }, 400);
    }

    const { client, phoneCodeHash, isCodeViaApp } = await sendPhoneCode(cleanPhone, c.env);
    const phoneAuthId = crypto.randomUUID();

    activePhoneLoginSessions.set(phoneAuthId, {
      client,
      phoneNumber: cleanPhone,
      phoneCodeHash,
      expires: Date.now() + 15 * 60 * 1000, // 15 minutes expiry
    });

    return c.json({
      phoneAuthId,
      isCodeViaApp: !!isCodeViaApp,
    });
  } catch (err: any) {
    console.error("[PhoneAuth] send-code error:", err);
    return c.json({ error: err.message || "Failed to send verification code" }, 500);
  }
});

/**
 * POST /api/auth/phone/verify
 * Body: { phoneAuthId: string, phoneCode: string, password?: string }
 */
phoneAuthRoute.post("/phone/verify", async (c) => {
  try {
    cleanupExpiredPhoneSessions();
    const { phoneAuthId, phoneCode, password } = await c.req.json();

    if (!phoneAuthId || !activePhoneLoginSessions.has(phoneAuthId)) {
      return c.json({ error: "Session expired or invalid. Please request a new verification code." }, 400);
    }

    const activeSession = activePhoneLoginSessions.get(phoneAuthId)!;
    const { client, phoneNumber, phoneCodeHash } = activeSession;

    const result = await verifyPhoneCode(
      client,
      phoneNumber,
      phoneCodeHash,
      phoneCode,
      password,
      c.env
    );

    if (result.requires2FA) {
      return c.json({ requires2FA: true, error: result.error || "2FA Password required" });
    }

    if (!result.success || !result.sessionString || !result.user) {
      return c.json({ error: result.error || "Failed to verify phone code" }, 400);
    }

    // Success! Save session and user to database
    activePhoneLoginSessions.delete(phoneAuthId);
    const db = getDb((c.env as any)?.DB);
    const telegramUserId = result.user.id?.toString() || result.user.id;
    const displayName =
      [result.user.firstName, result.user.lastName].filter(Boolean).join(" ") ||
      result.user.username ||
      "Telegram User";

    const { sessionId, clientSecret, sessionToken } = generateCompositeSessionToken();
    const encryptedSession = await encryptSession(
      result.sessionString,
      (c.env as any)?.SESSION_ENCRYPTION_KEY,
      clientSecret
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

    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await db.run(
      "INSERT INTO user_sessions (id, user_id, expires_at) VALUES (?, ?, ?)",
      [sessionId, userId, expiresAt]
    );

    // Set HttpOnly session cookie
    const cookieOpts = getAuthCookieOptions(c);
    setCookie(c, "aetheroll_session", sessionToken, cookieOpts);

    return c.json({
      success: true,
      sessionToken,
      user: {
        id: userId,
        telegramUserId,
        displayName,
      },
    });
  } catch (err: any) {
    console.error("[PhoneAuth] verify error:", err);
    return c.json({ error: err.message || "Failed to verify code" }, 500);
  }
});
