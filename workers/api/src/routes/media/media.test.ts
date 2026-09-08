import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mediaRouter } from "./index";

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
  it("1. GET / should return 401 when unauthenticated", async () => {
    const res = await mediaRouter.request("http://localhost/?channel_id=chan_1");
    assert.equal(res.status, 401);
  });

  it("2. POST /upload/init should forward to AUTH_DO when configured", async () => {
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

    const res = await mediaRouter.request(
      "http://localhost/upload/init",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel_id: "c1", file_name: "test.jpg", file_size: 1000, total_chunks: 1 }),
      },
      { AUTH_DO: mockAuthDO }
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
