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
  isPro?: boolean;
  tier?: "free" | "premium" | "admin";
  tierExpiresAt?: string | null;
  isTierHeld?: boolean;
  tierHoldReason?: string | null;
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
        `SELECT u.id as user_id, u.telegram_user_id, u.display_name, u.session_string, u.tier, u.tier_expires_at, u.is_tier_held, u.tier_hold_reason, s.expires_at
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
      const tierInfo = computeEffectiveUserTier(
        {
          id: session.user_id,
          telegram_user_id: session.telegram_user_id,
          tier: session.tier,
          tier_expires_at: session.tier_expires_at,
          is_tier_held: session.is_tier_held,
          tier_hold_reason: session.tier_hold_reason,
        },
        c.env
      );

      return {
        authenticated: true,
        sessionId: parsed.sessionId,
        userId: session.user_id,
        telegramUserId: session.telegram_user_id,
        displayName: session.display_name,
        sessionString: decryptedSession,
        telegramConfig: config,
        isAdmin: tierInfo.isAdmin,
        tier: tierInfo.tier,
        tierExpiresAt: tierInfo.tierExpiresAt,
        isTierHeld: tierInfo.isTierHeld,
        tierHoldReason: tierInfo.tierHoldReason,
        isPro: tierInfo.isPro,
      };
    } catch (err: any) {
      lastError = err?.message || "Authentication failed";
    }
  }

  return { authenticated: false, error: lastError };
}

/**
 * Computes effective user tier with strict admin whitelist, hold, and expiration evaluation.
 */
export function computeEffectiveUserTier(
  userRow: {
    id?: string;
    user_id?: string;
    telegram_user_id?: string | number;
    tier?: string;
    tier_expires_at?: string | null;
    is_tier_held?: number | boolean;
    tier_hold_reason?: string | null;
  },
  env?: any
): {
  isAdmin: boolean;
  tier: "free" | "premium" | "admin";
  tierExpiresAt: string | null;
  isTierHeld: boolean;
  tierHoldReason: string | null;
  isPro: boolean;
} {
  const adminIdsStr =
    env?.ADMIN_TELEGRAM_USER_IDS ||
    env?.ADMIN_TELEGRAM_IDS ||
    process.env.ADMIN_TELEGRAM_USER_IDS ||
    process.env.ADMIN_TELEGRAM_IDS ||
    "";

  const userId = String(userRow.id || userRow.user_id || "");
  const tgUserId = String(userRow.telegram_user_id || "");

  let isAdmin = false;
  if (adminIdsStr && adminIdsStr.trim() !== "") {
    const adminIds = adminIdsStr.split(",").map((s: string) => s.trim()).filter(Boolean);
    isAdmin = adminIds.includes(tgUserId) || (userId ? adminIds.includes(userId) : false);
  }

  const isTierHeld = userRow.is_tier_held === 1 || userRow.is_tier_held === true;
  const rawTier = (userRow.tier === "premium" || userRow.tier === "admin") ? userRow.tier : "free";

  let effectiveTier: "free" | "premium" | "admin" = "free";
  if (isAdmin) {
    effectiveTier = "admin";
  } else if (!isTierHeld && (rawTier === "premium" || rawTier === "admin")) {
    if (!userRow.tier_expires_at || new Date(userRow.tier_expires_at).getTime() > Date.now()) {
      effectiveTier = rawTier;
    }
  }

  const isPro = (isAdmin || effectiveTier === "premium" || effectiveTier === "admin") && !isTierHeld;

  return {
    isAdmin,
    tier: effectiveTier,
    tierExpiresAt: userRow.tier_expires_at || null,
    isTierHeld,
    tierHoldReason: userRow.tier_hold_reason || null,
    isPro,
  };
}

/**
 * Computes the initial tier for newly registered users via dynamic Campaign Engine.
 * Evaluates active campaigns (e.g. First 100 users, Next 50 users) and atomically claims quota.
 */
export async function getInitialTierForNewUser(db: any): Promise<{
  tier: "free" | "premium";
  tierExpiresAt: string | null;
  tierGrantedBy: string | null;
  campaignId?: string | null;
}> {
  try {
    const { CampaignService } = await import("../services/campaignService");
    const reward = await CampaignService.claimSignupReward(db);
    return {
      tier: reward.tier,
      tierExpiresAt: reward.tierExpiresAt,
      tierGrantedBy: reward.tierGrantedBy,
      campaignId: reward.campaignId,
    };
  } catch (err) {
    console.error("Failed to claim campaign signup reward, falling back:", err);
    return {
      tier: "free",
      tierExpiresAt: null,
      tierGrantedBy: null,
      campaignId: null,
    };
  }
}

export interface UpsertUserParams {
  telegramUserId: string;
  displayName: string;
  encryptedSession: string;
  env?: any;
}

export interface UpsertUserResult {
  userId: string;
  telegramUserId: string;
  displayName: string;
  tier: "free" | "premium" | "admin";
  tierExpiresAt: string | null;
  isTierHeld: boolean;
  tierHoldReason: string | null;
  isAdmin: boolean;
  isPro: boolean;
  isNewUser: boolean;
}

/**
 * Concurrency-safe single source of truth for user onboarding and session association.
 * Automatically claims campaign rewards for new users and returns complete resolved tier entitlements.
 */
export async function upsertUserOnLogin(
  db: any,
  params: UpsertUserParams
): Promise<UpsertUserResult> {
  const { telegramUserId, displayName, encryptedSession, env } = params;

  let existingUser = await db.get("SELECT * FROM users WHERE telegram_user_id = ?", [telegramUserId]);

  if (existingUser) {
    await db.run(
      "UPDATE users SET display_name = ?, session_string = ? WHERE id = ?",
      [displayName, encryptedSession, existingUser.id]
    );
    const tierInfo = computeEffectiveUserTier(existingUser, env);
    return {
      userId: existingUser.id,
      telegramUserId,
      displayName,
      isNewUser: false,
      ...tierInfo,
    };
  }

  // Brand-new user: claim initial campaign tier
  const initialTier = await getInitialTierForNewUser(db);
  const newUserId = crypto.randomUUID();

  try {
    await db.run(
      `INSERT INTO users (id, telegram_user_id, display_name, session_string, tier, tier_expires_at, tier_granted_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        newUserId,
        telegramUserId,
        displayName,
        encryptedSession,
        initialTier.tier,
        initialTier.tierExpiresAt,
        initialTier.tierGrantedBy,
      ]
    );

    const tierInfo = computeEffectiveUserTier(
      {
        id: newUserId,
        telegram_user_id: telegramUserId,
        tier: initialTier.tier,
        tier_expires_at: initialTier.tierExpiresAt,
        is_tier_held: 0,
        tier_hold_reason: null,
      },
      env
    );

    return {
      userId: newUserId,
      telegramUserId,
      displayName,
      isNewUser: true,
      ...tierInfo,
    };
  } catch (insertErr: any) {
    // If insertion failed, rollback campaign claim to prevent quota leaks
    if (initialTier.campaignId) {
      const { CampaignService } = await import("../services/campaignService");
      await CampaignService.rollbackClaim(db, initialTier.campaignId);
    }

    // Handle race condition where another device created the user in parallel
    const racedUser = await db.get("SELECT * FROM users WHERE telegram_user_id = ?", [telegramUserId]);
    if (racedUser) {
      await db.run(
        "UPDATE users SET display_name = ?, session_string = ? WHERE id = ?",
        [displayName, encryptedSession, racedUser.id]
      );
      const tierInfo = computeEffectiveUserTier(racedUser, env);
      return {
        userId: racedUser.id,
        telegramUserId,
        displayName,
        isNewUser: false,
        ...tierInfo,
      };
    }

    throw insertErr;
  }
}




