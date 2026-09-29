import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { tierRouter } from "./index";
import { encryptSession } from "../../lib/crypto";

describe("⚡ User Tiers & Activation System Suite", () => {
  const app = new Hono();
  app.route("/tier", tierRouter);

  const serverKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const clientSecret = "client_secret_abc";
  let encryptedSessionStr = "";

  before(async () => {
    encryptedSessionStr = await encryptSession("12345678:valid_string", serverKey, clientSecret);
  });

  it("1. GET /tier/status should return 401 when unauthenticated", async () => {
    const res = await app.request("/tier/status");
    assert.equal(res.status, 401);
  });

  it("2. POST /tier/redeem should return 401 when unauthenticated", async () => {
    const res = await app.request("/tier/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "PRO-TEST-100" }),
    });
    assert.equal(res.status, 401);
  });

  it("3. POST /tier/redeem should reject empty code with 400", async () => {
    const mockEnv = {
      DB: {
        prepare: () => ({
          bind: () => ({
            first: async () => ({
              user_id: "user_123",
              telegram_user_id: 12345,
              display_name: "Test User",
              session_string: encryptedSessionStr,
              tier: "free",
            }),
            all: async () => ({ results: [] }),
            run: async () => ({ success: true }),
          }),
        }),
      },
      SESSION_ENCRYPTION_KEY: serverKey,
      TELEGRAM_API_ID: "12345",
      TELEGRAM_API_HASH: "mock_hash",
    };

    const res = await app.request(
      "/tier/redeem",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-tg-session": `session_123.${clientSecret}`,
        },
        body: JSON.stringify({ code: "" }),
      },
      mockEnv
    );

    assert.equal(res.status, 400);
  });

  it("4. POST /tier/redeem should reject invalid or expired code", async () => {
    const mockEnv = {
      DB: {
        prepare: (sql: string) => ({
          bind: (...params: any[]) => ({
            first: async () => {
              // user lookup
              if (sql.includes("user_sessions")) {
                return {
                  user_id: "user_123",
                  telegram_user_id: 12345,
                  display_name: "Test User",
                  session_string: encryptedSessionStr,
                  tier: "free",
                };
              }
              // activation code lookup: not found
              return null;
            },
            all: async () => ({ results: [] }),
            run: async () => ({ success: true }),
          }),
        }),
      },
      SESSION_ENCRYPTION_KEY: serverKey,
      TELEGRAM_API_ID: "12345",
      TELEGRAM_API_HASH: "mock_hash",
    };

    const res = await app.request(
      "/tier/redeem",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-tg-session": `session_123.${clientSecret}`,
        },
        body: JSON.stringify({ code: "INVALID-CODE" }),
      },
      mockEnv
    );

    assert.equal(res.status, 400);
    const data = (await res.json()) as any;
    assert.match(data.error, /invalid or expired/i);
  });

  it("5. POST /tier/redeem should successfully activate valid code", async () => {
    let userUpdated = false;
    let codeUpdated = false;

    const mockEnv = {
      DB: {
        prepare: (sql: string) => ({
          bind: (...params: any[]) => ({
            first: async () => {
              if (sql.includes("user_sessions")) {
                return {
                  user_id: "user_123",
                  telegram_user_id: 12345,
                  display_name: "Test User",
                  session_string: encryptedSessionStr,
                  tier: "free",
                };
              }
              if (sql.includes("activation_codes")) {
                return {
                  code: "PRO-VALID-2026",
                  tier: "premium",
                  duration_days: 30,
                  max_uses: 1,
                  times_used: 0,
                  is_active: 1,
                };
              }
              if (sql.includes("code_redemptions")) {
                return null; // not previously redeemed
              }
              return null;
            },
            all: async () => ({ results: [] }),
            run: async () => {
              if (sql.includes("UPDATE users")) userUpdated = true;
              if (sql.includes("UPDATE activation_codes")) codeUpdated = true;
              return { success: true };
            },
          }),
        }),
      },
      SESSION_ENCRYPTION_KEY: serverKey,
      TELEGRAM_API_ID: "12345",
      TELEGRAM_API_HASH: "mock_hash",
    };

    const res = await app.request(
      "/tier/redeem",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-tg-session": `session_123.${clientSecret}`,
        },
        body: JSON.stringify({ code: "PRO-VALID-2026" }),
      },
      mockEnv
    );

    assert.equal(res.status, 200);
    const data = (await res.json()) as any;
    assert.equal(data.success, true);
    assert.equal(data.tier, "premium");
    assert.ok(data.tierExpiresAt, "Expiration timestamp must be present");
    assert.equal(userUpdated, true);
    assert.equal(codeUpdated, true);
  });

  it("6. GET /tier/status should return entitlement for authenticated user", async () => {
    const mockEnv = {
      DB: {
        prepare: () => ({
          bind: () => ({
            first: async () => ({
              user_id: "user_123",
              telegram_user_id: 12345,
              display_name: "Test User",
              session_string: encryptedSessionStr,
              tier: "premium",
              tier_expires_at: "2027-01-01T00:00:00Z",
            }),
            all: async () => ({ results: [] }),
            run: async () => ({ success: true }),
          }),
        }),
      },
      SESSION_ENCRYPTION_KEY: serverKey,
      TELEGRAM_API_ID: "12345",
      TELEGRAM_API_HASH: "mock_hash",
    };

    const res = await app.request(
      "/tier/status",
      {
        headers: { "x-tg-session": `session_123.${clientSecret}` },
      },
      mockEnv
    );

    assert.equal(res.status, 200);
    const data = (await res.json()) as any;
    assert.equal(data.authenticated, true);
    assert.equal(data.tier, "premium");
    assert.equal(data.isPro, true);
  });

  it("7. POST /tier/redeem should reject with 403 if user is currently on hold", async () => {
    const mockEnv = {
      DB: {
        prepare: () => ({
          bind: () => ({
            first: async () => ({
              user_id: "user_123",
              telegram_user_id: 12345,
              display_name: "Test User",
              session_string: encryptedSessionStr,
              tier: "premium",
              is_tier_held: 1,
              tier_hold_reason: "Abuse investigation",
            }),
            all: async () => ({ results: [] }),
            run: async () => ({ success: true }),
          }),
        }),
      },
      SESSION_ENCRYPTION_KEY: serverKey,
      TELEGRAM_API_ID: "12345",
      TELEGRAM_API_HASH: "mock_hash",
    };

    const res = await app.request(
      "/tier/redeem",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-tg-session": `session_123.${clientSecret}`,
        },
        body: JSON.stringify({ code: "PRO-VALID-2026" }),
      },
      mockEnv
    );

    assert.equal(res.status, 403);
    const data = (await res.json()) as any;
    assert.match(data.error, /on hold/i);
  });

  it("8. GET /tier/status should return isTierHeld: true and isPro: false when tier is held", async () => {
    const mockEnv = {
      DB: {
        prepare: () => ({
          bind: () => ({
            first: async () => ({
              user_id: "user_123",
              telegram_user_id: 12345,
              display_name: "Test User",
              session_string: encryptedSessionStr,
              tier: "premium",
              is_tier_held: 1,
              tier_hold_reason: "Bandwidth quota exceeded",
            }),
            all: async () => ({ results: [] }),
            run: async () => ({ success: true }),
          }),
        }),
      },
      SESSION_ENCRYPTION_KEY: serverKey,
      TELEGRAM_API_ID: "12345",
      TELEGRAM_API_HASH: "mock_hash",
    };

    const res = await app.request(
      "/tier/status",
      {
        headers: { "x-tg-session": `session_123.${clientSecret}` },
      },
      mockEnv
    );

    assert.equal(res.status, 200);
    const data = (await res.json()) as any;
    assert.equal(data.authenticated, true);
    assert.equal(data.isTierHeld, true);
    assert.equal(data.tierHoldReason, "Bandwidth quota exceeded");
    assert.equal(data.isPro, false);
  });
});
