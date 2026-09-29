import crypto from "crypto";
import { DatabaseInterface } from "../lib/db";

export interface UserSummary {
  id: string;
  telegramUserId: number;
  displayName: string;
  tier: string;
  isTierHeld: boolean;
  tierHoldReason: string | null;
  tierExpiresAt: string | null;
  tierGrantedBy: string | null;
  createdAt: string;
  mediaCount?: number;
}

export interface ActivationCodeSummary {
  code: string;
  tier: string;
  durationDays: number | null;
  maxUses: number;
  timesUsed: number;
  isActive: boolean;
  note: string | null;
  createdAt: string;
  expiresAt: string | null;
}

export const ALLOWED_TIERS = ["free", "premium"] as const;
export type UserTier = (typeof ALLOWED_TIERS)[number];

export function validateTier(tier?: string, fallback: UserTier = "premium"): UserTier {
  if (tier && (ALLOWED_TIERS as readonly string[]).includes(tier.toLowerCase())) {
    return tier.toLowerCase() as UserTier;
  }
  return fallback;
}

/**
 * Normalizes user identifier input (e.g. numeric telegram_user_id or UUID id)
 */
export function buildUserWhere(identifier: string | number): { clause: string; params: any[] } {
  const strId = String(identifier).trim();
  const numericId = Number(strId);

  if (!isNaN(numericId) && numericId > 0) {
    return {
      clause: "(telegram_user_id = ? OR id = ?)",
      params: [numericId, strId],
    };
  }
  return {
    clause: "id = ?",
    params: [strId],
  };
}

