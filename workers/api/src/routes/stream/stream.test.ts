import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { streamRouter } from "./index";
import { encryptSession } from "../../lib/crypto";

describe("⚡ Stream Routes Suite", () => {
  const serverKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const clientSecret = "client_secret_abc";
  let encryptedSessionStr = "";

  before(async () => {
    encryptedSessionStr = await encryptSession("12345678:valid_string", serverKey, clientSecret);
  });

  it("1. GET / should return 400 when media_id is missing", async () => {
    const res = await streamRouter.request("http://localhost/");
    assert.equal(res.status, 400);
    const text = await res.text();
    assert.match(text, /media_id required/i);
  });

  it("2. GET / should reject when unauthenticated and forward to AUTH_DO when authorized as Pro", async () => {
    const unauthedRes = await streamRouter.request("http://localhost/?media_id=item_123");
    assert.equal(unauthedRes.status, 401);

    let forwarded = false;
    const mockAuthDO = {
      idFromName: () => "mock-do-id",
      get: () => ({
        fetch: async () => {
          forwarded = true;
          return new Response(Buffer.from("video chunk"), {
            status: 206,
            headers: {
              "Content-Range": "bytes 0-10/100",
              "Content-Type": "video/mp4",
            },
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

    const res = await streamRouter.request(
      "http://localhost/?media_id=item_123",
      {
        headers: { "x-tg-session": `session_123.${clientSecret}` },
      },
      {
        AUTH_DO: mockAuthDO,
        DB: mockDb,
        SESSION_ENCRYPTION_KEY: serverKey,
        TELEGRAM_API_ID: "12345",
        TELEGRAM_API_HASH: "mock_hash",
      }
    );

    assert.equal(res.status, 206);
    assert.equal(forwarded, true);
    assert.equal(res.headers.get("x-edge-cache"), "MISS");
  });

  it("3. GET / should return 403 when user tier is on hold", async () => {
    const mockDb = {
      prepare: (sql: string) => ({
        bind: (...params: any[]) => ({
          first: async () => ({
            user_id: "u1",
            telegram_user_id: 12345,
            display_name: "Held User",
            session_string: encryptedSessionStr,
            tier: "premium",
            is_tier_held: 1,
            tier_hold_reason: "Paused",
          }),
          all: async () => ({ results: [] }),
          run: async () => ({ success: true }),
        }),
      }),
    };

    const res = await streamRouter.request(
      "http://localhost/?media_id=item_123",
      {
        headers: { "x-tg-session": `session_123.${clientSecret}` },
      },
      {
        DB: mockDb,
        SESSION_ENCRYPTION_KEY: serverKey,
        TELEGRAM_API_ID: "12345",
        TELEGRAM_API_HASH: "mock_hash",
      }
    );

    assert.equal(res.status, 403);
    const body: any = await res.json();
    assert.equal(body.error, "UPGRADE_REQUIRED");
  });

  it("4. GET /public/:shareId should forward to AUTH_DO with bot_stream_coordinator", async () => {
    let targetDoId = "";
    let forwardedShareId = "";

    const mockAuthDO = {
      idFromName: (name: string) => {
        targetDoId = name;
        return name;
      },
      get: () => ({
        fetch: async (req: Request) => {
          forwardedShareId = req.headers.get("x-share-id") || "";
          return new Response(Buffer.from("public video chunk"), {
            status: 206,
            headers: {
              "Content-Range": "bytes 0-17/100",
              "Content-Type": "video/mp4",
            },
          });
        },
      }),
    };

    const res = await streamRouter.request(
      "http://localhost/public/sh_sample123",
      {},
      { AUTH_DO: mockAuthDO }
    );

    assert.equal(res.status, 206);
    assert.equal(targetDoId, "bot_stream_coordinator");
    assert.equal(forwardedShareId, "sh_sample123");
    assert.equal(res.headers.get("x-edge-cache"), "MISS");
  });
});
