import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MediaLocationResolver } from "./mediaLocationResolver.ts";
import { ParallelSegmentFetcher } from "./parallelSegmentFetcher.ts";
import { StreamHandler } from "./streamHandler.ts";
import { ClientSessionManager } from "../auth/clientSessionManager.ts";
import { SlidingWindowRatePacer } from "../common/ratePacer.ts";
import { TelemetryLogger } from "../telemetry/telemetryLogger.ts";
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

describe("⚡ DO Stream Engine Suite", () => {
  it("1. MediaLocationResolver should cache and return file locations", async () => {
    const resolver = new MediaLocationResolver();
    const mockLocation = { id: 12345, accessHash: 67890 };

    resolver.mediaLocationCache.set("item_1", {
      fileLocation: mockLocation,
      expires: Date.now() + 60000,
    });

    const resolved = await resolver.resolveMediaLocation(null, { id: "item_1" });
    assert.equal(resolved, mockLocation);

    resolver.deleteLocation("item_1");
    assert.equal(resolver.mediaLocationCache.has("item_1"), false);
  });

  it("2. ParallelSegmentFetcher storeChunkInRam should bound RAM to 8 chunks", () => {
    const fetcher = new ParallelSegmentFetcher();

    for (let i = 0; i < 12; i++) {
      fetcher.storeChunkInRam(`chunk_${i}`, Buffer.alloc(10));
    }

    assert.equal(fetcher.prefetchedChunks.size, 8);
    assert.equal(fetcher.prefetchedChunks.has("chunk_0"), false);
    assert.equal(fetcher.prefetchedChunks.has("chunk_11"), true);

    fetcher.clear();
    assert.equal(fetcher.prefetchedChunks.size, 0);
    assert.equal(fetcher.segmentRingCache.size, 0);
  });

  it("3. StreamHandler should reject when media_id is missing", async () => {
    const handler = new StreamHandler();
    const clientManager = new ClientSessionManager();
    const locationResolver = new MediaLocationResolver();
    const segmentFetcher = new ParallelSegmentFetcher();
    const pacer = new SlidingWindowRatePacer();
    const logger = new TelemetryLogger(null, {});

    const req = new Request("https://example.com/stream");
    const res = await handler.handleStream(req, {}, clientManager, locationResolver, segmentFetcher, pacer, logger);

    assert.equal(res.status, 400);
    const text = await res.text();
    assert.match(text, /media_id required/i);
  });

  it("4. StreamHandler should reject when user client is unauthorized", async () => {
    const handler = new StreamHandler();
    const clientManager = new ClientSessionManager();
    const locationResolver = new MediaLocationResolver();
    const segmentFetcher = new ParallelSegmentFetcher();
    const pacer = new SlidingWindowRatePacer();
    const logger = new TelemetryLogger(null, {});

    const req = new Request("https://example.com/stream?media_id=item_123");
    const res = await handler.handleStream(req, {}, clientManager, locationResolver, segmentFetcher, pacer, logger);

    assert.equal(res.status, 401);
  });

  it("5. StreamHandler should return 404 when media item is not found in DB", async () => {
    const handler = new StreamHandler();
    const clientManager = new ClientSessionManager();
    const locationResolver = new MediaLocationResolver();
    const segmentFetcher = new ParallelSegmentFetcher();
    const pacer = new SlidingWindowRatePacer();
    const logger = new TelemetryLogger(null, {});

    const { sessionToken } = generateCompositeSessionToken();
    clientManager.userClients.set(sessionToken, {
      client: { connected: true, __userId: "user_1" },
      lastUsed: Date.now(),
    });

    const mockDb = createMockD1(null); // not found in DB

    const req = new Request("https://example.com/stream?media_id=nonexistent", {
      headers: { "x-tg-session": sessionToken },
    });

    const res = await handler.handleStream(req, { DB: mockDb }, clientManager, locationResolver, segmentFetcher, pacer, logger);
    assert.equal(res.status, 404);
  });

  it("6. StreamHandler should return 416 for out of range Range headers", async () => {
    const handler = new StreamHandler();
    const clientManager = new ClientSessionManager();
    const locationResolver = new MediaLocationResolver();
    const segmentFetcher = new ParallelSegmentFetcher();
    const pacer = new SlidingWindowRatePacer();
    const logger = new TelemetryLogger(null, {});

    const { sessionToken } = generateCompositeSessionToken();
    clientManager.userClients.set(sessionToken, {
      client: { connected: true, __userId: "user_1" },
      lastUsed: Date.now(),
    });

    const mockDb = createMockD1({
      id: "item_123",
      channel_id: "chan_1",
      telegram_channel_id: "me",
      telegram_message_id: 42,
      file_size_bytes: 1000,
      mime_type: "video/mp4",
    });

    locationResolver.mediaLocationCache.set("item_123", {
      fileLocation: { id: 1 },
      expires: Date.now() + 60000,
    });

    const req = new Request("https://example.com/stream?media_id=item_123", {
      headers: {
        "x-tg-session": sessionToken,
        Range: "bytes=2000-3000", // start > totalSize
      },
    });

    const res = await handler.handleStream(req, { DB: mockDb }, clientManager, locationResolver, segmentFetcher, pacer, logger);
    assert.equal(res.status, 416);
    assert.equal(res.headers.get("Content-Range"), "bytes */1000");
  });
});
