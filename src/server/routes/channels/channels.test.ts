import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { channelsRouter } from "./index.ts";
import { generateCompositeSessionToken } from "../../lib/auth.ts";

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
});
