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
  const createMockDb = (
    initialUsers: any[] = [],
    initialCodes: any[] = [],
    initialCampaigns: any[] = []
  ) => {
    const users = initialUsers;
    const codes = initialCodes;
    const campaigns = initialCampaigns;

    return {
      get: async (query: string, params: any[] = []) => {
        const normalized = query.replace(/\s+/g, " ").trim();
        if (normalized.includes("COUNT(*) as count FROM users")) {
          return { count: users.length };
        }
        if (normalized.includes("SELECT id, telegram_user_id") || normalized.includes("FROM users WHERE")) {
          const p = params[0];
          return users.find((u) => u.id === p || u.telegram_user_id === p) || null;
        }
        if (normalized.includes("COUNT(*) as count FROM media_items")) {
          return { count: 42 };
        }
        if (normalized.includes("SELECT tier FROM users WHERE telegram_user_id")) {
          const p = params[0];
          const found = users.find((u) => u.telegram_user_id === p);
          return found ? { tier: found.tier } : null;
        }
        if (normalized.includes("FROM signup_campaigns WHERE id = ?")) {
          const id = params[0];
          return campaigns.find((c) => c.id === id) || null;
        }
        return null;
      },
      all: async (query: string, params: any[] = []) => {
        const normalized = query.replace(/\s+/g, " ").trim();
        if (normalized.includes("FROM users")) {
          return users;
        }
        if (normalized.includes("FROM signup_campaigns")) {
          return campaigns;
        }
        return [];
      },
      run: async (query: string, params: any[] = []) => {
        const normalizedQuery = query.replace(/\s+/g, " ").trim();
        if (normalizedQuery.includes("INSERT INTO signup_campaigns")) {
          const [id, name, target_tier, duration_days, max_claims, is_active, priority, starts_at, ends_at] = params;
          campaigns.push({
            id,
            name,
            target_tier,
            duration_days,
            max_claims,
            claimed_count: 0,
            is_active: is_active ?? 1,
            priority: priority ?? 0,
            starts_at: starts_at || null,
            ends_at: ends_at || null,
            created_at: new Date().toISOString(),
          });
          return { success: true, changes: 1 };
        }
        if (normalizedQuery.includes("UPDATE signup_campaigns SET")) {
          const id = params[params.length - 1];
          const c = campaigns.find((item) => item.id === id);
          if (c) {
            if (normalizedQuery.includes("is_active = ?")) {
              c.is_active = params[0];
            }
            if (normalizedQuery.includes("max_claims = ?")) {
              c.max_claims = params[0];
            }
            if (normalizedQuery.includes("name = ?")) {
              c.name = params[0];
            }
            return { success: true, changes: 1 };
          }
          return { success: true, changes: 0 };
        }
        if (normalizedQuery.includes("DELETE FROM signup_campaigns WHERE id = ?")) {
          const id = params[0];
          const idx = campaigns.findIndex((item) => item.id === id);
          if (idx !== -1) {
            campaigns.splice(idx, 1);
            return { success: true, changes: 1 };
          }
          return { success: true, changes: 0 };
        }
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
    const data: any = await res.json();
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
        TELEGRAM_TEST_MODE: "true",
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

  it("10. Bot Webhook: /create_campaign, /campaigns, /campaign, /pause_campaign, /resume_campaign, /extend_campaign, /delete_campaign flow cleanly", async () => {
    const sentMessages: Array<{ chatId: any; text: string }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url: any, opts: any) => {
      if (url.includes("/sendMessage")) {
        const body = JSON.parse(opts.body);
        sentMessages.push({ chatId: body.chat_id, text: body.text });
      }
      return new Response(JSON.stringify({ ok: true, result: { message_id: 123 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    try {
      const mockCampaigns: any[] = [];
      const mockDb: any = createMockDb(initialTestUsers, [], mockCampaigns);
      const mockEnv = {
        DB: {
          prepare: (query: string) => ({
            bind: (...params: any[]) => ({
              first: async () => mockDb.get(query, params),
              all: async () => ({ results: await mockDb.all(query, params) }),
              run: async () => mockDb.run(query, params),
            }),
          }),
        },
        TELEGRAM_BOT_TOKEN: "mock_test_bot_token",
        TELEGRAM_TEST_MODE: "true",
        ADMIN_TELEGRAM_IDS: "1139540899",
      };

      const sendBotCommand = async (text: string) => {
        return await app.request(
          "/bot/webhook",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              update_id: 200,
              message: {
                message_id: 2,
                from: { id: 1139540899, first_name: "Shiva" },
                chat: { id: 1139540899, type: "private" },
                text,
              },
            }),
          },
          mockEnv
        );
      };

      // 1. Create campaign via bot
      const resCreate = await sendBotCommand("/create_campaign 100 30 Early Adopter Reward");
      assert.equal(resCreate.status, 200);
      assert.equal(mockCampaigns.length, 1);
      assert.equal(mockCampaigns[0].name, "Early Adopter Reward");
      assert.equal(mockCampaigns[0].max_claims, 100);
      assert.equal(mockCampaigns[0].duration_days, 30);
      const createdId = mockCampaigns[0].id;
      assert.ok(sentMessages.some((m) => m.text.includes("Signup Campaign Created!")));

      // 2. List campaigns via /campaigns
      sentMessages.length = 0;
      const resList = await sendBotCommand("/campaigns");
      assert.equal(resList.status, 200);
      assert.ok(sentMessages.some((m) => m.text.includes("Early Adopter Reward") && m.text.includes("ACTIVE")));

      // 3. Inspect campaign via /campaign <id>
      sentMessages.length = 0;
      const resInspect = await sendBotCommand(`/campaign ${createdId}`);
      assert.equal(resInspect.status, 200);
      assert.ok(sentMessages.some((m) => m.text.includes("Campaign Inspection") && m.text.includes(createdId)));

      // 4. Pause campaign via /pause_campaign <id>
      sentMessages.length = 0;
      const resPause = await sendBotCommand(`/pause_campaign ${createdId}`);
      assert.equal(resPause.status, 200);
      assert.equal(mockCampaigns[0].is_active, 0);
      assert.ok(sentMessages.some((m) => m.text.includes("Campaign Paused")));

      // 5. Resume campaign via /resume_campaign <id>
      sentMessages.length = 0;
      const resResume = await sendBotCommand(`/resume_campaign ${createdId}`);
      assert.equal(resResume.status, 200);
      assert.equal(mockCampaigns[0].is_active, 1);
      assert.ok(sentMessages.some((m) => m.text.includes("Campaign Resumed")));

      // 6. Extend campaign quota via /extend_campaign <id> <new_max>
      sentMessages.length = 0;
      const resExtend = await sendBotCommand(`/extend_campaign ${createdId} 250`);
      assert.equal(resExtend.status, 200);
      assert.equal(mockCampaigns[0].max_claims, 250);
      assert.ok(sentMessages.some((m) => m.text.includes("Campaign Quota Updated") && m.text.includes("250")));

      // 7. Delete campaign via /delete_campaign <id>
      sentMessages.length = 0;
      const resDel = await sendBotCommand(`/delete_campaign ${createdId}`);
      assert.equal(resDel.status, 200);
      assert.equal(mockCampaigns.length, 0);
      assert.ok(sentMessages.some((m) => m.text.includes("Campaign Deleted")));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("11. Bot Webhook: /create_campaign handles lifetime duration (0) and default duration", async () => {
    const sentMessages: Array<{ chatId: any; text: string }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url: any, opts: any) => {
      if (url.includes("/sendMessage")) {
        const body = JSON.parse(opts.body);
        sentMessages.push({ chatId: body.chat_id, text: body.text });
      }
      return new Response(JSON.stringify({ ok: true, result: { message_id: 123 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    try {
      const mockCampaigns: any[] = [];
      const mockDb: any = createMockDb(initialTestUsers, [], mockCampaigns);
      const mockEnv = {
        DB: {
          prepare: (query: string) => ({
            bind: (...params: any[]) => ({
              first: async () => mockDb.get(query, params),
              all: async () => ({ results: await mockDb.all(query, params) }),
              run: async () => mockDb.run(query, params),
            }),
          }),
        },
        TELEGRAM_BOT_TOKEN: "mock_test_bot_token",
        TELEGRAM_TEST_MODE: "true",
        ADMIN_TELEGRAM_IDS: "1139540899",
      };

      const sendBotCommand = async (text: string) => {
        return await app.request(
          "/bot/webhook",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              update_id: 201,
              message: {
                message_id: 3,
                from: { id: 1139540899, first_name: "Shiva" },
                chat: { id: 1139540899, type: "private" },
                text,
              },
            }),
          },
          mockEnv
        );
      };

      // Create lifetime campaign
      await sendBotCommand("/create_campaign 50 0 Lifetime VIP Promo");
      assert.equal(mockCampaigns.length, 1);
      assert.equal(mockCampaigns[0].name, "Lifetime VIP Promo");
      assert.equal(mockCampaigns[0].duration_days, null);

      // Create default duration campaign
      await sendBotCommand("/create_campaign 200 Default Promo");
      assert.equal(mockCampaigns.length, 2);
      assert.equal(mockCampaigns[1].name, "Default Promo");
      assert.equal(mockCampaigns[1].duration_days, 30);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

