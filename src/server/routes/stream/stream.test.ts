import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { streamRouter } from "./index.ts";

describe("⚡ Stream Routes Suite", () => {
  it("1. GET / should return 400 when media_id is missing", async () => {
    const res = await streamRouter.request("http://localhost/");
    assert.equal(res.status, 400);
    const text = await res.text();
    assert.match(text, /media_id required/i);
  });

  it("2. GET / should forward to AUTH_DO when configured", async () => {
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

    const res = await streamRouter.request(
      "http://localhost/?media_id=item_123",
      {},
      { AUTH_DO: mockAuthDO }
    );

    assert.equal(res.status, 206);
    assert.equal(forwarded, true);
    assert.equal(res.headers.get("x-edge-cache"), "MISS");
  });

  it("3. GET / should return 401 when unauthenticated in local mode", async () => {
    const res = await streamRouter.request("http://localhost/?media_id=item_123");
    assert.equal(res.status, 401);
  });
});
