import crypto from "crypto";
import { getDb } from "../../lib/db.ts";
import { encryptSession } from "../../lib/crypto.ts";
import { generateCompositeSessionToken } from "../../lib/auth.ts";
import { sendPhoneCode, verifyPhoneCode } from "../../lib/telegram.ts";

export class PhoneAuthHandler {
  activeSessions: Map<
    string,
    { client: any; phoneNumber: string; phoneCodeHash: string; expires: number }
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
        try {
          session.client.disconnect();
        } catch {}
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

      const { client, phoneCodeHash, isCodeViaApp } = await sendPhoneCode(cleanPhone, targetEnv);
      const phoneAuthId = crypto.randomUUID();

      this.activeSessions.set(phoneAuthId, {
        client,
        phoneNumber: cleanPhone,
        phoneCodeHash,
        expires: Date.now() + 10 * 60 * 1000,
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
      const { client, phoneNumber, phoneCodeHash } = activeSession;

      const result = await verifyPhoneCode(
        client,
        phoneNumber,
        phoneCodeHash,
        phoneCode,
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

      // Success! Save session and user to database
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
          sessionToken,
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
