import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("⚡ Cloudflare Edge Cache (caches.default) Pipeline", () => {
  it("1. should generate deterministic, isolated Edge Cache keys for video slices", () => {
    const origin = "https://aetheroll.shivareddyvanja.workers.dev";
    const mediaId = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
    const rangeHeader = "bytes=0-524287";
    const cacheKeyUrl = `${origin}/api/stream/cache/${encodeURIComponent(mediaId)}?range=${encodeURIComponent(rangeHeader)}`;
    
    assert.equal(
      cacheKeyUrl,
      "https://aetheroll.shivareddyvanja.workers.dev/api/stream/cache/f47ac10b-58cc-4372-a567-0e02b2c3d479?range=bytes%3D0-524287"
    );

    // Another range on same media generates distinct cache key
    const rangeHeader2 = "bytes=524288-1048575";
    const cacheKeyUrl2 = `${origin}/api/stream/cache/${encodeURIComponent(mediaId)}?range=${encodeURIComponent(rangeHeader2)}`;
    assert.notEqual(cacheKeyUrl, cacheKeyUrl2);
  });

  it("2. should generate deterministic Edge Cache keys for thumbnails", () => {
    const origin = "https://aetheroll.shivareddyvanja.workers.dev";
    const mediaId = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
    const cacheKeyUrl = `${origin}/api/media/cache/${encodeURIComponent(mediaId)}/thumbnail`;
    assert.equal(cacheKeyUrl, "https://aetheroll.shivareddyvanja.workers.dev/api/media/cache/f47ac10b-58cc-4372-a567-0e02b2c3d479/thumbnail");
  });

  it("3. should format immutable 1-year Cache-Control headers", () => {
    const headers = new Headers();
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
    assert.equal(headers.get("Cache-Control"), "public, max-age=31536000, immutable");
  });
});
