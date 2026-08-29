import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import crypto from "crypto";
import { getDb } from "../../lib/db.ts";
import { encryptSession, decryptSession } from "../../lib/crypto.ts";
import { generateCompositeSessionToken } from "../../lib/auth.ts";
import { sendPhoneCode, verifyPhoneCode } from "../../lib/telegram.ts";
import { getAuthCookieOptions, forwardToAuthDO, appendCleanSingleAuthCookieHeaders } from "./utils.ts";

export const phoneAuthRoute = new Hono();

// Active in-memory phone login sessions
const activePhoneLoginSessions = new Map<
  string,
  {
    phoneNumber: string;
    phoneCodeHash: string;
    encryptedPhoneAuthSessionString: string;
    expires: number;
    attempts: number;
  }
>();

function cleanupExpiredPhoneSessions() {
  const now = Date.now();
  for (const [id, session] of activePhoneLoginSessions.entries()) {
    if (session.expires < now) {
      activePhoneLoginSessions.delete(id);
    }
  }
}

/**
 * POST /api/auth/phone/send-code
 * Body: { phoneNumber: string }
 */
phoneAuthRoute.post("/phone/send-code", async (c) => {
  if ((c.env as any)?.AUTH_DO) {
    return forwardToAuthDO(c);
  }

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

    const { phoneCodeHash, phoneAuthSessionString, isCodeViaApp } = await sendPhoneCode(cleanPhone, c.env);
    const phoneAuthId = crypto.randomUUID();

    const encryptedPhoneAuthSessionString = await encryptSession(
      phoneAuthSessionString,
      (c.env as any)?.SESSION_ENCRYPTION_KEY
    );

    activePhoneLoginSessions.set(phoneAuthId, {
      phoneNumber: cleanPhone,
      phoneCodeHash,
      encryptedPhoneAuthSessionString,
      expires: Date.now() + 15 * 60 * 1000, // 15 minutes expiry
      attempts: 0,
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
  if ((c.env as any)?.AUTH_DO) {
    return forwardToAuthDO(c);
  }

  try {
    cleanupExpiredPhoneSessions();
    const { phoneAuthId, phoneCode, password } = await c.req.json();

    if (!phoneAuthId || !activePhoneLoginSessions.has(phoneAuthId)) {
      return c.json({ error: "Session expired or invalid. Please request a new verification code." }, 400);
    }

    const activeSession = activePhoneLoginSessions.get(phoneAuthId)!;

    // Rate limit / brute-force protection: Max 5 attempts
    if (activeSession.attempts >= 5) {
      activePhoneLoginSessions.delete(phoneAuthId);
      return c.json({ error: "Too many failed attempts. Please request a new verification code." }, 429);
    }
    activeSession.attempts++;

    // Validate 5-digit verification code format unless providing 2FA password
    const cleanCode = (phoneCode || "").toString().trim();
    if (!password && (!cleanCode || !/^\d{5}$/.test(cleanCode))) {
      return c.json({ error: "Invalid verification code format. Code must be a 5-digit number." }, 400);
    }

    const { phoneNumber, phoneCodeHash, encryptedPhoneAuthSessionString } = activeSession;

    const phoneAuthSessionString = await decryptSession(
      encryptedPhoneAuthSessionString,
      (c.env as any)?.SESSION_ENCRYPTION_KEY
    );

    const result = await verifyPhoneCode(
      phoneNumber,
      phoneCodeHash,
      cleanCode,
      phoneAuthSessionString,
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

    // Set HttpOnly single clean session cookie
    const host = c.req.header("host") || "";
    const origin = c.req.header("origin") || "";
    const isBuiltByShiva = host.includes("builtbyshiva.com") || origin.includes("builtbyshiva.com");
    appendCleanSingleAuthCookieHeaders(c.res.headers, sessionToken, isBuiltByShiva);

    return c.json({
      success: true,
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
