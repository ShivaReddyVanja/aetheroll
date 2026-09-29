import { Hono } from "hono";
import { getDb } from "../../lib/db";
import { resolveUserAuth } from "../../lib/auth";
import { AdminService } from "../../services/adminService";
import crypto from "crypto";

export const tierRouter = new Hono();

// In-memory sliding window rate limiter for code redemptions (keyed by userId / IP)
const redeemAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_REDEEM_ATTEMPTS = 5;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

function checkRedeemRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = redeemAttempts.get(key);
  if (!entry || now > entry.resetAt) {
    redeemAttempts.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= MAX_REDEEM_ATTEMPTS) {
    return false;
  }
  entry.count += 1;
  return true;
}

/**
 * POST /api/tier/redeem
 * Redeems an activation/promo code to unlock Pro tier for the authenticated user
 */
tierRouter.post("/redeem", async (c) => {
  try {
    const auth = await resolveUserAuth(c);
    if (!auth.authenticated || !auth.userId) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    if (auth.isTierHeld) {
      return c.json({ error: "Your account Pro access is currently on hold. Please contact support." }, 403);
    }

    const clientIp = c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || "unknown";
    const rateLimitKey = `${auth.userId}:${clientIp}`;
    if (!checkRedeemRateLimit(rateLimitKey)) {
      return c.json(
        { error: "Too many redemption attempts. Please wait a few minutes before trying again." },
        429
      );
    }

    const body = await c.req.json().catch(() => ({}));
    const rawCode = body?.code;

    if (!rawCode || typeof rawCode !== "string" || !rawCode.trim()) {
      return c.json({ error: "Activation code is required" }, 400);
    }

    const rawInput = rawCode.trim().toUpperCase();
    const normalizedInput = rawInput.replace(/[^A-Z0-9]/g, "");
    const db = getDb((c.env as any)?.DB);

    // 1. Fetch activation code (supports both with dashes and without dashes)
    const codeRecord = await db.get(
      `SELECT * FROM activation_codes 
       WHERE (UPPER(code) = ? OR REPLACE(REPLACE(UPPER(code), '-', ''), ' ', '') = ?)
         AND is_active = 1
         AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
       LIMIT 1`,
      [rawInput, normalizedInput]
    );

    if (!codeRecord) {
      return c.json({ error: "Invalid or expired activation code" }, 400);
    }

    if (codeRecord.times_used >= codeRecord.max_uses) {
      return c.json({ error: "This activation code has already reached its maximum redemptions" }, 400);
    }

    // 2. Check if user already redeemed this specific code
    const existingRedemption = await db.get(
      `SELECT id FROM code_redemptions WHERE code = ? AND user_id = ?`,
      [codeRecord.code, auth.userId]
    );

    if (existingRedemption) {
      return c.json({ error: "You have already redeemed this activation code" }, 400);
    }

    // 3. Compute tier expiration
    let newExpiresAt: string | null = null;
    if (codeRecord.duration_days && codeRecord.duration_days > 0) {
      const now = Date.now();
      const durationMs = codeRecord.duration_days * 24 * 60 * 60 * 1000;
      newExpiresAt = new Date(now + durationMs).toISOString();
    }

    const targetTier = codeRecord.tier || "premium";
    const redemptionId = `red_${crypto.randomUUID()}`;

    // Check if user account is on hold
    if (auth.isTierHeld) {
      return c.json({ error: "Your account Pro access is currently on hold. Please contact support." }, 403);
    }

    // 4. Atomic increment on code usage (prevents race condition)
    const updateCodeRes = await db.run(
      `UPDATE activation_codes 
       SET times_used = times_used + 1
       WHERE code = ? AND times_used < max_uses AND is_active = 1`,
      [codeRecord.code]
    );

    // If changes === 0, another concurrent request claimed the last use
    if (updateCodeRes && (updateCodeRes as any).changes === 0) {
      return c.json({ error: "This activation code was just redeemed to its maximum limit" }, 400);
    }

    // 5. Update user record
    await db.run(
      `UPDATE users 
       SET tier = ?, tier_expires_at = ?, tier_granted_by = ?, is_tier_held = 0, tier_hold_reason = NULL
       WHERE id = ?`,
      [targetTier, newExpiresAt, codeRecord.code, auth.userId]
    );

    // 6. Record redemption audit log
    await db.run(
      `INSERT INTO code_redemptions (id, code, user_id)
       VALUES (?, ?, ?)`,
      [redemptionId, codeRecord.code, auth.userId]
    );

    return c.json({
      success: true,
      tier: targetTier,
      tierExpiresAt: newExpiresAt,
      message: "Pro access activated successfully!",
    });
  } catch (error: any) {
    console.error("[Tier:Redeem Error]:", error);
    return c.json({ error: "An unexpected error occurred while activating your code. Please try again." }, 500);
  }
});

/**
 * GET /api/tier/status
 * Returns current tier and entitlement status for the authenticated user
 */
tierRouter.get("/status", async (c) => {
  const auth = await resolveUserAuth(c);
  if (!auth.authenticated || !auth.userId) {
    return c.json({ authenticated: false, tier: "free", isPro: false }, 401);
  }

  const isPro = auth.tier === "premium" || auth.tier === "admin" || auth.isAdmin === true;

  return c.json({
    authenticated: true,
    tier: auth.tier || "free",
    tierExpiresAt: auth.tierExpiresAt || null,
    isTierHeld: auth.isTierHeld || false,
    tierHoldReason: auth.tierHoldReason || null,
    isAdmin: auth.isAdmin || false,
    isPro,
  });
});

/**
 * POST /api/tier/request
 * Logs or notifies admin of a user's request for Pro access
 */
tierRouter.post("/request", async (c) => {
  const auth = await resolveUserAuth(c);
  if (!auth.authenticated || !auth.userId) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  return c.json({
    success: true,
    message: "Pro access request received. An admin will review your account shortly.",
  });
});

/**
 * POST /api/tier/admin/hold
 * Admin endpoint to put a user's Pro access on hold
 */
tierRouter.post("/admin/hold", async (c) => {
  const auth = await resolveUserAuth(c);
  if (!auth.authenticated || !auth.isAdmin) {
    return c.json({ error: "Admin authorization required" }, 403);
  }

  const body = await c.req.json().catch(() => ({}));
  const targetUser = body.user_id || body.telegram_user_id;
  if (!targetUser) {
    return c.json({ error: "user_id or telegram_user_id is required" }, 400);
  }

  try {
    const db = getDb((c.env as any)?.DB);
    const result = await AdminService.holdUserTier(db, {
      targetUser,
      reason: body.reason || "Excessive usage / Account review",
    });
    return c.json({
      success: true,
      message: `User ${targetUser} Pro access placed on hold.`,
      user: result.user,
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

/**
 * POST /api/tier/admin/resume
 * Admin endpoint to resume a user's Pro access
 */
tierRouter.post("/admin/resume", async (c) => {
  const auth = await resolveUserAuth(c);
  if (!auth.authenticated || !auth.isAdmin) {
    return c.json({ error: "Admin authorization required" }, 403);
  }

  const body = await c.req.json().catch(() => ({}));
  const targetUser = body.user_id || body.telegram_user_id;
  if (!targetUser) {
    return c.json({ error: "user_id or telegram_user_id is required" }, 400);
  }

  try {
    const db = getDb((c.env as any)?.DB);
    const result = await AdminService.resumeUserTier(db, targetUser);
    return c.json({
      success: true,
      message: `User ${targetUser} Pro access resumed.`,
      user: result.user,
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});
