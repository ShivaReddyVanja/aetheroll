import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("🗑️ Media Item Deletion & WAL Event Tracking Suite", () => {
  it("1. should cleanly delete media items, tags, and favorites from database", async () => {
    const items = new Map<string, any>();
    const favorites = new Set<string>();
    const tags = new Set<string>();

    const mediaId1 = "media-1";
    const mediaId2 = "media-2";

    items.set(mediaId1, { id: mediaId1, telegram_message_id: 101 });
    items.set(mediaId2, { id: mediaId2, telegram_message_id: 102 });
    favorites.add(`fav-${mediaId1}`);
    tags.add(`tag-${mediaId1}`);

    const deleteMedia = async (ids: string[]) => {
      for (const id of ids) {
        items.delete(id);
        favorites.delete(`fav-${id}`);
        tags.delete(`tag-${id}`);
      }
      return { success: true, deletedCount: ids.length };
    };

    const res = await deleteMedia([mediaId1]);
    assert.equal(res.deletedCount, 1);
    assert.equal(items.has(mediaId1), false);
    assert.equal(items.has(mediaId2), true);
    assert.equal(favorites.has(`fav-${mediaId1}`), false);
    assert.equal(tags.has(`tag-${mediaId1}`), false);
  });

  it("2. should collect both parent media message ID and all linked WAL event message IDs for Telegram batch deletion", async () => {
    // Simulated DB tables
    const mediaItems = new Map<string, { id: string; channelId: string; telegramMsgId: number }>();
    const mediaEventMessages = new Map<string, { mediaItemId: string; eventMsgId: number }>();

    // Media 1 has photo message 100, favorite event 101, and tag event 102
    mediaItems.set("media-1", { id: "media-1", channelId: "-1001", telegramMsgId: 100 });
    mediaEventMessages.set("evt-1", { mediaItemId: "media-1", eventMsgId: 101 });
    mediaEventMessages.set("evt-2", { mediaItemId: "media-1", eventMsgId: 102 });

    // Media 2 has photo message 200 and location event 201
    mediaItems.set("media-2", { id: "media-2", channelId: "-1001", telegramMsgId: 200 });
    mediaEventMessages.set("evt-3", { mediaItemId: "media-2", eventMsgId: 201 });

    const deletedTelegramMessageIds: number[] = [];

    const deleteMediaBatch = async (mediaIds: string[]) => {
      const tgMsgIdsToDelete: number[] = [];

      for (const id of mediaIds) {
        const item = mediaItems.get(id);
        if (item) {
          tgMsgIdsToDelete.push(item.telegramMsgId);
        }
        // Query linked WAL event message IDs
        for (const [evtId, evt] of mediaEventMessages.entries()) {
          if (evt.mediaItemId === id) {
            tgMsgIdsToDelete.push(evt.eventMsgId);
            mediaEventMessages.delete(evtId);
          }
        }
        mediaItems.delete(id);
      }

      deletedTelegramMessageIds.push(...tgMsgIdsToDelete);
      return { success: true, deletedCount: mediaIds.length, deletedTgMsgIds: tgMsgIdsToDelete };
    };

    const res = await deleteMediaBatch(["media-1"]);

    assert.equal(res.success, true);
    assert.equal(res.deletedCount, 1);
    // Deleted message IDs must include parent 100, favorite 101, and tag 102
    assert.deepEqual(deletedTelegramMessageIds.sort(), [100, 101, 102]);
    assert.equal(mediaItems.has("media-1"), false);
    assert.equal(mediaEventMessages.has("evt-1"), false);
    assert.equal(mediaEventMessages.has("evt-2"), false);

    // Media-2 and its event 201 remain untouched
    assert.equal(mediaItems.has("media-2"), true);
    assert.equal(mediaEventMessages.has("evt-3"), true);
  });
});
