import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CampaignService } from "./campaignService";

describe("⚡ Dynamic Signup Campaigns Engine Suite", () => {
  it("1. should atomically claim reward from active campaign", async () => {
    let claimedCount = 0;
    const mockDb: any = {
      all: async () => [
        {
          id: "welcome_first_100",
          name: "First 100 Users",
          target_tier: "premium",
          duration_days: 30,
          max_claims: 100,
          claimed_count: claimedCount,
          is_active: 1,
          priority: 10,
        },
      ],
      run: async () => {
        claimedCount++;
        return { changes: 1 };
      },
    };

    const claim = await CampaignService.claimSignupReward(mockDb);
    assert.equal(claim.tier, "premium");
    assert.equal(claim.campaignId, "welcome_first_100");
    assert.equal(claim.tierGrantedBy, "campaign:welcome_first_100");
    assert.ok(claim.tierExpiresAt);

    const expTime = new Date(claim.tierExpiresAt!).getTime();
    const diffDays = Math.round((expTime - Date.now()) / (24 * 60 * 60 * 1000));
    assert.equal(diffDays, 30);
    assert.equal(claimedCount, 1);
  });

  it("2. should fallback to free tier when campaign quota is fully exhausted", async () => {
    const mockDb: any = {
      all: async () => [], // No eligible campaigns with remaining quota
      run: async () => ({ changes: 0 }),
    };

    const claim = await CampaignService.claimSignupReward(mockDb);
    assert.equal(claim.tier, "free");
    assert.equal(claim.tierExpiresAt, null);
    assert.equal(claim.tierGrantedBy, null);
    assert.equal(claim.campaignId, null);
  });

  it("3. should handle concurrency race condition fallback when atomic slot update fails", async () => {
    const mockDb: any = {
      all: async () => [
        {
          id: "welcome_first_100",
          name: "First 100 Users",
          target_tier: "premium",
          duration_days: 30,
          max_claims: 100,
          claimed_count: 99,
          is_active: 1,
          priority: 10,
        },
      ],
      run: async () => {
        // Another thread snatched the last slot -> 0 rows updated
        return { changes: 0 };
      },
    };

    const claim = await CampaignService.claimSignupReward(mockDb);
    assert.equal(claim.tier, "free");
    assert.equal(claim.tierExpiresAt, null);
  });

  it("4. should support campaign CRUD operations", async () => {
    const memoryStore = new Map<string, any>();
    const mockDb: any = {
      run: async (sql: string, params: any[]) => {
        if (sql.startsWith("INSERT INTO signup_campaigns")) {
          const [id, name, target_tier, duration_days, max_claims, is_active, priority, starts_at, ends_at] = params;
          memoryStore.set(id, {
            id,
            name,
            target_tier,
            duration_days,
            max_claims,
            claimed_count: 0,
            is_active,
            priority,
            starts_at,
            ends_at,
            created_at: new Date().toISOString(),
          });
          return { changes: 1 };
        }
        if (sql.startsWith("UPDATE signup_campaigns SET")) {
          const id = params[params.length - 1];
          const item = memoryStore.get(id);
          if (item) {
            item.name = params[0];
            return { changes: 1 };
          }
          return { changes: 0 };
        }
        if (sql.startsWith("DELETE FROM signup_campaigns")) {
          const [id] = params;
          const existed = memoryStore.delete(id);
          return { changes: existed ? 1 : 0 };
        }
        return { changes: 0 };
      },
      get: async (sql: string, params: any[]) => {
        const [id] = params;
        return memoryStore.get(id) || null;
      },
      all: async () => Array.from(memoryStore.values()),
    };

    // Create
    const created = await CampaignService.createCampaign(mockDb, {
      id: "camp_batch_2",
      name: "Next 50 Users Promo",
      targetTier: "premium",
      durationDays: 14,
      maxClaims: 50,
      priority: 50,
    });
    assert.equal(created.id, "camp_batch_2");
    assert.equal(created.name, "Next 50 Users Promo");
    assert.equal(created.durationDays, 14);
    assert.equal(created.maxClaims, 50);

    // List
    const list = await CampaignService.listCampaigns(mockDb);
    assert.equal(list.length, 1);
    assert.equal(list[0].id, "camp_batch_2");

    // Update
    const updated = await CampaignService.updateCampaign(mockDb, "camp_batch_2", {
      name: "Updated Batch 2 Promo",
    });
    assert.equal(updated.name, "Updated Batch 2 Promo");

    // Delete
    const deleted = await CampaignService.deleteCampaign(mockDb, "camp_batch_2");
    assert.equal(deleted, true);
    const afterDelete = await CampaignService.getCampaign(mockDb, "camp_batch_2");
    assert.equal(afterDelete, null);
  });

  it("5. should support rollbackClaim on insert failures", async () => {
    let rollbackExecuted = false;
    const mockDb: any = {
      run: async (sql: string, params: any[]) => {
        if (sql.includes("MAX(0, claimed_count - 1)") && params[0] === "welcome_first_100") {
          rollbackExecuted = true;
          return { changes: 1 };
        }
        return { changes: 0 };
      },
    };

    await CampaignService.rollbackClaim(mockDb, "welcome_first_100");
    assert.equal(rollbackExecuted, true);
  });

  it("6. should reject invalid campaign inputs with descriptive errors", async () => {
    const mockDb: any = {};
    
    // Empty name
    await assert.rejects(
      async () => CampaignService.createCampaign(mockDb, { name: "   ", maxClaims: 10 }),
      /Campaign name is required/
    );

    // Negative / zero maxClaims
    await assert.rejects(
      async () => CampaignService.createCampaign(mockDb, { name: "Promo", maxClaims: 0 }),
      /maxClaims must be a positive integer/
    );

    // Invalid ID characters
    await assert.rejects(
      async () => CampaignService.createCampaign(mockDb, { id: "bad id!@#", name: "Promo", maxClaims: 10 }),
      /Campaign ID must contain only alphanumeric/
    );

    // Invalid date range
    await assert.rejects(
      async () => CampaignService.createCampaign(mockDb, {
        name: "Promo",
        maxClaims: 10,
        startsAt: "2026-10-10",
        endsAt: "2026-10-01",
      }),
      /startsAt must be before endsAt/
    );
  });
});

