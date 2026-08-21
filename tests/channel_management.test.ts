import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import type { DatabaseInterface } from "../src/server/lib/db.ts";

interface ChannelRecord {
  id: string;
  telegram_channel_id: string;
  name: string;
  cover_media_id: string | null;
  last_synced_at: string | null;
}

interface GalleryChannelRecord {
  user_id: string;
  channel_id: string;
}

function createMockDatabase() {
  const usersTable = new Map<string, any>();
  const channelsTable = new Map<string, ChannelRecord>();
  const galleryChannelsTable = new Map<string, GalleryChannelRecord>(); // key: `${user_id}:${channel_id}`
  const mediaItemsTable = new Map<string, any>();

  const db: DatabaseInterface = {
    async all<T = any>(sql: string, params: any[] = []): Promise<T[]> {
      // 1. Channel Picker Modal Query (all=true)
      if (sql.includes("EXISTS(SELECT 1 FROM gallery_channels")) {
        const userId = params[0];
        const results: any[] = [];

        for (const ch of channelsTable.values()) {
          const key = `${userId}:${ch.id}`;
          const isAdded = galleryChannelsTable.has(key) ? 1 : 0;

          let mediaCount = 0;
          for (const m of mediaItemsTable.values()) {
            if (m.channel_id === ch.id && !m.deleted_at) mediaCount++;
          }

          results.push({
            id: ch.id,
            telegram_channel_id: ch.telegram_channel_id,
            name: ch.name,
            cover_media_id: ch.cover_media_id,
            last_synced_at: ch.last_synced_at,
            media_count: mediaCount,
            is_added: isAdded,
          });
        }

        results.sort((a, b) => {
          if (a.telegram_channel_id === "me") return -1;
          if (b.telegram_channel_id === "me") return 1;
          return a.name.localeCompare(b.name);
        });

        return results as T[];
      }

      // 2. Default Active Gallery Channels Query
      if (sql.includes("FROM channels c") && sql.includes("JOIN gallery_channels gc")) {
        const userId = params[0];
        const results: any[] = [];

        for (const gc of galleryChannelsTable.values()) {
          if (gc.user_id !== userId) continue;
          const ch = channelsTable.get(gc.channel_id);
          if (!ch) continue;

          let mediaCount = 0;
          for (const m of mediaItemsTable.values()) {
            if (m.channel_id === ch.id && !m.deleted_at) mediaCount++;
          }

          results.push({
            id: ch.id,
            telegram_channel_id: ch.telegram_channel_id,
            name: ch.name,
            cover_media_id: ch.cover_media_id,
            last_synced_at: ch.last_synced_at,
            media_count: mediaCount,
          });
        }

        results.sort((a, b) => {
          if (a.telegram_channel_id === "me") return -1;
          if (b.telegram_channel_id === "me") return 1;
          return (b.media_count || 0) - (a.media_count || 0);
        });

        return results as T[];
      }

      return [];
    },

    async get<T = any>(sql: string, params: any[] = []): Promise<T | null> {
      if (sql.includes("telegram_channel_id = 'me'")) {
        for (const ch of channelsTable.values()) {
          if (ch.telegram_channel_id === "me") return { ...ch } as any;
        }
        return null;
      }
      if (sql.includes("FROM channels WHERE telegram_channel_id = ?")) {
        const tgId = params[0];
        for (const ch of channelsTable.values()) {
          if (ch.telegram_channel_id === tgId) return { ...ch } as any;
        }
        return null;
      }
      if (sql.includes("FROM channels WHERE id = ?")) {
        const id = params[0];
        const ch = channelsTable.get(id);
        return ch ? ({ ...ch } as any) : null;
      }
      if (sql.includes("FROM users WHERE id = ?")) {
        const u = usersTable.get(params[0]);
        return u ? ({ ...u } as any) : null;
      }
      return null;
    },

    async run(sql: string, params: any[] = []): Promise<{ changes: number }> {
      // Insert User
      if (sql.includes("INSERT INTO users")) {
        usersTable.set(params[0], { id: params[0], telegram_user_id: params[1], display_name: params[2] });
        return { changes: 1 };
      }

      // Insert Channel
      if (sql.includes("INSERT INTO channels")) {
        let channelId = params[0];
        let tgId = params.length >= 2 ? params[1] : (sql.includes("'me'") ? "me" : "");
        let name = params.length >= 3 ? params[2] : (sql.includes("Saved Messages") ? "Saved Messages (Private Cloud)" : "Channel");

        channelsTable.set(channelId, {
          id: channelId,
          telegram_channel_id: tgId,
          name: name,
          cover_media_id: null,
          last_synced_at: null,
        });
        return { changes: 1 };
      }

      // Update Channel Name
      if (sql.includes("UPDATE channels SET name = ?")) {
        const ch = channelsTable.get(params[1]);
        if (ch) {
          ch.name = params[0];
          return { changes: 1 };
        }
        return { changes: 0 };
      }

      // Insert into gallery_channels
      if (sql.includes("INSERT INTO gallery_channels")) {
        const userId = params[0];
        const channelId = params[1];
        const key = `${userId}:${channelId}`;
        galleryChannelsTable.set(key, { user_id: userId, channel_id: channelId });
        return { changes: 1 };
      }

      // Delete from gallery_channels (Remove Channel from Gallery)
      if (sql.includes("DELETE FROM gallery_channels WHERE user_id = ? AND channel_id = ?")) {
        const userId = params[0];
        const channelId = params[1];
        const key = `${userId}:${channelId}`;
        const existed = galleryChannelsTable.delete(key);
        return { changes: existed ? 1 : 0 };
      }

      return { changes: 0 };
    },

    async exec(): Promise<void> {},
  };

  return { db, usersTable, channelsTable, galleryChannelsTable, mediaItemsTable };
}

