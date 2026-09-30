import type { DatabaseInterface } from "../lib/db";
import crypto from "crypto";

export interface SignupCampaign {
  id: string;
  name: string;
  targetTier: "premium" | "free";
  durationDays: number | null;
  maxClaims: number;
  claimedCount: number;
  isActive: boolean;
  priority: number;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
}

export interface SignupRewardClaim {
  tier: "premium" | "free";
  tierExpiresAt: string | null;
  tierGrantedBy: string | null;
  campaignId: string | null;
}

export interface CreateCampaignDTO {
  id?: string;
  name: string;
  targetTier?: "premium" | "free";
  durationDays?: number | null;
  maxClaims: number;
  isActive?: boolean;
  priority?: number;
  startsAt?: string | null;
  endsAt?: string | null;
}

export interface UpdateCampaignDTO {
  name?: string;
  targetTier?: "premium" | "free";
  durationDays?: number | null;
  maxClaims?: number;
  isActive?: boolean;
  priority?: number;
  startsAt?: string | null;
  endsAt?: string | null;
}

export class CampaignService {
  /**
   * Evaluates active campaigns and atomically claims a reward for a newly registering user.
   * Handles concurrency and race conditions cleanly with atomic SQL updates.
   * Uses SQLite datetime('now') for timezone/format agnostic comparisons.
   */
  static async claimSignupReward(db: DatabaseInterface): Promise<SignupRewardClaim> {
    const defaultReward: SignupRewardClaim = {
      tier: "free",
      tierExpiresAt: null,
      tierGrantedBy: null,
      campaignId: null,
    };

    try {
      // Find candidate active campaigns ordered by priority DESC, created_at ASC, id ASC
      const campaigns = await db.all<any>(
        `SELECT id, name, target_tier, duration_days, max_claims, claimed_count, is_active, priority, starts_at, ends_at
         FROM signup_campaigns
         WHERE is_active = 1
           AND claimed_count < max_claims
           AND (starts_at IS NULL OR datetime(starts_at) <= datetime('now'))
           AND (ends_at IS NULL OR datetime(ends_at) >= datetime('now'))
         ORDER BY priority DESC, created_at ASC, id ASC
         LIMIT 5`
      );

      if (!campaigns || campaigns.length === 0) {
        return defaultReward;
      }

      for (const campaign of campaigns) {
        // Attempt atomic reservation of 1 claim slot
        const updateRes = await db.run(
          `UPDATE signup_campaigns
           SET claimed_count = claimed_count + 1
           WHERE id = ?
             AND is_active = 1
             AND claimed_count < max_claims`,
          [campaign.id]
        );

        if (updateRes.changes > 0) {
          const targetTier = campaign.target_tier === "premium" ? "premium" : "free";
          let tierExpiresAt: string | null = null;

          if (targetTier === "premium" && campaign.duration_days && campaign.duration_days > 0) {
            tierExpiresAt = new Date(
              Date.now() + campaign.duration_days * 24 * 60 * 60 * 1000
            ).toISOString();
          }

          return {
            tier: targetTier,
            tierExpiresAt,
            tierGrantedBy: `campaign:${campaign.id}`,
            campaignId: campaign.id,
          };
        }
        // If atomic update failed (0 rows changed), another request grabbed the last slot. Continue loop to next eligible campaign.
      }
    } catch (err) {
      console.error("Failed to process campaign signup reward:", err);
    }

    return defaultReward;
  }

  /**
   * Rollback a claimed quota slot in case the subsequent user creation failed.
   */
  static async rollbackClaim(db: DatabaseInterface, campaignId?: string | null): Promise<void> {
    if (!campaignId) return;
    try {
      await db.run(
        `UPDATE signup_campaigns
         SET claimed_count = MAX(0, claimed_count - 1)
         WHERE id = ?`,
        [campaignId]
      );
    } catch (err) {
      console.error(`Failed to rollback campaign claim for '${campaignId}':`, err);
    }
  }

  /**
   * List all campaigns for Admin overview
   */
  static async listCampaigns(db: DatabaseInterface): Promise<SignupCampaign[]> {
    const rows = await db.all<any>(
      `SELECT id, name, target_tier, duration_days, max_claims, claimed_count, is_active, priority, starts_at, ends_at, created_at
       FROM signup_campaigns
       ORDER BY priority DESC, created_at DESC`
    );

    return (rows || []).map((r) => ({
      id: r.id,
      name: r.name,
      targetTier: r.target_tier,
      durationDays: r.duration_days,
      maxClaims: r.max_claims,
      claimedCount: r.claimed_count,
      isActive: r.is_active === 1,
      priority: r.priority,
      startsAt: r.starts_at || null,
      endsAt: r.ends_at || null,
      createdAt: r.created_at,
    }));
  }

  /**
   * Get single campaign details by ID
   */
  static async getCampaign(db: DatabaseInterface, id: string): Promise<SignupCampaign | null> {
    const r = await db.get<any>(
      `SELECT id, name, target_tier, duration_days, max_claims, claimed_count, is_active, priority, starts_at, ends_at, created_at
       FROM signup_campaigns
       WHERE id = ?`,
      [id]
    );

    if (!r) return null;

    return {
      id: r.id,
      name: r.name,
      targetTier: r.target_tier,
      durationDays: r.duration_days,
      maxClaims: r.max_claims,
      claimedCount: r.claimed_count,
      isActive: r.is_active === 1,
      priority: r.priority,
      startsAt: r.starts_at || null,
      endsAt: r.ends_at || null,
      createdAt: r.created_at,
    };
  }

