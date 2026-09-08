import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  encryptPayload,
  decryptPayload,
  emitGalleryEvent,
  emitGalleryBatch,
  parseGalleryEvent,
  parseGalleryBatch,
  applyOpToDb,
  applyGalleryEventsToDb,
  applyGalleryBatch,
  EVENT_TAG_PREFIX,
  BATCH_TAG_PREFIX,
} from "./index";
import type { DatabaseInterface } from "../db";

function createMockDatabase() {
  const mediaItems = new Map<string, any>();
  const favorites = new Set<string>();
  const people = new Map<string, string>();
  const mediaPeople = new Set<string>();
  const events = new Map<string, string>();
  const mediaEvents = new Set<string>();
  const tags = new Map<string, string>();
  const mediaTags = new Set<string>();
  const trips = new Map<string, string>();
  const mediaTrips = new Set<string>();

  const db: DatabaseInterface = {
    async get(sql: string, params: any[] = []) {
      if (sql.includes("FROM media_items")) {
        const [channelId, refMsgId] = params;
        for (const item of mediaItems.values()) {
          if (item.channel_id === channelId && item.telegram_message_id === refMsgId) {
            return item;
          }
        }
        return null;
      }
      if (sql.includes("FROM people")) {
        const [channelId, name] = params;
        const id = people.get(`${channelId}:${name}`);
        return id ? { id } : null;
      }
      if (sql.includes("FROM events")) {
        const [channelId, name] = params;
        const id = events.get(`${channelId}:${name}`);
        return id ? { id } : null;
      }
      if (sql.includes("FROM tags")) {
        const [channelId, name] = params;
        const id = tags.get(`${channelId}:${name}`);
        return id ? { id } : null;
      }
      if (sql.includes("FROM trips")) {
        const [channelId, name] = params;
        const id = trips.get(`${channelId}:${name}`);
        return id ? { id } : null;
      }
      return null;
    },
    async run(sql: string, params: any[] = []) {
      if (sql.includes("UPDATE media_items SET blur_hash")) {
        const [blurHash, id] = params;
        const item = mediaItems.get(id);
        if (item) item.blur_hash = blurHash;
      }
      if (sql.includes("UPDATE media_items SET captured_at")) {
        const [capturedAt, id] = params;
        const item = mediaItems.get(id);
        if (item) item.captured_at = capturedAt;
      }
      if (sql.includes("UPDATE media_items SET latitude")) {
        const [lat, lng, alt, id] = params;
        const item = mediaItems.get(id);
        if (item) {
          item.latitude = lat;
          item.longitude = lng;
          item.altitude = alt;
        }
      }
      if (sql.includes("INSERT INTO media_favorites")) {
        const [userId, mediaId] = params;
        favorites.add(`${userId}:${mediaId}`);
      }
      if (sql.includes("DELETE FROM media_favorites")) {
        const [userId, mediaId] = params;
        favorites.delete(`${userId}:${mediaId}`);
      }
      if (sql.includes("INSERT INTO people")) {
        const [personId, channelId, name] = params;
        people.set(`${channelId}:${name}`, personId);
      }
      if (sql.includes("INSERT INTO media_person_tags")) {
        const [, mediaId, personId] = params;
        mediaPeople.add(`${mediaId}:${personId}`);
      }
      if (sql.includes("INSERT INTO events")) {
        const [eventId, channelId, name] = params;
        events.set(`${channelId}:${name}`, eventId);
      }
      if (sql.includes("INSERT INTO media_event_tags")) {
        const [, mediaId, eventId] = params;
        mediaEvents.add(`${mediaId}:${eventId}`);
      }
      if (sql.includes("INSERT INTO tags")) {
        const [tagId, channelId, , name] = params;
        tags.set(`${channelId}:${name}`, tagId);
      }
      if (sql.includes("INSERT INTO media_tags")) {
        const [mediaId, tagId] = params;
        mediaTags.add(`${mediaId}:${tagId}`);
      }
      if (sql.includes("INSERT INTO trips")) {
        const [tripId, channelId, , name] = params;
        trips.set(`${channelId}:${name}`, tripId);
      }
      if (sql.includes("INSERT INTO trip_media")) {
        const [mediaId, tripId] = params;
        mediaTrips.add(`${mediaId}:${tripId}`);
      }
      if (sql.includes("UPDATE media_items SET deleted_at")) {
        const [id] = params;
        const item = mediaItems.get(id);
        if (item) item.deleted_at = new Date().toISOString();
      }
      return { changes: 1 };
    },
    async all() {
      return [];
    },
    async exec() {},
  };

  return {
    db,
    mediaItems,
    favorites,
    people,
    mediaPeople,
    events,
    mediaEvents,
    tags,
    mediaTags,
    trips,
    mediaTrips,
  };
}

