import { TelegramClient } from "telegram";
import { DatabaseInterface } from "./db";

export interface GalleryEventPayload {
  blur_hash?: string;
  captured_at?: string;
  gps?: {
    lat: number;
    lng: number;
    name?: string;
  };
  people?: string[];
  event?: string;
  fav?: boolean;
  deleted?: boolean;
}

export interface GalleryEvent {
  _t: "GP_EVENT";
  v: number;
  ref: number; // Telegram Message ID of the target media item
  op: "CREATE" | "TAG_PEOPLE" | "SET_LOCATION" | "SET_EVENT" | "FAVORITE" | "DELETE";
  data: GalleryEventPayload;
  ts: number;
}

const EVENT_TAG_PREFIX = "[GP_EVENT:v1]";

/**
 * Emits a structured event payload to the Telegram channel linked to a media message
 */
export async function emitGalleryEvent(
  client: TelegramClient,
  targetPeer: any,
  refMsgId: number,
  op: GalleryEvent["op"],
  data: GalleryEventPayload
): Promise<number | null> {
  try {
    const eventObj: GalleryEvent = {
      _t: "GP_EVENT",
      v: 1,
      ref: refMsgId,
      op,
      data,
      ts: Math.floor(Date.now() / 1000),
    };

    const messageText = `${EVENT_TAG_PREFIX}\n${JSON.stringify(eventObj, null, 2)}`;

    // Send as a reply to the media item so it's threaded in Telegram
    const sent = await client.sendMessage(targetPeer, {
      message: messageText,
      replyTo: refMsgId,
    });

    return sent.id;
  } catch (err) {
    console.error(`[EventLedger] Failed to emit event ${op} for msg ${refMsgId}:`, err);
    return null;
  }
}

/**
 * Parses a Telegram message to see if it is a valid Gallery Event
 */
export function parseGalleryEvent(text?: string): GalleryEvent | null {
  if (!text || !text.includes(EVENT_TAG_PREFIX)) return null;

  try {
    const jsonStr = text.substring(text.indexOf(EVENT_TAG_PREFIX) + EVENT_TAG_PREFIX.length).trim();
    const parsed = JSON.parse(jsonStr);
    if (parsed && parsed._t === "GP_EVENT" && typeof parsed.ref === "number") {
      return parsed as GalleryEvent;
    }
  } catch (e) {
    // Malformed JSON event message
  }
  return null;
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

  // Sort chronologically
  const sortedEvents = [...events].sort((a, b) => (a.ts || 0) - (b.ts || 0));

  for (const event of sortedEvents) {
    const mediaItem = await db.get(
      "SELECT id FROM media_items WHERE channel_id = ? AND telegram_message_id = ?",
      [channelId, event.ref]
    );

    if (!mediaItem) continue;
    const mediaId = mediaItem.id;
    const data = event.data;

    // Apply OP: CREATE / UPDATE_META
    if (event.op === "CREATE" || event.op === "TAG_PEOPLE" || event.op === "SET_LOCATION" || event.op === "SET_EVENT" || event.op === "FAVORITE") {
      // 1. Update basic media attributes if present
      if (data.blur_hash) {
        await db.run("UPDATE media_items SET blur_hash = ? WHERE id = ?", [data.blur_hash, mediaId]);
      }
      if (data.captured_at) {
        await db.run("UPDATE media_items SET captured_at = ? WHERE id = ?", [data.captured_at, mediaId]);
      }

      // 2. Favorite state
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

      // 3. Location tags
      if (data.gps && typeof data.gps.lat === "number" && typeof data.gps.lng === "number") {
        const locationName = data.gps.name || `GPS (${data.gps.lat.toFixed(4)}, ${data.gps.lng.toFixed(4)})`;
        let locRow = await db.get("SELECT id FROM locations WHERE name = ?", [locationName]);
        const locId = locRow?.id || crypto.randomUUID();

        if (!locRow) {
          await db.run(
            "INSERT INTO locations (id, name, latitude, longitude) VALUES (?, ?, ?, ?)",
            [locId, locationName, data.gps.lat, data.gps.lng]
          );
        }

        await db.run(
          "INSERT INTO media_location_tags (media_item_id, location_id) VALUES (?, ?) ON CONFLICT DO NOTHING",
          [mediaId, locId]
        );
      }

      // 4. Person tags
      if (data.people && Array.isArray(data.people)) {
        for (const personName of data.people) {
          if (!personName.trim()) continue;
          let personRow = await db.get("SELECT id FROM people WHERE name = ?", [personName.trim()]);
          const personId = personRow?.id || crypto.randomUUID();

          if (!personRow) {
            await db.run("INSERT INTO people (id, name) VALUES (?, ?)", [personId, personName.trim()]);
          }

          await db.run(
            "INSERT INTO media_person_tags (media_item_id, person_id) VALUES (?, ?) ON CONFLICT DO NOTHING",
            [mediaId, personId]
          );
        }
      }

      // 5. Event tags
      if (data.event && data.event.trim()) {
        let eventRow = await db.get("SELECT id FROM events WHERE name = ?", [data.event.trim()]);
        const eventId = eventRow?.id || crypto.randomUUID();

        if (!eventRow) {
          await db.run("INSERT INTO events (id, name) VALUES (?, ?)", [eventId, data.event.trim()]);
        }

        await db.run(
          "INSERT INTO media_event_tags (media_item_id, event_id) VALUES (?, ?) ON CONFLICT DO NOTHING",
          [mediaId, eventId]
        );
      }

      appliedCount++;
    }

    // Apply OP: DELETE
    if (event.op === "DELETE" || data.deleted) {
      await db.run("UPDATE media_items SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?", [mediaId]);
      appliedCount++;
    }
  }

  return appliedCount;
}
