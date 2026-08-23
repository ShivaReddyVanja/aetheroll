import crypto from "crypto";
import type { DatabaseInterface } from "../db.ts";
import type {
  GalleryOpType,
  GalleryEventPayload,
  GalleryEvent,
  GalleryOp,
} from "./types.ts";

/**
 * Replays single op for target media items in the D1 database scoped to channel
 */
export async function applyOpToDb(
  db: DatabaseInterface,
  channelId: string,
  userId: string,
  refMsgId: number,
  op: GalleryOpType,
  data: GalleryEventPayload
): Promise<boolean> {
  const mediaItem = await db.get(
    "SELECT id FROM media_items WHERE channel_id = ? AND telegram_message_id = ?",
    [channelId, refMsgId]
  );

  if (!mediaItem) return false;
  const mediaId = mediaItem.id;

  // 1. Media attributes
  if (data.blur_hash) {
    await db.run("UPDATE media_items SET blur_hash = ? WHERE id = ?", [data.blur_hash, mediaId]);
  }
  if (data.captured_at) {
    await db.run("UPDATE media_items SET captured_at = ? WHERE id = ?", [data.captured_at, mediaId]);
  }

  // 2. Inline Geo Location
  if (data.gps && typeof data.gps.lat === "number" && typeof data.gps.lng === "number") {
    await db.run(
      "UPDATE media_items SET latitude = ?, longitude = ?, altitude = ? WHERE id = ?",
      [data.gps.lat, data.gps.lng, data.gps.alt || null, mediaId]
    );
  }

  // 3. Favorites
  if (data.fav !== undefined) {
    if (data.fav) {
      await db.run(
        "INSERT INTO media_favorites (user_id, media_item_id) VALUES (?, ?) ON CONFLICT DO NOTHING",
        [userId, mediaId]
      );
    } else {
      await db.run(
        "DELETE FROM media_favorites WHERE user_id = ? AND media_item_id = ?",
        [userId, mediaId]
      );
    }
  }

  // 4. People Tags (scoped to channelId)
  if (data.people && Array.isArray(data.people)) {
    for (const personName of data.people) {
      if (!personName.trim()) continue;
      let personRow = await db.get(
        "SELECT id FROM people WHERE channel_id = ? AND name = ?",
        [channelId, personName.trim()]
      );
      const personId = personRow?.id || crypto.randomUUID();

      if (!personRow) {
        await db.run(
          "INSERT INTO people (id, channel_id, name, created_by, user_id) VALUES (?, ?, ?, ?, ?)",
          [personId, channelId, personName.trim(), userId, userId]
        );
      }

      await db.run(
        "INSERT INTO media_person_tags (id, media_item_id, person_id, tagged_by) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING",
        [crypto.randomUUID(), mediaId, personId, userId]
      );
    }
  }

  // 5. Events (scoped to channelId)
  if (data.event && data.event.trim()) {
    let eventRow = await db.get(
      "SELECT id FROM events WHERE channel_id = ? AND name = ?",
      [channelId, data.event.trim()]
    );
    const eventId = eventRow?.id || crypto.randomUUID();

    if (!eventRow) {
      await db.run(
        "INSERT INTO events (id, channel_id, name, created_by, user_id) VALUES (?, ?, ?, ?, ?)",
        [eventId, channelId, data.event.trim(), userId, userId]
      );
    }

    await db.run(
      "INSERT INTO media_event_tags (id, media_item_id, event_id, tagged_by) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING",
      [crypto.randomUUID(), mediaId, eventId, userId]
    );
  }

  // 6. User-defined Tags (scoped to channelId)
  if (data.tags && Array.isArray(data.tags)) {
    for (const tagName of data.tags) {
      if (!tagName.trim()) continue;
      let tagRow = await db.get(
        "SELECT id FROM tags WHERE channel_id = ? AND name = ?",
        [channelId, tagName.trim()]
      );
      const tagId = tagRow?.id || crypto.randomUUID();

      if (!tagRow) {
        await db.run(
          "INSERT INTO tags (id, channel_id, user_id, name) VALUES (?, ?, ?, ?)",
          [tagId, channelId, userId, tagName.trim()]
        );
      }

      await db.run(
        "INSERT INTO media_tags (media_item_id, tag_id, tagged_by) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
        [mediaId, tagId, userId]
      );
    }
  }

  // 7. Trips (scoped to channelId)
  if (data.trip && data.trip.trim()) {
    let tripRow = await db.get(
      "SELECT id FROM trips WHERE channel_id = ? AND name = ?",
      [channelId, data.trip.trim()]
    );
    const tripId = tripRow?.id || crypto.randomUUID();

    if (!tripRow) {
      await db.run(
        "INSERT INTO trips (id, channel_id, user_id, name) VALUES (?, ?, ?, ?)",
        [tripId, channelId, userId, data.trip.trim()]
      );
    }

    await db.run(
      "INSERT INTO trip_media (media_item_id, trip_id, added_by) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
      [mediaId, tripId, userId]
    );
  }

  // 8. Delete
  if (op === "DELETE" || data.deleted) {
    await db.run("UPDATE media_items SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?", [mediaId]);
  }

  return true;
}

/**
 * Replays a collection of chronological events into the D1 database for a specific channel
 */
export async function applyGalleryEventsToDb(
  db: DatabaseInterface,
  channelId: string,
  userId: string,
  events: GalleryEvent[]
): Promise<number> {
  let appliedCount = 0;
  const sortedEvents = [...events].sort((a, b) => (a.ts || 0) - (b.ts || 0));

  for (const event of sortedEvents) {
    const success = await applyOpToDb(
      db,
      channelId,
      userId,
      event.ref,
      event.op,
      event.data
    );
    if (success) appliedCount++;
  }

  return appliedCount;
}

/**
 * Replays a batch of operations into the D1 database
 */
export async function applyGalleryBatch(
  db: DatabaseInterface,
  channelId: string,
  userId: string,
  ops: GalleryOp[]
): Promise<number> {
  let appliedCount = 0;

  for (const op of ops) {
    if (!Array.isArray(op.refs)) continue;
    for (const refMsgId of op.refs) {
      const success = await applyOpToDb(
        db,
        channelId,
        userId,
        refMsgId,
        op.op,
        op.data
      );
      if (success) appliedCount++;
    }
  }

  return appliedCount;
}