describe("📜 Comprehensive Event Ledger Suite", () => {
  const CUSTOM_KEY = "test_custom_master_encryption_key_12345";

  describe("1. Crypto Layer", () => {
    it("should encrypt and decrypt payloads with authenticated AES-GCM", async () => {
      const data = { op: "SET_EVENT", data: { event: "Birthday Party" }, ts: 1700000000 };
      const { iv, ct } = await encryptPayload(data, CUSTOM_KEY);

      assert.ok(iv);
      assert.ok(ct);

      const decrypted = await decryptPayload(iv, ct, CUSTOM_KEY);
      assert.deepEqual(decrypted, data);
    });

    it("should return null when decrypting with wrong key or tampered ciphertext", async () => {
      const data = { op: "DELETE", data: { deleted: true } };
      const { iv, ct } = await encryptPayload(data, CUSTOM_KEY);

      const wrongKeyDecrypted = await decryptPayload(iv, ct, "wrong_secret_key_99999");
      assert.equal(wrongKeyDecrypted, null);

      const tamperedCt = ct.substring(0, ct.length - 4) + "AAAA";
      const tamperedDecrypted = await decryptPayload(iv, tamperedCt, CUSTOM_KEY);
      assert.equal(tamperedDecrypted, null);
    });
  });

  describe("2. Telegram Emitters", () => {
    it("emitGalleryEvent should format message with EVENT_TAG_PREFIX and threaded replyTo", async () => {
      let sentMsg: any = null;
      const mockClient = {
        sendMessage: async (peer: any, options: any) => {
          sentMsg = { peer, ...options };
          return { id: 777 };
        },
      } as any;

      const eventId = await emitGalleryEvent(
        mockClient,
        "me",
        42,
        "FAVORITE",
        { fav: true },
        CUSTOM_KEY
      );

      assert.equal(eventId, 777);
      assert.ok(sentMsg);
      assert.equal(sentMsg.replyTo, 42);
      assert.ok(sentMsg.message.startsWith(EVENT_TAG_PREFIX));
    });

    it("emitGalleryBatch should send JSON document with BATCH_TAG_PREFIX", async () => {
      let sentDoc: any = null;
      const mockClient = {
        sendFile: async (peer: any, options: any) => {
          sentDoc = { peer, ...options };
          return { id: 888 };
        },
      } as any;

      const ops = [
        { op: "ADD_TAG" as const, refs: [101, 102], data: { tags: ["vacation"] } },
      ];

      const batchId = await emitGalleryBatch(mockClient, "me", "chan_1", ops, CUSTOM_KEY);
      assert.equal(batchId, 888);
      assert.ok(sentDoc);
      assert.equal(sentDoc.caption, BATCH_TAG_PREFIX);
      assert.equal(sentDoc.forceDocument, true);
    });
  });

  describe("3. Telegram Parsers", () => {
    it("parseGalleryEvent should parse encrypted [GP_EVENT:v1] messages", async () => {
      const original = { op: "TAG_PEOPLE" as const, data: { people: ["Shiva"] }, ts: 1700000000 };
      const { iv, ct } = await encryptPayload(original, CUSTOM_KEY);

      const envelope = {
        _t: "GP_EVENT",
        v: 1,
        ref: 100,
        iv,
        ct,
      };
      const text = `${EVENT_TAG_PREFIX}\n${JSON.stringify(envelope)}`;

      const parsed = await parseGalleryEvent(text, CUSTOM_KEY);
      assert.ok(parsed);
      assert.equal(parsed._t, "GP_EVENT");
      assert.equal(parsed.ref, 100);
      assert.equal(parsed.op, "TAG_PEOPLE");
      assert.deepEqual(parsed.data.people, ["Shiva"]);
    });

    it("parseGalleryEvent should parse legacy unencrypted messages", async () => {
      const legacy = {
        _t: "GP_EVENT",
        v: 1,
        ref: 200,
        op: "FAVORITE",
        data: { fav: true },
        ts: 1700000000,
      };
      const text = `${EVENT_TAG_PREFIX}\n${JSON.stringify(legacy)}`;

      const parsed = await parseGalleryEvent(text, CUSTOM_KEY);
      assert.ok(parsed);
      assert.equal(parsed.ref, 200);
      assert.equal(parsed.op, "FAVORITE");
    });

    it("parseGalleryEvent should return null for non-event or malformed text", async () => {
      assert.equal(await parseGalleryEvent("Hello world!"), null);
      assert.equal(await parseGalleryEvent(`${EVENT_TAG_PREFIX}\n{ invalid json`), null);
      assert.equal(await parseGalleryEvent(`${EVENT_TAG_PREFIX}\n{"_t":"OTHER"}`), null);
    });

    it("parseGalleryBatch should decrypt valid batch documents", async () => {
      const ops = [
        { op: "SET_LOCATION" as const, refs: [42], data: { gps: { lat: 17.5, lng: 78.5 } } },
      ];
      const { iv, ct } = await encryptPayload({ ts: 1700000000, ops }, CUSTOM_KEY);

      const manifest = {
        _t: "GP_BATCH",
        v: 1,
        channel_id: "chan_abc",
        iv,
        ct,
      };
      const docBytes = Buffer.from(JSON.stringify(manifest), "utf-8");

      const result = await parseGalleryBatch(BATCH_TAG_PREFIX, docBytes, "chan_abc", CUSTOM_KEY);
      assert.ok(result);
      assert.equal(result.ops.length, 1);
      assert.equal(result.ops[0].op, "SET_LOCATION");

      // Wrong caption -> null
      assert.equal(await parseGalleryBatch("Wrong Caption", docBytes, "chan_abc", CUSTOM_KEY), null);
      // Wrong channelId -> null
      assert.equal(await parseGalleryBatch(BATCH_TAG_PREFIX, docBytes, "other_chan", CUSTOM_KEY), null);
    });
  });

  describe("4. Database State Replay Engine", () => {
    it("applyOpToDb should execute all 8 mutation types correctly in DB", async () => {
      const {
        db,
        mediaItems,
        favorites,
        people,
        mediaPeople,
        events,
        mediaEvents,
        tags,
        mediaTags,
        trips,
        mediaTrips,
      } = createMockDatabase();

      const mediaId = "media_1";
      mediaItems.set(mediaId, {
        id: mediaId,
        channel_id: "chan_1",
        telegram_message_id: 101,
      });

      // 1. Metadata attributes
      await applyOpToDb(db, "chan_1", "user_1", 101, "CREATE", {
        blur_hash: "TEST_BLUR_HASH",
        captured_at: "2024-01-01T00:00:00Z",
      });
      assert.equal(mediaItems.get(mediaId).blur_hash, "TEST_BLUR_HASH");
      assert.equal(mediaItems.get(mediaId).captured_at, "2024-01-01T00:00:00Z");

      // 2. GPS Location
      await applyOpToDb(db, "chan_1", "user_1", 101, "SET_LOCATION", {
        gps: { lat: 12.34, lng: 56.78, alt: 100 },
      });
      assert.equal(mediaItems.get(mediaId).latitude, 12.34);
      assert.equal(mediaItems.get(mediaId).longitude, 56.78);
      assert.equal(mediaItems.get(mediaId).altitude, 100);

      // 3. Favorites toggle (add and remove)
      await applyOpToDb(db, "chan_1", "user_1", 101, "FAVORITE", { fav: true });
      assert.ok(favorites.has("user_1:media_1"));
      await applyOpToDb(db, "chan_1", "user_1", 101, "FAVORITE", { fav: false });
      assert.ok(!favorites.has("user_1:media_1"));

      // 4. People tags
      await applyOpToDb(db, "chan_1", "user_1", 101, "TAG_PEOPLE", { people: ["Alice", "Bob"] });
      assert.ok(people.has("chan_1:Alice"));
      assert.ok(people.has("chan_1:Bob"));
      assert.equal(mediaPeople.size, 2);

      // 5. Events
      await applyOpToDb(db, "chan_1", "user_1", 101, "SET_EVENT", { event: "Concert" });
      assert.ok(events.has("chan_1:Concert"));
      assert.equal(mediaEvents.size, 1);

      // 6. Tags
      await applyOpToDb(db, "chan_1", "user_1", 101, "ADD_TAG", { tags: ["summer", "nature"] });
      assert.ok(tags.has("chan_1:summer"));
      assert.ok(tags.has("chan_1:nature"));
      assert.equal(mediaTags.size, 2);

      // 7. Trips
      await applyOpToDb(db, "chan_1", "user_1", 101, "SET_TRIP", { trip: "Goa 2024" });
      assert.ok(trips.has("chan_1:Goa 2024"));
      assert.equal(mediaTrips.size, 1);

      // 8. Soft Delete
      await applyOpToDb(db, "chan_1", "user_1", 101, "DELETE", { deleted: true });
      assert.ok(mediaItems.get(mediaId).deleted_at);
    });

    it("applyGalleryEventsToDb should sort events chronologically before applying", async () => {
      const { db, mediaItems } = createMockDatabase();
      mediaItems.set("m1", { id: "m1", channel_id: "c1", telegram_message_id: 10 });

      const events = [
        { _t: "GP_EVENT" as const, v: 1, ref: 10, op: "CREATE" as const, data: { blur_hash: "FINAL" }, ts: 2000 },
        { _t: "GP_EVENT" as const, v: 1, ref: 10, op: "CREATE" as const, data: { blur_hash: "EARLY" }, ts: 1000 },
      ];

      const applied = await applyGalleryEventsToDb(db, "c1", "u1", events);
      assert.equal(applied, 2);
      // Final blur_hash must be from the later timestamp (ts: 2000)
      assert.equal(mediaItems.get("m1").blur_hash, "FINAL");
    });

    it("applyGalleryBatch should apply operations across all referenced message IDs", async () => {
      const { db, mediaItems, favorites } = createMockDatabase();
      mediaItems.set("m1", { id: "m1", channel_id: "c1", telegram_message_id: 1 });
      mediaItems.set("m2", { id: "m2", channel_id: "c1", telegram_message_id: 2 });

      const batchOps = [
        { op: "FAVORITE" as const, refs: [1, 2], data: { fav: true } },
      ];

      const applied = await applyGalleryBatch(db, "c1", "u1", batchOps);
      assert.equal(applied, 2);
      assert.ok(favorites.has("u1:m1"));
      assert.ok(favorites.has("u1:m2"));
    });
  });
});
