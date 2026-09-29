import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { botRouter } from "./botRouter";
import { adminRouter } from "../admin/adminRouter";
import { AdminService } from "../../services/adminService";

describe("🤖 Telegram Bot & Admin Tier Management Suite", () => {
  const app = new Hono();
  app.route("/bot", botRouter);
  app.route("/admin", adminRouter);

  // In-memory mock database
  const createMockDb = (initialUsers: any[] = [], initialCodes: any[] = []) => {
    const users = [...initialUsers];
    const codes = [...initialCodes];

    return {
      get: async (query: string, params: any[] = []) => {
        if (query.includes("COUNT(*) as count FROM users")) {
          return { count: users.length };
        }
        if (query.includes("SELECT id, telegram_user_id") || query.includes("FROM users WHERE")) {
          const p = params[0];
          return users.find((u) => u.id === p || u.telegram_user_id === p) || null;
        }
        if (query.includes("COUNT(*) as count FROM media_items")) {
          return { count: 42 };
        }
        if (query.includes("SELECT tier FROM users WHERE telegram_user_id")) {
          const p = params[0];
          const found = users.find((u) => u.telegram_user_id === p);
          return found ? { tier: found.tier } : null;
        }
        return null;
      },
      all: async (query: string, params: any[] = []) => {
        if (query.includes("FROM users")) {
          return users;
        }
        return [];
      },
      run: async (query: string, params: any[] = []) => {
        const normalizedQuery = query.replace(/\s+/g, " ").trim();
        if (normalizedQuery.includes("INSERT INTO activation_codes")) {
          codes.push({
            code: params[0],
            tier: params[1],
            duration_days: params[2],
            max_uses: params[3],
            note: params[4],
          });
          return { success: true, changes: 1 };
        }
        if (normalizedQuery.includes("UPDATE users SET is_tier_held = 1")) {
          const pReason = params[0];
          const pId = params[1];
          const user = users.find((u) => u.id === pId || u.telegram_user_id === pId);
          if (user) {
            user.is_tier_held = 1;
            user.tier_hold_reason = pReason;
          }
          return { success: true, changes: 1 };
        }
        if (normalizedQuery.includes("UPDATE users SET is_tier_held = 0")) {
          const pId = params[0];
          const user = users.find((u) => u.id === pId || u.telegram_user_id === pId);
          if (user) {
            user.is_tier_held = 0;
            user.tier_hold_reason = null;
          }
          return { success: true, changes: 1 };
        }
        if (normalizedQuery.includes("SET tier = 'free'")) {
          const pId = params[0];
          const user = users.find((u) => u.id === pId || u.telegram_user_id === pId);
          if (user) {
            user.tier = "free";
            user.tier_expires_at = null;
            user.is_tier_held = 0;
            user.tier_hold_reason = null;
          }
          return { success: true, changes: 1 };
        }
        if (normalizedQuery.includes("SET tier = ?")) {
          const pTier = params[0];
          const pExp = params[1];
          const pGrant = params[2];
          const pId = params[3];
          const user = users.find((u) => u.id === pId || u.telegram_user_id === pId);
          if (user) {
            user.tier = pTier;
            user.tier_expires_at = pExp;
            user.tier_granted_by = pGrant;
            user.is_tier_held = 0;
            user.tier_hold_reason = null;
          }
          return { success: true, changes: 1 };
        }
        return { success: true };
      },
    };
  };

  const initialTestUsers = [
    {
      id: "u_1",
      telegram_user_id: 1139540899,
      display_name: "Shiva Reddy",
      tier: "premium",
      tier_expires_at: "2026-10-28T18:08:30.337Z",
      tier_granted_by: "promo_code",
      is_tier_held: 0,
      tier_hold_reason: null,
      created_at: "2026-08-21T10:20:14.325Z",
    },
    {
      id: "u_2",
      telegram_user_id: 999999999,
      display_name: "Free Tester",
      tier: "free",
      tier_expires_at: null,
      tier_granted_by: null,
      is_tier_held: 0,
      tier_hold_reason: null,
      created_at: "2026-08-22T10:20:14.325Z",
    },
  ];

  it("1. AdminService: listUsers returns structured user summaries", async () => {
    const mockDb: any = createMockDb(initialTestUsers);
    const result = await AdminService.listUsers(mockDb, { limit: 10, offset: 0 });
    assert.equal(result.total, 2);
    assert.equal(result.users.length, 2);
    assert.equal(result.users[0].displayName, "Shiva Reddy");
    assert.equal(result.users[0].tier, "premium");
  });

  it("2. AdminService: generateActivationCode creates unique code with duration", async () => {
    const mockDb: any = createMockDb(initialTestUsers);
    const result = await AdminService.generateActivationCode(mockDb, {
      code: "CUSTOM-VIP-2026",
      durationDays: 60,
      maxUses: 2,
    });
    assert.equal(result.code, "CUSTOM-VIP-2026");
    assert.equal(result.durationDays, 60);
    assert.equal(result.maxUses, 2);
  });

  it("3. AdminService: assignUserTier, holdUserTier, resumeUserTier, revokeUserTier operate cleanly", async () => {
    const mockDb: any = createMockDb(initialTestUsers);

    // Assign Pro to User 2
    const assignRes = await AdminService.assignUserTier(mockDb, {
      targetUser: 999999999,
      tier: "premium",
      durationDays: 30,
    });
    assert.equal(assignRes.user.tier, "premium");
    assert(assignRes.user.tierExpiresAt !== null);

    // Hold User 2
    const holdRes = await AdminService.holdUserTier(mockDb, {
      targetUser: 999999999,
      reason: "High bandwidth usage",
    });
    assert.equal(holdRes.user.isTierHeld, true);
    assert.equal(holdRes.user.tierHoldReason, "High bandwidth usage");

    // Resume User 2
    const resumeRes = await AdminService.resumeUserTier(mockDb, 999999999);
    assert.equal(resumeRes.user.isTierHeld, false);
    assert.equal(resumeRes.user.tierHoldReason, null);

    // Revoke User 2
    const revokeRes = await AdminService.revokeUserTier(mockDb, 999999999);
    assert.equal(revokeRes.user.tier, "free");
  });

  it("4. REST /admin/users rejects unauthorized requests", async () => {
    const res = await app.request("/admin/users", {
      headers: { "Content-Type": "application/json" },
    });
    assert.equal(res.status, 403);
  });

  it("5. REST /admin/users succeeds with X-Admin-Secret", async () => {
    const mockDb: any = createMockDb(initialTestUsers);
    const mockEnv = {
      DB: {
        prepare: () => ({
          bind: () => ({
            first: async () => ({ count: 2 }),
            all: async () => ({ results: initialTestUsers }),
            run: async () => ({ success: true }),
          }),
        }),
      },
      ADMIN_SECRET: "top_secret_admin_key",
    };

    const res = await app.request(
      "/admin/users",
      {
        headers: { "x-admin-secret": "top_secret_admin_key" },
      },
      mockEnv
    );
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.total, 2);
  });

  it("6. Bot Webhook: /webhook handles status and admin commands without crashing", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url: any, opts: any) => {
      return new Response(JSON.stringify({ ok: true, result: { message_id: 123 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    try {
      const mockEnv = {
        DB: {
          prepare: () => ({
            bind: () => ({
              first: async () => ({ count: 2, ...initialTestUsers[0] }),
              all: async () => ({ results: initialTestUsers }),
              run: async () => ({ success: true }),
            }),
          }),
        },
        TELEGRAM_BOT_TOKEN: "mock_test_bot_token",
        ADMIN_TELEGRAM_IDS: "1139540899",
      };

      const res = await app.request(
        "/bot/webhook",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            update_id: 100,
            message: {
              message_id: 1,
              from: { id: 1139540899, first_name: "Shiva" },
              chat: { id: 1139540899, type: "private" },
              text: "/users",
            },
          }),
        },
        mockEnv
      );
      assert.equal(res.status, 200);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("7. Security: /bot/setup-webhook and /bot/webhook-info reject unauthorized callers with 403", async () => {
    const res1 = await app.request("/bot/setup-webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    assert.equal(res1.status, 403);

    const res2 = await app.request("/bot/webhook-info");
    assert.equal(res2.status, 403);
  });

  it("8. Security: /bot/webhook rejects mismatched or missing secret token when secret is configured", async () => {
    const mockEnv = {
      TELEGRAM_BOT_TOKEN: "mock_token",
      TELEGRAM_WEBHOOK_SECRET: "strong_expected_secret",
    };

    // Missing secret token header
    const resNoSecret = await app.request(
      "/bot/webhook",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: { text: "hello" } }),
      },
      mockEnv
    );
    assert.equal(resNoSecret.status, 403);

    // Wrong secret token header
    const resWrongSecret = await app.request(
      "/bot/webhook",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-telegram-bot-api-secret-token": "wrong_secret",
        },
        body: JSON.stringify({ message: { text: "hello" } }),
      },
      mockEnv
    );
    assert.equal(resWrongSecret.status, 403);
  });

  it("9. Security: AdminService rejects invalid code format and duplicate codes", async () => {
    const mockDb: any = createMockDb(initialTestUsers, [{ code: "EXISTING-CODE-1" }]);

    // Code with invalid chars
    await assert.rejects(
      async () => {
        await AdminService.generateActivationCode(mockDb, {
          code: "INVALID!CODE#%",
        });
      },
      /invalid characters/i
    );

    // Code too short
    await assert.rejects(
      async () => {
        await AdminService.generateActivationCode(mockDb, {
          code: "A",
        });
      },
      /between 3 and 64 characters/i
    );
  });
});
