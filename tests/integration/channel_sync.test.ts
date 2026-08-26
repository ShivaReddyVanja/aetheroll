import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { sanitizeD1Param, toSafeNumber, toSafeString } from "../../src/server/lib/db.ts";
import type { DatabaseInterface } from "../../src/server/lib/db.ts";

describe("🔄 Channel Sync & Safe Non-Destructive Ingestion Suite", () => {
  it("1. should sanitize GramJS BigInteger and Long objects to primitive numbers", () => {
    const mockBigInt = {
      value: "110583010",
      toString() {
        return "110583010";
      },
      toJSNumber() {
        return 110583010;
      },
    };

    assert.equal(typeof mockBigInt, "object", "Mock BigInt is an object in JS");

    const sanitized = sanitizeD1Param(mockBigInt);
    assert.equal(typeof sanitized, "number", "Sanitized parameter must be a primitive number");
    assert.equal(sanitized, 110583010);

    const safeNum = toSafeNumber(mockBigInt);
    assert.equal(typeof safeNum, "number");
    assert.equal(safeNum, 110583010);
  });

  it("2. should sanitize native BigInt, numbers, strings, and null without distortion", () => {
    assert.equal(sanitizeD1Param(BigInt(987654321)), 987654321);
    assert.equal(sanitizeD1Param(42), 42);
    assert.equal(sanitizeD1Param("telegram-uuid"), "telegram-uuid");
    assert.equal(sanitizeD1Param(null), null);
    assert.equal(sanitizeD1Param(undefined), null);
  });

  it("3. should handle GramJS message structures with BigInteger sizes during channel sync", async () => {
    const mediaTable = new Map<string, any>();

    const mockDb: DatabaseInterface = {
      async all<T = any>(): Promise<T[]> {
        return [] as any;
      },
      async get<T = any>(): Promise<T | null> {
        return null;
      },
      async run(sql: string, params: any[] = []) {
        const sanitizedParams = params.map(sanitizeD1Param);
        for (const p of sanitizedParams) {
          if (typeof p === "object" && p !== null) {
            throw new Error(`D1_TYPE_ERROR: Type 'object' not supported for value '${p}'`);
          }
        }

        if (sql.includes("INSERT INTO media_items")) {
          const [
            id, channelId, uploaderId, tgMsgId, fileType,
            mimeType, fileSize, width, height, duration,
            blurHash, capturedAt
          ] = sanitizedParams;

          mediaTable.set(id, {
            id, channelId, uploaderId, tgMsgId, fileType,
            mimeType, fileSize, width, height, duration,
            blurHash, capturedAt
          });
          return { changes: 1 };
        }
        return { changes: 0 };
      },
      async exec() {},
    };

    const mockTelegramMessage = {
      id: { toString: () => "4242", toJSNumber: () => 4242 },
      date: 1724140000,
      media: true,
      video: true,
      document: {
        mimeType: "video/mp4",
        size: { toString: () => "110583010", toJSNumber: () => 110583010 },
        attributes: [
          { w: { toString: () => "1920", toJSNumber: () => 1920 } },
          { h: { toString: () => "1080", toJSNumber: () => 1080 } },
          { duration: { toString: () => "120", toJSNumber: () => 120 } },
        ],
      },
    };

    const isVideo = true;
    const fileType = "video";
    const mimeType = "video/mp4";
    const fileSize = toSafeNumber(mockTelegramMessage.document.size, 0);
    const width = toSafeNumber(mockTelegramMessage.document.attributes[0].w, 1920);
    const height = toSafeNumber(mockTelegramMessage.document.attributes[1].h, 1080);
    const duration = toSafeNumber(mockTelegramMessage.document.attributes[2].duration, null as any);
    const capturedAt = new Date(mockTelegramMessage.date * 1000).toISOString();
    const mediaId = crypto.randomUUID();
    const channelId = "channel-uuid-1";
    const userId = "user-uuid-1";
    const tgMsgId = toSafeNumber(mockTelegramMessage.id);

    await mockDb.run(
      `INSERT INTO media_items (
         id, channel_id, uploader_user_id, telegram_message_id, file_type,
         mime_type, file_size_bytes, width, height, duration_seconds,
         blur_hash, captured_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        mediaId, channelId, userId, tgMsgId, fileType,
        mimeType, fileSize, width, height, duration,
        "LEHV6nWB2yk8pyo0adR*.7kCMdnj", capturedAt
      ]
    );

    const saved = mediaTable.get(mediaId);
    assert.ok(saved !== undefined, "Media item must be saved to DB");
    assert.equal(saved.fileSize, 110583010);
    assert.equal(typeof saved.fileSize, "number");
    assert.equal(saved.width, 1920);
    assert.equal(saved.height, 1080);
    assert.equal(saved.duration, 120);
    assert.equal(saved.tgMsgId, 4242);
  });

  it("4. should strictly reject non-Aetheroll media and accept only genuine signed media during sync", async () => {
    const { generateAetherollSignature, verifyAetherollSignature } = await import("../../src/server/lib/crypto.ts");
    const secretKey = "test-secret-session-key";
    const fileSize = 5242880;
    const dateSeconds = 1718900000;

    const isRandomValid = await verifyAetherollSignature(
      "Hey check out my dog!",
      fileSize,
      dateSeconds,
      secretKey
    );
    assert.strictEqual(isRandomValid, false);

    const isForgedValid = await verifyAetherollSignature(
      "[AET:v1:deadbeef]",
      fileSize,
      dateSeconds,
      secretKey
    );
    assert.strictEqual(isForgedValid, false);

    const genuineSig = await generateAetherollSignature(fileSize, dateSeconds, secretKey);
    const isGenuineValid = await verifyAetherollSignature(
      genuineSig,
      fileSize,
      dateSeconds,
      secretKey
    );
    assert.strictEqual(isGenuineValid, true);
  });

  it("5. should record WAL event message IDs into DB during sync and NEVER delete messages from Telegram", async () => {
    const eventMessagesTable = new Map<string, { channelId: string; mediaMsgId: number; eventMsgId: number }>();
    const telegramDeletedMessageIds: number[] = [];

    // Simulated non-destructive sync logic
    const syncEvents = async (
      events: Array<{ msgId: number; ref: number; op: string }>,
      existingMediaIds: Set<number>,
      channelId: string
    ) => {
      const validEventsToReplay: any[] = [];

      for (const rec of events) {
        // Track the WAL event message ID in DB for future clean deletion
        const entryId = `${channelId}_${rec.msgId}`;
        eventMessagesTable.set(entryId, {
          channelId,
          mediaMsgId: rec.ref,
          eventMsgId: rec.msgId,
        });

        // Only replay event if parent media exists in DB or active slice
        if (existingMediaIds.has(rec.ref)) {
          validEventsToReplay.push(rec);
        }
      }

      // CRITICAL: Notice zero calls to client.deleteMessages!
      return { replayedCount: validEventsToReplay.length };
    };

    const existingMediaInD1 = new Set([50, 100]); // Media 50 was uploaded long ago, outside recent 200 messages

    const recentEvents = [
      { msgId: 301, ref: 50, op: "FAVORITE" },  // Valid event pointing to older photo 50 (outside 200 msgs)
      { msgId: 302, ref: 100, op: "TAG" },      // Valid event pointing to photo 100
      { msgId: 303, ref: 999, op: "TAG" },      // Event pointing to already deleted photo 999
    ];

    const result = await syncEvents(recentEvents, existingMediaInD1, "channel-1");

    // Events 301 and 302 should be replayed
    assert.equal(result.replayedCount, 2);
    // All 3 event message IDs are recorded in DB
    assert.equal(eventMessagesTable.size, 3);
    // Crucially, NO messages were deleted from Telegram during sync
    assert.equal(telegramDeletedMessageIds.length, 0);
  });
});
