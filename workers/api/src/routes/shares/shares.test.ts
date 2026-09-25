import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { sharesRouter } from "./index";

describe("⚡ Public Shares Routes Suite", () => {
  const app = new Hono();
  app.route("/shares", sharesRouter);

  it("1. POST /shares/create should return 401 when unauthenticated", async () => {
    const res = await app.request("/shares/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ media_id: "item_123" }),
    });

    assert.equal(res.status, 401);
  });

  it("2. GET /shares should return 401 when unauthenticated", async () => {
    const res = await app.request("/shares", {
      method: "GET",
    });

    assert.equal(res.status, 401);
  });

  it("3. GET /shares/media/:mediaId should return 401 when unauthenticated", async () => {
    const res = await app.request("/shares/media/item_123", {
      method: "GET",
    });

    assert.equal(res.status, 401);
  });

  it("4. POST /shares/:id/revoke should return 401 when unauthenticated", async () => {
    const res = await app.request("/shares/sh_123/revoke", {
      method: "POST",
    });

    assert.equal(res.status, 401);
  });

  it("5. GET /shares/info/:id should return 404 for nonexistent share (mocked db)", async () => {
    const mockEnv = {
      DB: {
        prepare: () => ({
          bind: () => ({
            first: async () => null,
            all: async () => ({ results: [] }),
            run: async () => ({ success: true }),
          }),
        }),
      },
    };

    const res = await app.request(
      "/shares/info/sh_nonexistent",
      { method: "GET" },
      mockEnv
    );

    assert.equal(res.status, 404);
  });
});