  /**
   * Create a new campaign with strict validation
   */
  static async createCampaign(
    db: DatabaseInterface,
    dto: CreateCampaignDTO
  ): Promise<SignupCampaign> {
    const rawId = dto.id?.trim() || `camp_${crypto.randomUUID().slice(0, 8)}`;
    if (!/^[a-zA-Z0-9_-]+$/.test(rawId)) {
      throw new Error("Campaign ID must contain only alphanumeric characters, underscores, and hyphens");
    }
    const campaignId = rawId;

    const name = dto.name?.trim();
    if (!name) {
      throw new Error("Campaign name is required");
    }

    // Strict tier privilege control (never allow arbitrary creation of 'admin' tier via signup campaigns)
    const targetTier = dto.targetTier === "free" ? "free" : "premium";

    let durationDays: number | null = 30;
    if (dto.durationDays !== undefined) {
      if (dto.durationDays === null) {
        durationDays = null;
      } else {
        const d = Number(dto.durationDays);
        if (isNaN(d) || d < 0) {
          throw new Error("durationDays must be a non-negative integer or null for lifetime");
        }
        durationDays = d;
      }
    }

    const maxClaims = Number(dto.maxClaims);
    if (isNaN(maxClaims) || maxClaims <= 0) {
      throw new Error("maxClaims must be a positive integer");
    }

    const isActive = dto.isActive !== false ? 1 : 0;
    const priority = Number(dto.priority ?? 0);

    let startsAt: string | null = null;
    let endsAt: string | null = null;

    if (dto.startsAt) {
      const d = new Date(dto.startsAt);
      if (isNaN(d.getTime())) throw new Error("Invalid startsAt date format");
      startsAt = d.toISOString();
    }
    if (dto.endsAt) {
      const d = new Date(dto.endsAt);
      if (isNaN(d.getTime())) throw new Error("Invalid endsAt date format");
      endsAt = d.toISOString();
    }
    if (startsAt && endsAt && new Date(startsAt).getTime() > new Date(endsAt).getTime()) {
      throw new Error("startsAt must be before endsAt");
    }

    await db.run(
      `INSERT INTO signup_campaigns (id, name, target_tier, duration_days, max_claims, claimed_count, is_active, priority, starts_at, ends_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
      [campaignId, name, targetTier, durationDays, maxClaims, isActive, priority, startsAt, endsAt]
    );

    const created = await this.getCampaign(db, campaignId);
    if (!created) {
      throw new Error("Failed to retrieve created campaign");
    }
    return created;
  }

  /**
   * Update an existing campaign (pause, extend quota, change dates, etc.)
   */
  static async updateCampaign(
    db: DatabaseInterface,
    id: string,
    dto: UpdateCampaignDTO
  ): Promise<SignupCampaign> {
    const existing = await this.getCampaign(db, id);
    if (!existing) {
      throw new Error(`Campaign '${id}' not found`);
    }

    const updates: string[] = [];
    const params: any[] = [];

    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new Error("Campaign name cannot be empty");
      updates.push("name = ?");
      params.push(name);
    }
    if (dto.targetTier !== undefined) {
      updates.push("target_tier = ?");
      params.push(dto.targetTier === "free" ? "free" : "premium");
    }
    if (dto.durationDays !== undefined) {
      if (dto.durationDays === null) {
        updates.push("duration_days = ?");
        params.push(null);
      } else {
        const d = Number(dto.durationDays);
        if (isNaN(d) || d < 0) {
          throw new Error("durationDays must be a non-negative integer or null for lifetime");
        }
        updates.push("duration_days = ?");
        params.push(d);
      }
    }
    if (dto.maxClaims !== undefined) {
      const maxClaims = Number(dto.maxClaims);
      if (isNaN(maxClaims) || maxClaims < 0) {
        throw new Error("maxClaims must be a valid non-negative integer");
      }
      if (maxClaims < existing.claimedCount) {
        throw new Error(
          `maxClaims (${maxClaims}) cannot be less than already claimed count (${existing.claimedCount})`
        );
      }
      updates.push("max_claims = ?");
      params.push(maxClaims);
    }
    if (dto.isActive !== undefined) {
      updates.push("is_active = ?");
      params.push(dto.isActive ? 1 : 0);
    }
    if (dto.priority !== undefined) {
      updates.push("priority = ?");
      params.push(Number(dto.priority));
    }
    if (dto.startsAt !== undefined) {
      if (dto.startsAt === null) {
        updates.push("starts_at = ?");
        params.push(null);
      } else {
        const d = new Date(dto.startsAt);
        if (isNaN(d.getTime())) throw new Error("Invalid startsAt date format");
        updates.push("starts_at = ?");
        params.push(d.toISOString());
      }
    }
    if (dto.endsAt !== undefined) {
      if (dto.endsAt === null) {
        updates.push("ends_at = ?");
        params.push(null);
      } else {
        const d = new Date(dto.endsAt);
        if (isNaN(d.getTime())) throw new Error("Invalid endsAt date format");
        updates.push("ends_at = ?");
        params.push(d.toISOString());
      }
    }

    if (updates.length > 0) {
      params.push(id);
      await db.run(
        `UPDATE signup_campaigns SET ${updates.join(", ")} WHERE id = ?`,
        params
      );
    }

    const updated = await this.getCampaign(db, id);
    if (!updated) {
      throw new Error("Failed to retrieve updated campaign");
    }
    return updated;
  }

  /**
   * Delete or archive a campaign
   */
  static async deleteCampaign(db: DatabaseInterface, id: string): Promise<boolean> {
    const res = await db.run(`DELETE FROM signup_campaigns WHERE id = ?`, [id]);
    return res.changes > 0;
  }
}
