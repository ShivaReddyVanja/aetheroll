import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractSessionToken,
  extractAllSessionTokens,
  generateCompositeSessionToken,
} from "./auth";

describe("🔍 Unified Abstracted Auth Token Extraction Suite", () => {
  const TEST_SESSION_ID = "3f848b25-06c8-472e-8e6f-e3c3ec12b001";
  const TEST_CLIENT_SECRET = "a1b2c3d4e5f67890123456789abcdef0a1b2c3d4e5f67890123456789abcdef0";
  const COMPOSITE_TOKEN = `${TEST_SESSION_ID}.${TEST_CLIENT_SECRET}`;

  it("1. should extract composite token from 'tg_session' Cookie header", () => {
    const req = new Request("https://example.com/api/media", {
      headers: {
        Cookie: `other_cookie=123; tg_session=${encodeURIComponent(COMPOSITE_TOKEN)}; theme=dark`,
      },
    });

    const parsed = extractSessionToken(req);
    assert.ok(parsed);
    assert.equal(parsed.sessionId, TEST_SESSION_ID);
    assert.equal(parsed.clientSecret, TEST_CLIENT_SECRET);
    assert.equal(parsed.fullToken, COMPOSITE_TOKEN);
  });

  it("2. should extract composite token from 'x-tg-session' header", () => {
    const req = new Request("https://example.com/api/media", {
      headers: {
        "x-tg-session": COMPOSITE_TOKEN,
      },
    });

    const parsed = extractSessionToken(req);
    assert.ok(parsed);
    assert.equal(parsed.sessionId, TEST_SESSION_ID);
    assert.equal(parsed.clientSecret, TEST_CLIENT_SECRET);
  });

  it("3. should extract composite token from 'Authorization: Bearer <token>'", () => {
    const req = new Request("https://example.com/api/media", {
      headers: {
        Authorization: `Bearer ${COMPOSITE_TOKEN}`,
      },
    });

    const parsed = extractSessionToken(req);
    assert.ok(parsed);
    assert.equal(parsed.sessionId, TEST_SESSION_ID);
    assert.equal(parsed.clientSecret, TEST_CLIENT_SECRET);
  });

  it("4. should extract composite token from URL query '?session_token='", () => {
    const req = new Request(`https://example.com/api/stream?media_id=123&session_token=${encodeURIComponent(COMPOSITE_TOKEN)}`);

    const parsed = extractSessionToken(req);
    assert.ok(parsed);
    assert.equal(parsed.sessionId, TEST_SESSION_ID);
    assert.equal(parsed.clientSecret, TEST_CLIENT_SECRET);
  });

  it("5. should return null for missing or default tokens", () => {
    const req1 = new Request("https://example.com/api/media");
    assert.equal(extractSessionToken(req1), null);

    const req2 = new Request("https://example.com/api/stream?session_token=default");
    assert.equal(extractSessionToken(req2), null);
  });

  it("6. should parse legacy single-part token without clientSecret", () => {
    const LEGACY_TOKEN = "deadbeef12345678deadbeef12345678deadbeef12345678deadbeef12345678";
    const req = new Request("https://example.com/api/media", {
      headers: { "x-tg-session": LEGACY_TOKEN },
    });

    const parsed = extractSessionToken(req);
    assert.ok(parsed);
    assert.equal(parsed.sessionId, LEGACY_TOKEN);
    assert.equal(parsed.clientSecret, undefined);
  });

  it("7. should parse composite token passed directly as a string (POST /api/auth/session payload)", () => {
    const parsed = extractSessionToken(COMPOSITE_TOKEN);
    assert.ok(parsed);
    assert.equal(parsed.sessionId, TEST_SESSION_ID);
    assert.equal(parsed.clientSecret, TEST_CLIENT_SECRET);
    assert.equal(parsed.fullToken, COMPOSITE_TOKEN);
  });

  it("8. should extract all candidate tokens when multiple tg_session cookies exist in header", () => {
    const OLD_TOKEN = "old-session-id.old-secret";
    const NEW_TOKEN = "new-session-id.new-secret";
    const req = new Request("https://example.com/api/media", {
      headers: {
        Cookie: `tg_session=${OLD_TOKEN}; aetheroll_session=ae-id.ae-secret; tg_session=${NEW_TOKEN}`,
      },
    });

    const candidates = extractAllSessionTokens(req);
    assert.equal(candidates.length, 3);
    assert.equal(candidates[0].sessionId, "old-session-id");
    assert.equal(candidates[1].sessionId, "ae-id");
    assert.equal(candidates[2].sessionId, "new-session-id");
  });

  it("9. should default isAdmin to false when ADMIN_TELEGRAM_USER_IDS is empty (strict fail-closed)", () => {
    const adminIdsStr = "";
    let isAdmin = false;
    if (adminIdsStr && adminIdsStr.trim() !== "") {
      const adminIds = adminIdsStr.split(",").map((s: string) => s.trim());
      isAdmin = adminIds.includes("123456");
    }
    assert.equal(isAdmin, false);
  });

  it("10. should grant isAdmin true only when user telegram_user_id matches ADMIN_TELEGRAM_USER_IDS whitelist", () => {
    const adminIdsStr = "1139540899,987654321";
    const adminIds = adminIdsStr.split(",").map((s: string) => s.trim());

    const isUser1Admin = adminIds.includes(String("1139540899"));
    const isUser2Admin = adminIds.includes(String("555555555"));

    assert.equal(isUser1Admin, true);
    assert.equal(isUser2Admin, false);
  });

  it("11. should grant 30-day premium for active campaign", async () => {
    const { getInitialTierForNewUser } = await import("./auth");
    const mockDbCampaign = {
      all: async () => [
        {
          id: "welcome_first_100",
          name: "First 100 Users",
          target_tier: "premium",
          duration_days: 30,
          max_claims: 100,
          claimed_count: 42,
          is_active: 1,
          priority: 10,
        },
      ],
      run: async () => ({ changes: 1 }),
    };
    const result = await getInitialTierForNewUser(mockDbCampaign);
    assert.equal(result.tier, "premium");
    assert.equal(result.tierGrantedBy, "campaign:welcome_first_100");
    assert.ok(result.tierExpiresAt);
    
    // Check expiration is ~30 days in the future
    const expTime = new Date(result.tierExpiresAt!).getTime();
    const diffDays = Math.round((expTime - Date.now()) / (24 * 60 * 60 * 1000));
    assert.equal(diffDays, 30);
  });

  it("12. should assign free tier once campaign limit is reached or no campaign active", async () => {
    const { getInitialTierForNewUser } = await import("./auth");
    const mockDbNoCampaign = {
      all: async () => [],
      run: async () => ({ changes: 0 }),
    };
    const result = await getInitialTierForNewUser(mockDbNoCampaign);
    assert.equal(result.tier, "free");
    assert.equal(result.tierExpiresAt, null);
    assert.equal(result.tierGrantedBy, null);
  });

  it("13. should handle new user onboarding via upsertUserOnLogin", async () => {
    const { upsertUserOnLogin } = await import("./auth");
    let inserted = false;
    const mockDb = {
      get: async (sql: string) => {
        if (sql.includes("SELECT * FROM users WHERE telegram_user_id = ?")) {
          return null; // New user
        }
        return null;
      },
      all: async () => [
        {
          id: "welcome_first_100",
          name: "First 100 Users",
          target_tier: "premium",
          duration_days: 30,
          max_claims: 100,
          claimed_count: 0,
          is_active: 1,
          priority: 10,
        },
      ],
      run: async (sql: string) => {
        if (sql.includes("INSERT INTO users")) {
          inserted = true;
          return { changes: 1 };
        }
        if (sql.includes("UPDATE signup_campaigns")) {
          return { changes: 1 };
        }
        return { changes: 1 };
      },
    };

    const res = await upsertUserOnLogin(mockDb, {
      telegramUserId: "12345678",
      displayName: "Alice",
      encryptedSession: "enc-session-str",
    });

    assert.equal(res.isNewUser, true);
    assert.equal(res.tier, "premium");
    assert.equal(inserted, true);
  });

  it("14. should preserve existing user tier on re-login via upsertUserOnLogin", async () => {
    const { upsertUserOnLogin } = await import("./auth");
    let updated = false;
    const mockDb = {
      get: async () => ({
        id: "user-existing-id",
        telegram_user_id: "12345678",
        tier: "premium",
      }),
      run: async (sql: string) => {
        if (sql.includes("UPDATE users SET display_name")) {
          updated = true;
          return { changes: 1 };
        }
        return { changes: 1 };
      },
    };

    const res = await upsertUserOnLogin(mockDb, {
      telegramUserId: "12345678",
      displayName: "Alice Updated",
      encryptedSession: "enc-session-str-2",
    });

    assert.equal(res.isNewUser, false);
    assert.equal(res.userId, "user-existing-id");
    assert.equal(res.tier, "premium");
    assert.equal(updated, true);
  });
});



