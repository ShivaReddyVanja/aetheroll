import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ClientSessionManager } from "./clientSessionManager.ts";
import { generateCompositeSessionToken } from "../../lib/auth.ts";

function createMockD1(result: any = null) {
  return {
    prepare: (sql: string) => ({
      bind: (...params: any[]) => ({
        first: async () => result,
        all: async () => ({ results: result ? [result] : [] }),
        run: async () => ({ meta: { changes: 1 } }),
      }),
    }),
    exec: async () => {},
  };
}

describe("⚡ DO ClientSessionManager Suite", () => {
  const MASTER_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  it("1. should reject requests with missing session token", async () => {
    const manager = new ClientSessionManager();
    const req = new Request("https://example.com/api/media");
    const result = await manager.getOrConnectUserClient(req, {});

    assert.equal(result.client, null);
    assert.match(result.error || "", /Missing session token/i);
  });

  it("2. should reject when session is not in DB or expired", async () => {
    const manager = new ClientSessionManager();
    const { sessionToken } = generateCompositeSessionToken();
    const req = new Request("https://example.com/api/media", {
      headers: { "x-tg-session": sessionToken },
    });

    const mockDb = createMockD1(null); // not found

    const result = await manager.getOrConnectUserClient(req, { DB: mockDb });
    assert.equal(result.client, null);
    assert.match(result.error || "", /Session not found or expired/i);
  });

  it("3. should reject when dual-key session decryption fails", async () => {
    const manager = new ClientSessionManager();
    const { sessionId, sessionToken } = generateCompositeSessionToken();
    const req = new Request("https://example.com/api/media", {
      headers: { "x-tg-session": sessionToken },
    });

    const mockDb = createMockD1({
      user_id: "u123",
      telegram_user_id: "tg123",
      display_name: "Test User",
      session_string: "corrupted_or_invalid_session_string",
      expires_at: new Date(Date.now() + 100000).toISOString(),
    });

    const result = await manager.getOrConnectUserClient(req, {
      DB: mockDb,
      SESSION_ENCRYPTION_KEY: MASTER_KEY,
    });
    assert.equal(result.client, null);
    assert.match(result.error || "", /Session decryption failed/i);
  });

  it("4. should reuse warm connected client on subsequent requests", async () => {
    const manager = new ClientSessionManager();
    const { sessionId, clientSecret, sessionToken } = generateCompositeSessionToken();

    const mockClient = {
      connected: true,
      __userId: "user_abc",
      disconnect: () => {},
    };

    manager.userClients.set(sessionToken, {
      client: mockClient,
      lastUsed: Date.now() - 5000,
    });

    const req = new Request("https://example.com/api/media", {
      headers: { "x-tg-session": sessionToken },
    });

    const result = await manager.getOrConnectUserClient(req, {});
    assert.equal(result.client, mockClient);
    assert.equal(result.userId, "user_abc");
    assert.equal(result.sessionId, sessionId);
  });

  it("5. sweepIdleClients should disconnect and remove sessions idle for > 15 minutes", () => {
    const manager = new ClientSessionManager();
    let disconnected = false;

    const idleClient = {
      connected: true,
      disconnect: () => {
        disconnected = true;
      },
    };

    const activeClient = {
      connected: true,
      disconnect: () => {},
    };

    const now = Date.now();
    manager.userClients.set("idle_token", {
      client: idleClient,
      lastUsed: now - 16 * 60 * 1000, // 16 mins ago
    });
    manager.userClients.set("active_token", {
      client: activeClient,
      lastUsed: now - 5 * 60 * 1000, // 5 mins ago
    });

    manager.sweepIdleClients();

    assert.equal(disconnected, true, "Idle client disconnect must be called");
    assert.equal(manager.userClients.has("idle_token"), false, "Idle token must be deleted from map");
    assert.equal(manager.userClients.has("active_token"), true, "Active token must be preserved");
  });
});
