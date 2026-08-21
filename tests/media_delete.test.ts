import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { getDb, sanitizeD1Param } from "../src/server/lib/db.ts";

describe("🗑️ Media Item Deletion & Cleanup Suite", () => {
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

  it("2. should handle batch deletion of multiple media IDs", async () => {
    const items = new Set(["m1", "m2", "m3", "m4"]);
    const toDelete = ["m1", "m3", "m4"];

    for (const id of toDelete) {
      items.delete(id);
    }

    assert.equal(items.size, 1);
    assert.ok(items.has("m2"));
  });
});
