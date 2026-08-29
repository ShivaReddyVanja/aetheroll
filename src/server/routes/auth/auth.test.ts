import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { authRouter } from "./index.ts";
import { generateCompositeSessionToken } from "../../lib/auth.ts";

function createMockD1(sessionRecord: any = null, userRecord: any = null) {
  return {
    prepare: (sql: string) => ({
      bind: (...params: any[]) => ({
        first: async () => {
          if (sql.includes("FROM user_sessions")) return sessionRecord;
          if (sql.includes("FROM users")) return userRecord;
          return null;
        },
        all: async () => ({ results: [] }),
        run: async () => ({ meta: { changes: 1 } }),
      }),
    }),
    exec: async () => {},
  };
}

describe("⚡ Auth Routes Suite", () => {
  it("1. POST /session should reject missing sessionToken", async () => {
    const res = await authRouter.request("http://localhost/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /sessionToken required/i);
  });

  it("2. POST /session should set cookie for valid composite session token", async () => {
    const { sessionToken } = generateCompositeSessionToken();
    const mockDb = createMockD1(null);

    const res = await authRouter.request(
      "http://localhost/session",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionToken }),
      },
      { DB: mockDb }
    );

    assert.equal(res.status, 200);
    const setCookie = res.headers.get("Set-Cookie") || "";
    assert.ok(setCookie.includes("tg_session="));
    assert.ok(setCookie.includes("HttpOnly"));
  });

  it("3. GET /me should return 401 when unauthorized", async () => {
    const res = await authRouter.request("http://localhost/me");
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.authenticated, false);
  });

  it("4. POST /logout should delete session and clear cookie", async () => {
    const { sessionToken } = generateCompositeSessionToken();
    const mockDb = createMockD1({ id: "s1" });

    const res = await authRouter.request(
      "http://localhost/logout",
      {
        method: "POST",
        headers: { "x-tg-session": sessionToken },
      },
      { DB: mockDb }
    );

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
  });

  it("5. GET /ws should return 500 when AUTH_DO is not configured", async () => {
    const res = await authRouter.request("http://localhost/ws");
    assert.equal(res.status, 500);
    const text = await res.text();
    assert.match(text, /Durable Object not configured/i);
  });

  it("6. GET /ws should forward to AUTH_DO when configured", async () => {
    let forwarded = false;
    const mockAuthDO = {
      idFromName: () => "mock-id",
      get: () => ({
        fetch: async () => {
          forwarded = true;
          return new Response("DO WebSocket Upgrade", { status: 200 });
        },
      }),
    };

    const res = await authRouter.request(
      "http://localhost/ws",
      {},
      { AUTH_DO: mockAuthDO }
    );

    assert.equal(res.status, 200);
    assert.equal(forwarded, true);
  });

  it("7. POST /qr/claim should return 400 when AUTH_DO is not configured", async () => {
    const res = await authRouter.request("http://localhost/qr/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ qrClaimId: "test-claim-id" }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /Durable Object disabled/i);
  });

  it("8. POST /qr/claim should forward to AUTH_DO with request body when configured", async () => {
    let forwarded = false;
    let receivedClaimId = "";
    const mockAuthDO = {
      idFromName: () => "mock-id",
      get: () => ({
        fetch: async (req: Request) => {
          forwarded = true;
          const body = await req.json();
          receivedClaimId = body.qrClaimId;
          return new Response(JSON.stringify({ success: true }), { status: 200 });
        },
      }),
    };

    const res = await authRouter.request(
      "http://localhost/qr/claim",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qrClaimId: "test-claim-id" }),
      },
      { AUTH_DO: mockAuthDO }
    );

    assert.equal(res.status, 200);
    assert.equal(forwarded, true);
    assert.equal(receivedClaimId, "test-claim-id");
  });
});

