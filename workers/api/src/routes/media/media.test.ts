import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { mediaRouter } from "./index";
import { encryptSession } from "../../lib/crypto";

function createMockD1(items: any[] = []) {
  return {
    prepare: (sql: string) => ({
      bind: (...params: any[]) => ({
        first: async () => items[0] || null,
        all: async () => ({ results: items }),
        run: async () => ({ meta: { changes: 1 } }),
      }),
    }),
    exec: async () => {},
  };
}

describe("⚡ Media Routes Suite", () => {
  const serverKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const clientSecret = "client_secret_abc";
  let encryptedSessionStr = "";

  before(async () => {
    encryptedSessionStr = await encryptSession("12345678:valid_string", serverKey, clientSecret);
  });

  it("1. GET / should return 401 when unauthenticated", async () => {
    const res = await mediaRouter.request("http://localhost/?channel_id=chan_1");
    assert.equal(res.status, 401);
  });

  it("2. POST /upload/init should reject when unauthenticated and forward when authorized as Pro", async () => {
    const unauthedRes = await mediaRouter.request("http://localhost/upload/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel_id: "c1", file_name: "test.jpg", file_size: 1000, total_chunks: 1 }),
    });
    assert.equal(unauthedRes.status, 401);

    let forwarded = false;
    const mockAuthDO = {
      idFromName: () => "mock-id",
      get: () => ({
        fetch: async () => {
          forwarded = true;
          return new Response(JSON.stringify({ success: true, upload_id: "up_123" }), {
            headers: { "Content-Type": "application/json" },
          });
        },
      }),
    };

    const mockDb = {
      prepare: (sql: string) => ({
        bind: (...params: any[]) => ({
          first: async () => ({
            user_id: "u1",
            telegram_user_id: 12345,
            display_name: "Pro User",
            session_string: encryptedSessionStr,
            tier: "premium",
            is_tier_held: 0,
            tier_expires_at: null,
          }),
          all: async () => ({ results: [] }),
          run: async () => ({ success: true }),
        }),
      }),
    };

    const res = await mediaRouter.request(
      "http://localhost/upload/init",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-tg-session": `session_123.${clientSecret}` },
        body: JSON.stringify({ channel_id: "c1", file_name: "test.jpg", file_size: 1000, total_chunks: 1 }),
      },
      {
        AUTH_DO: mockAuthDO,
        DB: mockDb,
        SESSION_ENCRYPTION_KEY: serverKey,
        TELEGRAM_API_ID: "12345",
        TELEGRAM_API_HASH: "mock_hash",
      }
    );

    assert.equal(res.status, 200);
    assert.equal(forwarded, true);
  });

  it("3. POST /:id/favorite should return 401 when unauthenticated", async () => {
    const res = await mediaRouter.request("http://localhost/item_1/favorite", {
      method: "POST",
    });
    assert.equal(res.status, 401);
  });

  it("4. POST /delete should return 401 when unauthenticated", async () => {
    const res = await mediaRouter.request("http://localhost/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ media_ids: ["item_1"] }),
    });
    assert.equal(res.status, 401);
  });

  it("5. GET /:id/thumbnail should return SVG placeholder when item not found", async () => {
    const mockDb = createMockD1([]);

    const res = await mediaRouter.request(
      "http://localhost/non_existent_item/thumbnail",
      {},
      { DB: mockDb }
    );

    assert.equal(res.status, 404);
  });
});
