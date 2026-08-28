import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { getDb } from "./db.ts";
import { decryptSession } from "./crypto.ts";
import { getDefaultTelegramConfig, type TelegramConfig } from "./telegram.ts";
import crypto from "crypto";

export interface ParsedSessionToken {
  fullToken: string;
  sessionId: string;
  clientSecret?: string;
}

export interface AuthContext {
  authenticated: boolean;
  sessionId?: string;
  userId?: string;
  telegramUserId?: string;
  displayName?: string;
  sessionString?: string;
  telegramConfig?: TelegramConfig;
  error?: string;
}

/**
 * Single source of truth for extracting session tokens across:
 * 1. Cookie 'tg_session'
 * 2. Header 'Authorization: Bearer <token>'
 * 3. Header 'x-tg-session: <token>'
 * 4. Query param 'session_token'
 */
export function extractSessionToken(
  source: Context | Request | { headers?: Headers; url?: string } | any
): ParsedSessionToken | null {
  let rawToken: string | undefined | null = null;

  if (typeof source === "string") {
    rawToken = source;
  } else if (source && typeof source.req === "object") {
    // Hono Context
    const c = source as Context;
    rawToken =
      getCookie(c, "tg_session") ||
      getCookie(c, "aetheroll_session") ||
      c.req.header("x-tg-session") ||
      c.req.query("session_token");

    if (!rawToken) {
      const authHeader = c.req.header("authorization") || c.req.header("Authorization");
      if (authHeader && authHeader.startsWith("Bearer ")) {
        rawToken = authHeader.slice(7).trim();
      }
    }
  } else if (source instanceof Request || (source && typeof source.headers?.get === "function")) {
    // Standard Request object
    const req = source as Request;
    const cookieHeader = req.headers.get("cookie") || "";
    const tgMatch = cookieHeader.match(/(?:^|;\s*)tg_session=([^;]+)/);
    const aeMatch = cookieHeader.match(/(?:^|;\s*)aetheroll_session=([^;]+)/);
    if (tgMatch) rawToken = decodeURIComponent(tgMatch[1]);
    else if (aeMatch) rawToken = decodeURIComponent(aeMatch[1]);

    if (!rawToken) {
      rawToken = req.headers.get("x-tg-session");
    }
    if (!rawToken) {
      const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
      if (authHeader && authHeader.startsWith("Bearer ")) {
        rawToken = authHeader.slice(7).trim();
      }
    }
    if (!rawToken && req.url) {
      try {
        const url = new URL(req.url);
        rawToken = url.searchParams.get("session_token");
      } catch {}
    }
  }

  if (!rawToken || rawToken.trim() === "" || rawToken === "default") {
    return null;
  }

  const clean = rawToken.trim();
  const parts = clean.split(".");

  if (parts.length >= 2 && parts[0] && parts[1]) {
    return {
      fullToken: clean,
      sessionId: parts[0],
      clientSecret: parts.slice(1).join("."),
    };
  }

  // Legacy single-part token
  return {
    fullToken: clean,
    sessionId: clean,
    clientSecret: undefined,
  };
}

/**
 * Creates a zero-knowledge composite session token: `<sessionId>.<clientSecret>`
 */
export function generateCompositeSessionToken(): {
  sessionId: string;
  clientSecret: string;
  sessionToken: string;
} {
  const sessionId = crypto.randomUUID();
  const clientSecret = crypto.randomBytes(32).toString("hex");
  return {
    sessionId,
    clientSecret,
    sessionToken: `${sessionId}.${clientSecret}`,
  };
}

/**
 * Resolves user authentication from Hono Context, verifying against database and decrypting session with dual-key in volatile RAM
 */
export async function resolveUserAuth(c: Context): Promise<AuthContext> {
  const parsed = extractSessionToken(c);
  if (!parsed) {
    return { authenticated: false, error: "No session token provided" };
  }

  try {
    const db = getDb((c.env as any)?.DB);
    const session = await db.get(
      `SELECT u.id as user_id, u.telegram_user_id, u.display_name, u.session_string, s.expires_at
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > CURRENT_TIMESTAMP`,
      [parsed.sessionId]
    );

    if (!session) {
      return { authenticated: false, error: "Session expired or not found" };
    }

    const serverKey = (c.env as any)?.SESSION_ENCRYPTION_KEY || process.env.SESSION_ENCRYPTION_KEY;
    const decryptedSession = await decryptSession(
      session.session_string,
      serverKey,
      parsed.clientSecret
    );

    const config = getDefaultTelegramConfig(c.env);

    return {
      authenticated: true,
      sessionId: parsed.sessionId,
      userId: session.user_id,
      telegramUserId: session.telegram_user_id,
      displayName: session.display_name,
      sessionString: decryptedSession,
      telegramConfig: config,
    };
  } catch (err: any) {
    return { authenticated: false, error: err?.message || "Authentication failed" };
  }
}
