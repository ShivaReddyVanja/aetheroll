import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Api } from "telegram";
import { QrAuthHandler } from "./qrAuthHandler";

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

describe("⚡ DO QrAuthHandler Suite", () => {
  const MASTER_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  it("1. handleCheckHttp should return 400 when qrId is not provided", async () => {
    const handler = new QrAuthHandler({});
    const res = await handler.handleCheckHttp(undefined, {}, new Request("https://example.com/check"));
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /qrId required/i);
  });

  it("2. handleCheckHttp should return 404 when session is missing or expired", async () => {
    const handler = new QrAuthHandler({});
    const res = await handler.handleCheckHttp("non_existent_qr", {}, new Request("https://example.com/check"));
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.match(body.error, /Session expired or invalid/i);
  });

  it("3. handleCheckHttp should return 200 with Set-Cookie and domain on successful login", async () => {
    const handler = new QrAuthHandler({});
    const qrId = "valid_qr_id";

    const mockUser = { id: 9999, firstName: "Alice", username: "alice" };
    const mockClient = {
      invoke: async (req: any) => {
        if (req instanceof Api.auth.ExportLoginToken) {
          return new Api.auth.LoginTokenSuccess({
            authorization: new Api.auth.Authorization({
              user: mockUser as any,
            } as any),
          });
        }
        return {};
      },
      isUserAuthorized: async () => true,
      getMe: async () => mockUser,
      session: { save: () => "mock_session_str" },
    };

    handler.activeSessions.set(qrId, {
      client: mockClient,
      tokenBuffer: Buffer.from("token_bytes"),
      expires: Date.now() + 10000,
    });

    const mockDb = createMockD1(null); // new user

    const req = new Request("https://app.example.com/check", {
      headers: { origin: "https://app.example.com" },
    });

    const res = await handler.handleCheckHttp(
      qrId,
      {
        DB: mockDb,
        SESSION_ENCRYPTION_KEY: MASTER_KEY,
        TELEGRAM_API_ID: "12345",
        TELEGRAM_API_HASH: "abcde",
      },
      req
    );

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.user.telegramUserId, "9999");
    assert.equal(body.user.displayName, "Alice");

    const cookieHeader = res.headers.get("Set-Cookie") || "";
    assert.ok(cookieHeader.includes("Domain=.example.com"), "Cookie must include dynamic apex domain");
    assert.ok(cookieHeader.includes("HttpOnly"), "Cookie must be HttpOnly");

    // Must remove session after success
    assert.equal(handler.activeSessions.has(qrId), false);
  });
});
