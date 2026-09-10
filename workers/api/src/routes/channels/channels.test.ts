import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { channelsRouter } from "./index";
import { generateCompositeSessionToken } from "../../lib/auth";
import { isTelegramAuthError, handleTelegramAuthFailure } from "../../lib/telegram";

function createMockD1(channels: any[] = []) {
  return {
    prepare: (sql: string) => ({
      bind: (...params: any[]) => ({
        first: async () => channels[0] || null,
        all: async () => ({ results: channels }),
        run: async () => ({ meta: { changes: 1 } }),
      }),
    }),
    exec: async () => {},
  };
}

describe("⚡ Channels Routes Suite", () => {
  it("1. GET / should return 401 when unauthenticated", async () => {
    const res = await channelsRouter.request("http://localhost/");
    assert.equal(res.status, 401);
  });

  it("2. POST /add should return 401 when unauthenticated", async () => {
    const res = await channelsRouter.request("http://localhost/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ telegram_channel_id: "123" }),
    });
    assert.equal(res.status, 401);
  });

  it("3. POST /remove should return 401 when unauthenticated", async () => {
    const res = await channelsRouter.request("http://localhost/remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel_id: "c1" }),
    });
    assert.equal(res.status, 401);
  });

  it("4. POST /:id/sync should return 401 when unauthenticated", async () => {
    const res = await channelsRouter.request("http://localhost/c1/sync", {
      method: "POST",
    });
    assert.equal(res.status, 401);
  });

  describe("🛡️ Telegram Auth Revocation & Error Identification", () => {
    it("5. isTelegramAuthError should detect AUTH_KEY_UNREGISTERED", () => {
      assert.equal(isTelegramAuthError({ errorMessage: "401: AUTH_KEY_UNREGISTERED" }), true);
      assert.equal(isTelegramAuthError({ message: "AUTH_KEY_UNREGISTERED" }), true);
      assert.equal(isTelegramAuthError({ errorMessage: "SESSION_REVOKED" }), true);
      assert.equal(isTelegramAuthError({ errorMessage: "SESSION_EXPIRED" }), true);
      assert.equal(isTelegramAuthError({ errorMessage: "USER_DEACTIVATED" }), true);
      assert.equal(isTelegramAuthError({ code: 401 }), true);
    });

    it("6. isTelegramAuthError should reject non-auth errors", () => {
      assert.equal(isTelegramAuthError({ errorMessage: "FLOOD_WAIT_60" }), false);
      assert.equal(isTelegramAuthError({ errorMessage: "CHANNEL_PRIVATE" }), false);
      assert.equal(isTelegramAuthError({ message: "Network connection timeout" }), false);
      assert.equal(isTelegramAuthError(null), false);
    });

    it("7. handleTelegramAuthFailure should execute session deletion in DB", async () => {
      let deletedUserId = "";
      let sqlExecuted = "";
      const mockDb = {
        run: async (sql: string, params: any[]) => {
          sqlExecuted = sql;
          deletedUserId = params[0];
          return { meta: { changes: 1 } };
        },
      };

      await handleTelegramAuthFailure(mockDb, "user-123");
      assert.ok(sqlExecuted.includes("DELETE FROM user_sessions WHERE user_id = ?"));
      assert.equal(deletedUserId, "user-123");
    });
  });
});
