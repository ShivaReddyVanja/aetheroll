import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { getDb } from "./db";
import { decryptSession } from "./crypto";
import { getDefaultTelegramConfig, type TelegramConfig } from "./telegram";
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
  isAdmin?: boolean;
  error?: string;
}

/**
 * Single source of truth for extracting session tokens across:
 * 1. Cookie 'tg_session'
 * 2. Header 'Authorization: Bearer <token>'
 * 3. Header 'x-tg-session: <token>'
 * 4. Query param 'session_token'
 */
/**
 * Extracts all candidate session tokens across cookies, headers, and query parameters
 */
export function extractAllSessionTokens(
  source: Context | Request | { headers?: Headers; url?: string } | any
): ParsedSessionToken[] {
  const rawTokens: string[] = [];
  let cookieHeader = "";
  let headerSession: string | null = null;
  let authHeader: string | null = null;
  let urlSessionToken: string | null = null;

  if (typeof source === "string") {
    rawTokens.push(source);
  } else if (source && typeof source.req === "object") {
    // Hono Context
    const c = source as Context;
    cookieHeader = c.req.header("cookie") || c.req.header("Cookie") || "";
    headerSession = c.req.header("x-tg-session") || null;
    authHeader = c.req.header("authorization") || c.req.header("Authorization") || null;
    urlSessionToken = c.req.query("session_token") || null;
  } else if (source instanceof Request || (source && typeof source.headers?.get === "function")) {
    const req = source as Request;
    cookieHeader = req.headers.get("cookie") || req.headers.get("Cookie") || "";
    headerSession = req.headers.get("x-tg-session");
    authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
    if (req.url) {
      try {
        const url = new URL(req.url);
        urlSessionToken = url.searchParams.get("session_token");
      } catch {}
    }
  }

  // Extract all tg_session and aetheroll_session cookies (handles duplicate/stale cookie headers)
  if (cookieHeader) {
    const matches = cookieHeader.matchAll(/(?:^|;\s*)(?:tg_session|aetheroll_session)=([^;]+)/g);
    for (const match of matches) {
      if (match[1]) {
        try {
          rawTokens.push(decodeURIComponent(match[1]));
        } catch {
          rawTokens.push(match[1]);
        }
      }
    }
  }

  if (headerSession) rawTokens.push(headerSession);
  if (authHeader && authHeader.startsWith("Bearer ")) {
    rawTokens.push(authHeader.slice(7).trim());
  }
  if (urlSessionToken) rawTokens.push(urlSessionToken);

  const results: ParsedSessionToken[] = [];
  const seen = new Set<string>();

  for (const raw of rawTokens) {
    if (!raw || raw.trim() === "" || raw === "default") continue;
    const clean = raw.trim();
    if (seen.has(clean)) continue;
    seen.add(clean);

    const parts = clean.split(".");
    if (parts.length >= 2 && parts[0] && parts[1]) {
      results.push({
        fullToken: clean,
        sessionId: parts[0],
        clientSecret: parts.slice(1).join("."),
      });
    } else {
      results.push({
        fullToken: clean,
        sessionId: clean,
        clientSecret: undefined,
      });
    }
  }

  return results;
}

/**
 * Single source of truth for extracting primary session token
 */
export function extractSessionToken(
  source: Context | Request | { headers?: Headers; url?: string } | any
): ParsedSessionToken | null {
  const all = extractAllSessionTokens(source);
  return all.length > 0 ? all[0] : null;
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
  const candidates = extractAllSessionTokens(c);
  if (candidates.length === 0) {
    return { authenticated: false, error: "No session token provided" };
  }

  const db = getDb((c.env as any)?.DB);
  const serverKey = (c.env as any)?.SESSION_ENCRYPTION_KEY || process.env.SESSION_ENCRYPTION_KEY;
  let lastError = "Session expired or not found";

  for (const parsed of candidates) {
    try {
      const session = await db.get(
        `SELECT u.id as user_id, u.telegram_user_id, u.display_name, u.session_string, s.expires_at
         FROM user_sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.id = ? AND s.expires_at > CURRENT_TIMESTAMP`,
        [parsed.sessionId]
      );

      if (!session) {
        continue;
      }

      const decryptedSession = await decryptSession(
        session.session_string,
        serverKey,
        parsed.clientSecret
      );

      const config = getDefaultTelegramConfig(c.env);

      const adminIdsStr =
        (c.env as any)?.ADMIN_TELEGRAM_USER_IDS || process.env.ADMIN_TELEGRAM_USER_IDS || "";

      let isAdmin = false;
      if (adminIdsStr && adminIdsStr.trim() !== "") {
        const adminIds = adminIdsStr.split(",").map((s: string) => s.trim());
        isAdmin =
          adminIds.includes(String(session.telegram_user_id)) ||
          adminIds.includes(String(session.user_id));
      }

      return {
        authenticated: true,
        sessionId: parsed.sessionId,
        userId: session.user_id,
        telegramUserId: session.telegram_user_id,
        displayName: session.display_name,
        sessionString: decryptedSession,
        telegramConfig: config,
        isAdmin,
      };
    } catch (err: any) {
      lastError = err?.message || "Authentication failed";
    }
  }

  return { authenticated: false, error: lastError };
}
