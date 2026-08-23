import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseGalleryEvent, applyGalleryEventsToDb } from "../../src/server/lib/ledger.ts";
import type { GalleryEvent } from "../../src/server/lib/ledger.ts";
import type { DatabaseInterface } from "../../src/server/lib/db.ts";

describe("📜 Telegram Event Sourcing & Disaster Recovery Ledger", () => {
  it("should correctly parse valid [GP_EVENT:v1] JSON messages", async () => {
    const rawTelegramMessage = `
[GP_EVENT:v1]
{
  "_t": "GP_EVENT",
  "v": 1,
  "ref": 42,
  "op": "CREATE",
  "data": {
    "blur_hash": "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
    "captured_at": "2023-10-02T14:30:00.000Z",
    "gps": {
      "lat": 17.4482,
      "lng": 78.3489,
      "name": "Kuntala Falls"
    },
    "people": ["Shiva", "Reddy"],
    "event": "Andhra trip 2023",
    "fav": true
  },
  "ts": 1696257000
}
    `.trim();

    const parsed = await parseGalleryEvent(rawTelegramMessage);
    assert.ok(parsed, "Event should be successfully parsed");
    assert.equal(parsed?._t, "GP_EVENT");
    assert.equal(parsed?.ref, 42);
    assert.equal(parsed?.op, "CREATE");
    assert.equal(parsed?.data.blur_hash, "LEHV6nWB2yk8pyo0adR*.7kCMdnj");
    assert.equal(parsed?.data.people?.[0], "Shiva");
    assert.equal(parsed?.data.gps?.name, "Kuntala Falls");
  });

  it("should return null for non-event telegram messages", async () => {
    assert.equal(await parseGalleryEvent("Hello, how are you?"), null);
    assert.equal(await parseGalleryEvent("[GP_EVENT:v1]\n{invalid json"), null);
    assert.equal(await parseGalleryEvent(undefined), null);
  });

  it("should replay events deterministically and update state", async () => {
    const channelId = "test-channel-1";
    const userId = "test-user-1";

    // In-memory mock database state
    const mediaTable = new Map<string, any>();
    mediaTable.set("media-item-42", {
      id: "media-item-42",
      channel_id: channelId,
      telegram_message_id: 42,
      blur_hash: "placeholder",
      captured_at: "2020-01-01T00:00:00.000Z",
    });

    const favorites = new Set<string>();
    const peopleTags = new Map<string, string[]>();
    const locationTags = new Map<string, any>();

    const mockDb: DatabaseInterface = {
      async get<T = any>(sql: string, params: any[] = []): Promise<T | null> {
        if (sql.includes("FROM media_items WHERE channel_id = ? AND telegram_message_id = ?")) {
          const [cId, msgId] = params;
          for (const item of mediaTable.values()) {
            if (item.channel_id === cId && item.telegram_message_id === msgId) {
              return { id: item.id } as any;
            }
          }
          return null;
        }
        if (sql.includes("SELECT id FROM people WHERE name = ?")) {
          return { id: `person-${params[0]}` } as any;
        }
        if (sql.includes("SELECT id FROM locations WHERE name = ?")) {
          return { id: `loc-${params[0]}` } as any;
        }
        if (sql.includes("SELECT id FROM events WHERE name = ?")) {
          return { id: `event-${params[0]}` } as any;
        }
        return null;
      },
      async run(sql, params = []) {
        if (sql.includes("UPDATE media_items SET blur_hash = ? WHERE id = ?")) {
          const item = mediaTable.get(params[1]);
          if (item) item.blur_hash = params[0];
        }
        if (sql.includes("UPDATE media_items SET captured_at = ? WHERE id = ?")) {
          const item = mediaTable.get(params[1]);
          if (item) item.captured_at = params[0];
        }
        if (sql.includes("INSERT INTO media_favorites")) {
          favorites.add(`${params[0]}:${params[1]}`);
        }
        if (sql.includes("INSERT INTO media_person_tags")) {
          const existing = peopleTags.get(params[1]) || [];
          existing.push(params[2]);
          peopleTags.set(params[1], existing);
        }
        if (sql.includes("INSERT INTO media_location_tags")) {
          locationTags.set(params[0], params[1]);
        }
        return { changes: 1 };
      },
      async all() {
        return [];
      },
      async exec() {},
    };

    const events: GalleryEvent[] = [
      {
        _t: "GP_EVENT",
        v: 1,
        ref: 42,
        op: "CREATE",
        data: {
          blur_hash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
          captured_at: "2023-10-02T14:30:00.000Z",
          gps: { lat: 17.4482, lng: 78.3489, name: "Kuntala Falls" },
          people: ["Shiva", "Reddy"],
          fav: true,
        },
        ts: 1696257000,
      },
    ];

    const applied = await applyGalleryEventsToDb(mockDb, channelId, userId, events);
    assert.equal(applied, 1, "Should apply 1 event");

    const updated = mediaTable.get("media-item-42");
    assert.equal(updated.blur_hash, "LEHV6nWB2yk8pyo0adR*.7kCMdnj");
    assert.equal(updated.captured_at, "2023-10-02T14:30:00.000Z");
    assert.ok(favorites.has(`${userId}:media-item-42`), "Favorite must be recorded");
    assert.equal(peopleTags.get("media-item-42")?.length, 2, "2 people must be tagged");
  });
});
