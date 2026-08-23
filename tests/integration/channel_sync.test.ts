import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { sanitizeD1Param, toSafeNumber, toSafeString } from "../../src/server/lib/db.ts";
import type { DatabaseInterface } from "../../src/server/lib/db.ts";

describe("🔄 Channel Sync & D1 MTProto Type Sanitization Suite", () => {
  it("1. should sanitize GramJS BigInteger and Long objects to primitive numbers", () => {
    // Simulated GramJS BigInteger object (like big-integer library)
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

    // Simulated GramJS Message from Telegram channel with 105MB video
    const mockTelegramMessage = {
      id: { toString: () => "4242", toJSNumber: () => 4242 }, // GramJS msg.id object
      date: 1724140000,
      media: true,
      video: true,
      document: {
        mimeType: "video/mp4",
        size: { toString: () => "110583010", toJSNumber: () => 110583010 }, // 105MB BigInteger object
        attributes: [
          { w: { toString: () => "1920", toJSNumber: () => 1920 } },
          { h: { toString: () => "1080", toJSNumber: () => 1080 } },
          { duration: { toString: () => "120", toJSNumber: () => 120 } },
        ],
      },
    };

    const isPhoto = false;
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

    // This run must succeed WITHOUT throwing D1_TYPE_ERROR
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
    const fileSize = 5242880; // 5 MB
    const dateSeconds = 1718900000;

    // 1. Random Telegram chat photo without signature
    const isRandomValid = await verifyAetherollSignature(
      "Hey check out my dog!",
      fileSize,
      dateSeconds,
      secretKey
    );
    assert.strictEqual(isRandomValid, false, "Must strictly reject random non-Aetheroll media");

    // 2. Photo with forged / invalid hash
    const isForgedValid = await verifyAetherollSignature(
      "[AET:v1:deadbeef]",
      fileSize,
      dateSeconds,
      secretKey
    );
    assert.strictEqual(isForgedValid, false, "Must strictly reject forged signature");

    // 3. Photo with tampered file size
    const genuineSig = await generateAetherollSignature(fileSize, dateSeconds, secretKey);
    const isTamperedValid = await verifyAetherollSignature(
      genuineSig,
      fileSize + 1024,
      dateSeconds,
      secretKey
    );
    assert.strictEqual(isTamperedValid, false, "Must strictly reject tampered file size");

    // 4. Genuine Aetheroll photo upload
    const isGenuineValid = await verifyAetherollSignature(
      genuineSig,
      fileSize,
      dateSeconds,
      secretKey
    );
    assert.strictEqual(isGenuineValid, true, "Must strictly accept genuine Aetheroll media");
  });

  it("5. should accurately detect and clean orphaned event messages when target media is deleted", () => {
    const activeTgMediaMsgIds = new Set<number>([101, 102]); // only 101 and 102 exist in TG
    const eventRecords = [
      { msgId: 201, ref: 101 }, // valid, parent 101 exists
      { msgId: 202, ref: 999 }, // orphan! parent 999 was deleted
      { msgId: 203, ref: 888 }, // orphan! parent 888 was deleted
    ];
    const rawEventMessages = [
      { msgId: 204, ref: 102 }, // valid raw reply to 102
      { msgId: 205, ref: 777 }, // orphan! parent 777 was deleted
      { msgId: 206, ref: null }, // orphan! dangling unlinked message
    ];

    const orphanedEventIds = new Set<number>();
    const validEvents: any[] = [];

    for (const rec of eventRecords) {
      if (activeTgMediaMsgIds.has(rec.ref)) {
        validEvents.push(rec);
      } else {
        orphanedEventIds.add(rec.msgId);
      }
    }

    for (const rec of rawEventMessages) {
      if (rec.ref && activeTgMediaMsgIds.has(rec.ref)) {
        // keep
      } else {
        orphanedEventIds.add(rec.msgId);
      }
    }

    assert.equal(validEvents.length, 1);
    assert.equal(validEvents[0].msgId, 201);
    assert.deepEqual(Array.from(orphanedEventIds).sort(), [202, 203, 205, 206]);
  });
});