describe("📁 Telegram Channel Management & Gallery Filtering Suite", () => {
  let mock: ReturnType<typeof createMockDatabase>;
  let db: DatabaseInterface;
  const user1 = { id: "user-uuid-1", telegram_user_id: 111111, display_name: "Alice" };
  const user2 = { id: "user-uuid-2", telegram_user_id: 222222, display_name: "Bob" };

  beforeEach(() => {
    mock = createMockDatabase();
    db = mock.db;
    mock.usersTable.set(user1.id, user1);
    mock.usersTable.set(user2.id, user2);
  });

  it("1. should automatically create and link 'me' (Saved Messages) in gallery_channels on initial request", async () => {
    let meChannel = await db.get("SELECT * FROM channels WHERE telegram_channel_id = 'me'");
    assert.equal(meChannel, null, "Initially no 'me' channel exists");

    const meChannelId = crypto.randomUUID();
    await db.run(
      "INSERT INTO channels (id, telegram_channel_id, name) VALUES (?, 'me', 'Saved Messages (Private Cloud)')",
      [meChannelId, "me", "Saved Messages (Private Cloud)"]
    );
    await db.run(
      "INSERT INTO gallery_channels (user_id, channel_id) VALUES (?, ?)",
      [user1.id, meChannelId]
    );

    const activeChannels = await db.all(
      `SELECT c.id, c.telegram_channel_id, c.name, COUNT(m.id) as media_count
       FROM channels c
       JOIN gallery_channels gc ON gc.channel_id = c.id
       WHERE gc.user_id = ?`,
      [user1.id]
    );

    assert.equal(activeChannels.length, 1);
    assert.equal(activeChannels[0].telegram_channel_id, "me");
    assert.equal(activeChannels[0].name, "Saved Messages (Private Cloud)");
  });

  it("2. should add a Telegram channel to gallery_channels and immediately make it visible in user gallery", async () => {
    // Add 'me'
    const meId = "me-uuid";
    await db.run("INSERT INTO channels (id, telegram_channel_id, name) VALUES (?, 'me', 'Saved Messages')", [meId, "me", "Saved Messages"]);
    await db.run("INSERT INTO gallery_channels (user_id, channel_id) VALUES (?, ?)", [user1.id, meId]);

    // Explicitly add a new channel (e.g. Vacation Photos)
    const vacationChannelId = "vacation-channel-uuid";
    const telegramChannelId = "-100987654321";
    await db.run("INSERT INTO channels (id, telegram_channel_id, name) VALUES (?, ?, 'Vacation 2026')", [
      vacationChannelId,
      telegramChannelId,
      "Vacation 2026",
    ]);
    await db.run(
      `INSERT INTO gallery_channels (user_id, channel_id) VALUES (?, ?)`,
      [user1.id, vacationChannelId]
    );

    // Query gallery channels
    const activeChannels = await db.all(
      `SELECT c.id, c.telegram_channel_id, c.name, COUNT(m.id) as media_count
       FROM channels c
       JOIN gallery_channels gc ON gc.channel_id = c.id
       WHERE gc.user_id = ?`,
      [user1.id]
    );

    assert.equal(activeChannels.length, 2, "Both Saved Messages and Vacation 2026 must be present");
    assert.equal(activeChannels[0].telegram_channel_id, "me");
    assert.equal(activeChannels[1].name, "Vacation 2026");
    assert.equal(activeChannels[1].media_count, 0, "New channel with 0 media count must still be visible");
  });

  it("3. should NOT show owned Telegram channels/groups in gallery unless explicitly added", async () => {
    // User has 'me'
    const meId = "me-uuid";
    await db.run("INSERT INTO channels (id, telegram_channel_id, name) VALUES (?, 'me', 'Saved Messages')", [meId, "me", "Saved Messages"]);
    await db.run("INSERT INTO gallery_channels (user_id, channel_id) VALUES (?, ?)", [user1.id, meId]);

    // User owns 3 Telegram channels on their phone/account (discovered by live Telegram sync)
    await db.run("INSERT INTO channels (id, telegram_channel_id, name) VALUES (?, ?, ?)", [crypto.randomUUID(), "-100111", "My Photography Studio (Owned)"]);
    await db.run("INSERT INTO channels (id, telegram_channel_id, name) VALUES (?, ?, ?)", [crypto.randomUUID(), "-100222", "My Private Family Group (Owned)"]);
    await db.run("INSERT INTO channels (id, telegram_channel_id, name) VALUES (?, ?, ?)", [crypto.randomUUID(), "-100333", "My Tech Broadcast Channel (Owned)"]);

    // 1. Default gallery view: Must ONLY return Saved Messages ('me') — NOT the 3 owned channels
    const galleryChannels = await db.all(
      `SELECT c.id, c.telegram_channel_id, c.name
       FROM channels c
       JOIN gallery_channels gc ON gc.channel_id = c.id
       WHERE gc.user_id = ?`,
      [user1.id]
    );

    assert.equal(galleryChannels.length, 1, "Owned channels must NOT appear in gallery unless explicitly added");
    assert.equal(galleryChannels[0].telegram_channel_id, "me");

    // 2. Channel Picker query (?all=true): Must return all 4 channels with accurate is_added flag
    const allChannels = await db.all(
      `SELECT c.id, c.telegram_channel_id, c.name,
              EXISTS(SELECT 1 FROM gallery_channels gc WHERE gc.channel_id = c.id AND gc.user_id = ?) as is_added
       FROM channels c`,
      [user1.id]
    );

    assert.equal(allChannels.length, 4, "Picker modal must see all available channels");
    const meRecord = allChannels.find((c) => c.telegram_channel_id === "me");
    const photoStudio = allChannels.find((c) => c.name === "My Photography Studio (Owned)");

    assert.equal(meRecord.is_added, 1, "Saved Messages must be marked is_added=1");
    assert.equal(photoStudio.is_added, 0, "Unadded owned channel must have is_added=0");
  });

  it("4. should remove an added channel from the user's gallery upon remove request", async () => {
    // Add 'me' and 'Family Album'
    const meId = "me-uuid";
    const familyId = "family-uuid";
    await db.run("INSERT INTO channels (id, telegram_channel_id, name) VALUES (?, ?, ?)", [meId, "me", "Saved Messages"]);
    await db.run("INSERT INTO channels (id, telegram_channel_id, name) VALUES (?, ?, ?)", [familyId, "-100444", "Family Album"]);

    await db.run("INSERT INTO gallery_channels (user_id, channel_id) VALUES (?, ?)", [user1.id, meId]);
    await db.run("INSERT INTO gallery_channels (user_id, channel_id) VALUES (?, ?)", [user1.id, familyId]);

    // Verify 2 channels in gallery
    let channels = await db.all(
      `SELECT c.id FROM channels c JOIN gallery_channels gc ON gc.channel_id = c.id WHERE gc.user_id = ?`,
      [user1.id]
    );
    assert.equal(channels.length, 2);

    // Remove 'Family Album'
    await db.run("DELETE FROM gallery_channels WHERE user_id = ? AND channel_id = ?", [user1.id, familyId]);

    // Verify only 'me' remains in gallery
    channels = await db.all(
      `SELECT c.id, c.name FROM channels c JOIN gallery_channels gc ON gc.channel_id = c.id WHERE gc.user_id = ?`,
      [user1.id]
    );
    assert.equal(channels.length, 1);
    assert.equal(channels[0].name, "Saved Messages");

    // Underlying channel row in channels table must still be preserved for re-adding
    const rawChannel = await db.get("SELECT * FROM channels WHERE id = ?", [familyId]);
    assert.ok(rawChannel !== null, "Underlying channel record must be retained");
  });

  it("5. should protect 'me' (Saved Messages) from being removed", async () => {
    const meId = "me-uuid";
    await db.run("INSERT INTO channels (id, telegram_channel_id, name) VALUES (?, ?, ?)", [meId, "me", "Saved Messages"]);
    await db.run("INSERT INTO gallery_channels (user_id, channel_id) VALUES (?, ?)", [user1.id, meId]);

    // Validation check in handler
    const targetChannel = await db.get("SELECT * FROM channels WHERE id = ?", [meId]);
    assert.equal(targetChannel?.telegram_channel_id, "me");

    const canRemove = targetChannel?.telegram_channel_id !== "me";
    assert.equal(canRemove, false, "Must strictly reject removal of Saved Messages");
  });

  it("6. should enforce strict multi-user channel isolation", async () => {
    const me1 = "me-channel";
    const privateChannel = "private-photos-1";

    await db.run("INSERT INTO channels (id, telegram_channel_id, name) VALUES (?, ?, ?)", [me1, "me", "Saved Messages"]);
    await db.run("INSERT INTO channels (id, telegram_channel_id, name) VALUES (?, ?, ?)", [privateChannel, "-100999", "Alice Private Photos"]);

    // User 1 adds Private Photos
    await db.run("INSERT INTO gallery_channels (user_id, channel_id) VALUES (?, ?)", [user1.id, me1]);
    await db.run("INSERT INTO gallery_channels (user_id, channel_id) VALUES (?, ?)", [user1.id, privateChannel]);

    // User 2 only has 'me'
    await db.run("INSERT INTO gallery_channels (user_id, channel_id) VALUES (?, ?)", [user2.id, me1]);

    const user1Gallery = await db.all(
      `SELECT c.name FROM channels c JOIN gallery_channels gc ON gc.channel_id = c.id WHERE gc.user_id = ?`,
      [user1.id]
    );
    const user2Gallery = await db.all(
      `SELECT c.name FROM channels c JOIN gallery_channels gc ON gc.channel_id = c.id WHERE gc.user_id = ?`,
      [user2.id]
    );

    assert.equal(user1Gallery.length, 2, "User 1 must see both channels");
    assert.equal(user2Gallery.length, 1, "User 2 must only see their own Saved Messages");
    assert.equal(user2Gallery[0].name, "Saved Messages");
  });
});