export class AdminService {
  /**
   * List all registered users with pagination, tier status, and media count.
   */
  static async listUsers(
    db: DatabaseInterface,
    options: { limit?: number; offset?: number; search?: string } = {}
  ): Promise<{ users: UserSummary[]; total: number }> {
    const limit = Math.min(Math.max(options.limit || 20, 1), 100);
    const offset = Math.max(options.offset || 0, 0);

    let whereSql = "";
    const params: any[] = [];

    if (options.search && options.search.trim()) {
      const q = `%${options.search.trim()}%`;
      whereSql = "WHERE display_name LIKE ? OR telegram_user_id LIKE ? OR id LIKE ?";
      params.push(q, q, q);
    }

    const countRes = await db.get(
      `SELECT COUNT(*) as count FROM users ${whereSql}`,
      params
    );
    const total = Number(countRes?.count || 0);

    const rows = await db.all(
      `SELECT id, telegram_user_id, display_name, tier, tier_expires_at, tier_granted_by,
              is_tier_held, tier_hold_reason, created_at
       FROM users
       ${whereSql}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const users: UserSummary[] = (rows || []).map((r: any) => ({
      id: r.id,
      telegramUserId: Number(r.telegram_user_id),
      displayName: r.display_name || "Anonymous",
      tier: r.tier || "free",
      isTierHeld: r.is_tier_held === 1,
      tierHoldReason: r.tier_hold_reason || null,
      tierExpiresAt: r.tier_expires_at || null,
      tierGrantedBy: r.tier_granted_by || null,
      createdAt: r.created_at,
    }));

    return { users, total };
  }

  /**
   * Get single user detailed statistics and subscription status.
   */
  static async getUserDetails(
    db: DatabaseInterface,
    targetUser: string | number
  ): Promise<UserSummary | null> {
    const { clause, params } = buildUserWhere(targetUser);
    const row = await db.get(
      `SELECT id, telegram_user_id, display_name, tier, tier_expires_at, tier_granted_by,
              is_tier_held, tier_hold_reason, created_at
       FROM users
       WHERE ${clause}
       LIMIT 1`,
      params
    );

    if (!row) return null;

    // Fetch media item count
    const mediaCountRow = await db.get(
      `SELECT COUNT(*) as count FROM media_items WHERE user_id = ?`,
      [row.id]
    ).catch(() => ({ count: 0 }));

    return {
      id: row.id,
      telegramUserId: Number(row.telegram_user_id),
      displayName: row.display_name || "Anonymous",
      tier: row.tier || "free",
      isTierHeld: row.is_tier_held === 1,
      tierHoldReason: row.tier_hold_reason || null,
      tierExpiresAt: row.tier_expires_at || null,
      tierGrantedBy: row.tier_granted_by || null,
      createdAt: row.created_at,
      mediaCount: Number(mediaCountRow?.count || 0),
    };
  }

  /**
   * Generate a custom or randomized Pro activation promo code.
   */
  static async generateActivationCode(
    db: DatabaseInterface,
    options: {
      code?: string;
      durationDays?: number | null;
      maxUses?: number;
      tier?: string;
      note?: string;
      expiresAt?: string | null;
    }
  ): Promise<ActivationCodeSummary> {
    let finalCode = (options.code || "").trim().toUpperCase();

    if (!finalCode) {
      const randomPart1 = crypto.randomBytes(3).toString("hex").toUpperCase();
      const randomPart2 = crypto.randomBytes(3).toString("hex").toUpperCase();
      finalCode = `PRO-${randomPart1}-${randomPart2}`;
    } else {
      if (finalCode.length < 3 || finalCode.length > 64) {
        throw new Error("Activation code must be between 3 and 64 characters.");
      }
      if (!/^[A-Z0-9\-_]+$/.test(finalCode)) {
        throw new Error("Activation code contains invalid characters. Use letters, numbers, dashes, and underscores only.");
      }
    }

    // Pre-check for duplicate code
    const existing = await db.get(
      `SELECT code FROM activation_codes WHERE UPPER(code) = ? LIMIT 1`,
      [finalCode]
    );
    if (existing) {
      throw new Error(`Activation code '${finalCode}' already exists.`);
    }

    let durationDays: number | null = 30;
    if (options.durationDays !== undefined) {
      if (options.durationDays === null || options.durationDays === 0) {
        durationDays = null;
      } else {
        durationDays = Math.min(Math.max(1, options.durationDays), 3650); // Cap between 1 day and 10 years
      }
    }

    const maxUses = options.maxUses !== undefined ? Math.min(Math.max(1, options.maxUses), 10000) : 1;
    const tier = validateTier(options.tier, "premium");
    const note = options.note ? String(options.note).slice(0, 255) : "Admin generated";

    await db.run(
      `INSERT INTO activation_codes (code, tier, duration_days, max_uses, times_used, is_active, note, expires_at)
       VALUES (?, ?, ?, ?, 0, 1, ?, ?)`,
      [finalCode, tier, durationDays, maxUses, note, options.expiresAt || null]
    );

    return {
      code: finalCode,
      tier,
      durationDays,
      maxUses,
      timesUsed: 0,
      isActive: true,
      note,
      createdAt: new Date().toISOString(),
      expiresAt: options.expiresAt || null,
    };
  }

  /**
   * Directly assign Pro membership to a user by Telegram ID.
   */
  static async assignUserTier(
    db: DatabaseInterface,
    options: {
      targetUser: string | number;
      tier?: string;
      durationDays?: number | null;
      grantedBy?: string;
    }
  ): Promise<{ success: boolean; user: UserSummary }> {
    const { clause, params } = buildUserWhere(options.targetUser);
    const existing = await this.getUserDetails(db, options.targetUser);

    if (!existing) {
      throw new Error(`User [${options.targetUser}] not found in database.`);
    }

    const targetTier = validateTier(options.tier, "premium");
    let newExpiresAt: string | null = null;

    if (options.durationDays !== undefined && options.durationDays !== null && options.durationDays > 0) {
      const clampedDays = Math.min(options.durationDays, 3650);
      const now = Date.now();
      const durationMs = clampedDays * 24 * 60 * 60 * 1000;
      newExpiresAt = new Date(now + durationMs).toISOString();
    }

    await db.run(
      `UPDATE users 
       SET tier = ?, tier_expires_at = ?, tier_granted_by = ?, is_tier_held = 0, tier_hold_reason = NULL
       WHERE ${clause}`,
      [targetTier, newExpiresAt, options.grantedBy || "admin_bot", ...params]
    );

    const updated = (await this.getUserDetails(db, options.targetUser))!;
    return { success: true, user: updated };
  }

  /**
   * Hold / pause a user's Pro membership.
   */
  static async holdUserTier(
    db: DatabaseInterface,
    options: {
      targetUser: string | number;
      reason?: string;
    }
  ): Promise<{ success: boolean; user: UserSummary }> {
    const { clause, params } = buildUserWhere(options.targetUser);
    const existing = await this.getUserDetails(db, options.targetUser);

    if (!existing) {
      throw new Error(`User [${options.targetUser}] not found in database.`);
    }

    const reason = options.reason || "Administrative hold";

    await db.run(
      `UPDATE users SET is_tier_held = 1, tier_hold_reason = ? WHERE ${clause}`,
      [reason, ...params]
    );

    const updated = (await this.getUserDetails(db, options.targetUser))!;
    return { success: true, user: updated };
  }

  /**
   * Resume a paused Pro membership.
   */
  static async resumeUserTier(
    db: DatabaseInterface,
    targetUser: string | number
  ): Promise<{ success: boolean; user: UserSummary }> {
    const { clause, params } = buildUserWhere(targetUser);
    const existing = await this.getUserDetails(db, targetUser);

    if (!existing) {
      throw new Error(`User [${targetUser}] not found in database.`);
    }

    await db.run(
      `UPDATE users SET is_tier_held = 0, tier_hold_reason = NULL WHERE ${clause}`,
      params
    );

    const updated = (await this.getUserDetails(db, targetUser))!;
    return { success: true, user: updated };
  }

  /**
   * Revoke Pro membership and reset user to Free tier.
   */
  static async revokeUserTier(
    db: DatabaseInterface,
    targetUser: string | number
  ): Promise<{ success: boolean; user: UserSummary }> {
    const { clause, params } = buildUserWhere(targetUser);
    const existing = await this.getUserDetails(db, targetUser);

    if (!existing) {
      throw new Error(`User [${targetUser}] not found in database.`);
    }

    await db.run(
      `UPDATE users 
       SET tier = 'free', tier_expires_at = NULL, is_tier_held = 0, tier_hold_reason = NULL, tier_granted_by = NULL
       WHERE ${clause}`,
      params
    );

    const updated = (await this.getUserDetails(db, targetUser))!;
    return { success: true, user: updated };
  }
}
