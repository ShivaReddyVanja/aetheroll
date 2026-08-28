import crypto from "crypto";
import { getDb } from "../../lib/db.ts";
import { encryptSession, decryptSession } from "../../lib/crypto.ts";
import { generateCompositeSessionToken } from "../../lib/auth.ts";
import { sendPhoneCode, verifyPhoneCode } from "../../lib/telegram.ts";

export class PhoneAuthHandler {
  activeSessions: Map<
    string,
    {
      phoneNumber: string;
      phoneCodeHash: string;
      encryptedPhoneAuthSessionString: string;
      expires: number;
      attempts: number;
    }
  >;
  env: any;

  constructor(env: any) {
    this.env = env;
    this.activeSessions = new Map();
  }

  cleanupExpiredSessions() {
    const now = Date.now();
    for (const [id, session] of this.activeSessions.entries()) {
      if (session.expires < now) {
        this.activeSessions.delete(id);
      }
    }
  }

  async handleSendCodeHttp(envObj?: any, request?: Request): Promise<Response> {
    const origin = request?.headers?.get("origin") || "*";
    this.cleanupExpiredSessions();

    try {
      const targetEnv = envObj || this.env;
      const body = (await request?.json().catch(() => ({}))) as any;
      const { phoneNumber } = body || {};

      if (!phoneNumber || typeof phoneNumber !== "string") {
        return new Response(JSON.stringify({ error: "Valid phone number is required" }), {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Credentials": "true",
          },
        });
      }

      const cleanPhone = phoneNumber.trim().replace(/[^\d+]/g, "");
      if (!cleanPhone.startsWith("+") || cleanPhone.length < 8) {
        return new Response(
          JSON.stringify({ error: "Please enter a valid phone number with country code (e.g. +1234567890)" }),
          {
            status: 400,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": origin,
              "Access-Control-Allow-Credentials": "true",
            },
          }
        );
      }

      const { phoneCodeHash, phoneAuthSessionString, isCodeViaApp } = await sendPhoneCode(cleanPhone, targetEnv);
      const phoneAuthId = crypto.randomUUID();

      // Encrypt MTProto AuthKey session string before storing in memory
      const encryptedPhoneAuthSessionString = await encryptSession(
        phoneAuthSessionString,
        targetEnv?.SESSION_ENCRYPTION_KEY
      );

      this.activeSessions.set(phoneAuthId, {
        phoneNumber: cleanPhone,
        phoneCodeHash,
        encryptedPhoneAuthSessionString,
        expires: Date.now() + 15 * 60 * 1000,
        attempts: 0,
      });

      return new Response(
        JSON.stringify({
          phoneAuthId,
          isCodeViaApp: !!isCodeViaApp,
        }),
        {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Credentials": "true",
          },
        }
      );
    } catch (err: any) {
      console.error("[PhoneAuthDO Error]:", err);
      return new Response(
        JSON.stringify({ error: err?.message || "Failed to send verification code" }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Credentials": "true",
          },
        }
      );
    }
  }

  async handleVerifyCodeHttp(envObj?: any, request?: Request): Promise<Response> {
    const origin = request?.headers?.get("origin") || "*";
    const isBuiltByShiva = origin.includes("builtbyshiva.com");
    const domainPart = isBuiltByShiva ? "; Domain=.builtbyshiva.com" : "";
    this.cleanupExpiredSessions();

    try {
      const targetEnv = envObj || this.env;
      const body = (await request?.json().catch(() => ({}))) as any;
      const { phoneAuthId, phoneCode, password } = body || {};

      if (!phoneAuthId || !this.activeSessions.has(phoneAuthId)) {
        return new Response(
          JSON.stringify({ error: "Session expired or invalid. Please request a new verification code." }),
          {
            status: 400,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": origin,
              "Access-Control-Allow-Credentials": "true",
            },
          }
        );
      }

      const activeSession = this.activeSessions.get(phoneAuthId)!;

      // Rate limit / brute-force protection: Max 5 attempts per verification session
      if (activeSession.attempts >= 5) {
        this.activeSessions.delete(phoneAuthId);
        return new Response(
          JSON.stringify({ error: "Too many failed attempts. Please request a new verification code." }),
          {
            status: 429,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": origin,
              "Access-Control-Allow-Credentials": "true",
            },
          }
        );
      }
      activeSession.attempts++;

      // Validate 5-digit verification code format unless providing 2FA password
      const cleanCode = (phoneCode || "").toString().trim();
      if (!password && (!cleanCode || !/^\d{5}$/.test(cleanCode))) {
        return new Response(
          JSON.stringify({ error: "Invalid verification code format. Code must be a 5-digit number." }),
          {
            status: 400,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": origin,
              "Access-Control-Allow-Credentials": "true",
            },
          }
        );
      }

      const { phoneNumber, phoneCodeHash, encryptedPhoneAuthSessionString } = activeSession;

      // Decrypt MTProto session string
      const phoneAuthSessionString = await decryptSession(
        encryptedPhoneAuthSessionString,
        targetEnv?.SESSION_ENCRYPTION_KEY
      );

      const result = await verifyPhoneCode(
        phoneNumber,
        phoneCodeHash,
        cleanCode,
        phoneAuthSessionString,
        password,
        targetEnv
      );

      if (result.requires2FA) {
        return new Response(
          JSON.stringify({ requires2FA: true, error: result.error || "2FA Password required" }),
          {
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": origin,
              "Access-Control-Allow-Credentials": "true",
            },
          }
        );
      }

      if (!result.success || !result.sessionString || !result.user) {
        return new Response(
          JSON.stringify({ error: result.error || "Failed to verify phone code" }),
          {
            status: 400,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": origin,
              "Access-Control-Allow-Credentials": "true",
            },
          }
        );
      }

      // Success! Save session and user to database and scrub temporary auth session
      this.activeSessions.delete(phoneAuthId);
      const db = getDb(targetEnv?.DB);
      const telegramUserId = result.user.id?.toString() || result.user.id;
      const displayName =
        [result.user.firstName, result.user.lastName].filter(Boolean).join(" ") ||
        result.user.username ||
        "Telegram User";

      const { sessionId, clientSecret, sessionToken } = generateCompositeSessionToken();
      const encryptedSession = await encryptSession(
        result.sessionString,
        targetEnv?.SESSION_ENCRYPTION_KEY,
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

      const cookieValue = `tg_session=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=2592000${domainPart}`;
      return new Response(
        JSON.stringify({
          success: true,
          user: {
            id: userId,
            telegramUserId,
            displayName,
          },
        }),
        {
          headers: {
            "Content-Type": "application/json",
            "Set-Cookie": cookieValue,
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Credentials": "true",
          },
        }
      );
    } catch (err: any) {
      console.error("[PhoneAuthDO Verify Error]:", err);
      return new Response(
        JSON.stringify({ error: err?.message || "Failed to verify code" }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Credentials": "true",
          },
        }
      );
    }
  }
}
