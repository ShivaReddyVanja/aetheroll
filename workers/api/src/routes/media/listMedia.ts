import { Hono } from "hono";
import { getDb } from "../../lib/db";
import { resolveUserAuth } from "../../lib/auth";

export const listMediaRoute = new Hono();

/**
 * GET /
 * Query parameters:
 *  - channel_id: string (required)
 *  - limit: number (default 50)
 *  - cursor: string (ISO timestamp for keyset pagination)
 *  - person_id: optional filter
 *  - location_id: optional filter
 *  - event_id: optional filter
 *  - favorites_only: boolean
 */
listMediaRoute.get("/", async (c) => {
  try {
    const auth = await resolveUserAuth(c);
    if (!auth.authenticated || !auth.userId) return c.json({ error: "Unauthorized" }, 401);

    const db = getDb((c.env as any)?.DB);
    const channelId = c.req.query("channel_id");
    if (!channelId) return c.json({ error: "channel_id is required" }, 400);

    // Verify channel access
    const channelAccess = await db.get(
      `SELECT 1 FROM channels c
       JOIN gallery_channels gc ON gc.channel_id = c.id
       WHERE c.id = ? AND gc.user_id = ?`,
      [channelId, auth.userId]
    );
    if (!channelAccess) {
      return c.json({ error: "Channel not found or unauthorized" }, 404);
    }

    const limit = Math.min(parseInt(c.req.query("limit") || "50", 10), 100);
    const cursor = c.req.query("cursor");
    const fileType = c.req.query("file_type"); // "photo" | "video"
    const personId = c.req.query("person_id");
    const locationId = c.req.query("location_id");
    const eventId = c.req.query("event_id");
    const tagId = c.req.query("tag_id");
    const tripId = c.req.query("trip_id");
    const hasGeo = c.req.query("has_geo") === "true";
    const favoritesOnly = c.req.query("favorites_only") === "true";

    let query = `
      SELECT m.*,
             CASE WHEN f.user_id IS NOT NULL THEN 1 ELSE 0 END as is_favorite,
             u.display_name as uploader_name,
             (
               SELECT GROUP_CONCAT(p.id || '::' || p.name || '::' || COALESCE(t.bbox_x, '') || '::' || COALESCE(t.bbox_y, '') || '::' || COALESCE(t.bbox_w, '') || '::' || COALESCE(t.bbox_h, ''), '||')
               FROM media_person_tags t
               JOIN people p ON p.id = t.person_id
               WHERE t.media_item_id = m.id
             ) as people_raw,
             (
               SELECT GROUP_CONCAT(tg.id || '::' || tg.name || '::' || COALESCE(tg.color, ''), '||')
               FROM media_tags mt
               JOIN tags tg ON tg.id = mt.tag_id
               WHERE mt.media_item_id = m.id
             ) as tags_raw,
             (
               SELECT GROUP_CONCAT(e.id || '::' || e.name, '||')
               FROM media_event_tags et
               JOIN events e ON e.id = et.event_id
               WHERE et.media_item_id = m.id
             ) as events_raw,
             (
               SELECT GROUP_CONCAT(tr.id || '::' || tr.name, '||')
               FROM trip_media tm
               JOIN trips tr ON tr.id = tm.trip_id
               WHERE tm.media_item_id = m.id
             ) as trips_raw
      FROM media_items m
      LEFT JOIN users u ON u.id = m.uploader_user_id
      LEFT JOIN media_favorites f ON f.media_item_id = m.id AND f.user_id = ?
      WHERE m.channel_id = ? AND m.deleted_at IS NULL
    `;
    const params: any[] = [auth.userId, channelId];

    if (fileType === "photo" || fileType === "video") {
      query += ` AND m.file_type = ?`;
      params.push(fileType);
    }

    if (cursor) {
      query += ` AND m.captured_at < ?`;
      params.push(cursor);
    }

    if (favoritesOnly) {
      query += ` AND f.user_id IS NOT NULL`;
    }

    if (personId) {
      query += ` AND m.id IN (SELECT media_item_id FROM media_person_tags WHERE person_id = ?)`;
      params.push(personId);
    }

    if (locationId) {
      query += ` AND (m.latitude IS NOT NULL AND m.longitude IS NOT NULL)`;
    }

    if (hasGeo) {
      query += ` AND m.latitude IS NOT NULL AND m.longitude IS NOT NULL`;
    }

    if (eventId) {
      query += ` AND m.id IN (SELECT media_item_id FROM media_event_tags WHERE event_id = ?)`;
      params.push(eventId);
    }

    if (tagId) {
      query += ` AND m.id IN (SELECT media_item_id FROM media_tags WHERE tag_id = ?)`;
      params.push(tagId);
    }

    if (tripId) {
      query += ` AND m.id IN (SELECT media_item_id FROM trip_media WHERE trip_id = ?)`;
      params.push(tripId);
    }

    query += ` ORDER BY m.captured_at DESC, m.id DESC LIMIT ?`;
    params.push(limit);

    const items = await db.all(query, params);

    // Fast in-memory parsing (1 query total for entire page!)
    for (const item of items) {
      item.people = item.people_raw
        ? item.people_raw.split("||").map((p: string) => {
            const [id, name, bx, by, bw, bh] = p.split("::");
            return {
              id,
              name,
              bbox_x: bx ? parseFloat(bx) : null,
              bbox_y: by ? parseFloat(by) : null,
              bbox_w: bw ? parseFloat(bw) : null,
              bbox_h: bh ? parseFloat(bh) : null,
            };
          })
        : [];
      delete item.people_raw;

      item.tags = item.tags_raw
        ? item.tags_raw.split("||").map((t: string) => {
            const [id, name, color] = t.split("::");
            return { id, name, color: color || null };
          })
        : [];
      delete item.tags_raw;

      item.events = item.events_raw
        ? item.events_raw.split("||").map((e: string) => {
            const [id, name] = e.split("::");
            return { id, name };
          })
        : [];
      delete item.events_raw;

      item.trips = item.trips_raw
        ? item.trips_raw.split("||").map((tr: string) => {
            const [id, name] = tr.split("::");
            return { id, name };
          })
        : [];
      delete item.trips_raw;

      if (item.latitude != null && item.longitude != null) {
        item.locations = [
          {
            id: `geo_${item.id}`,
            name: `GPS (${Number(item.latitude).toFixed(4)}, ${Number(item.longitude).toFixed(4)})`,
            latitude: item.latitude,
            longitude: item.longitude,
            place_type: "gps",
          },
        ];
      } else {
        item.locations = [];
      }
    }

    const nextCursor = items.length === limit ? items[items.length - 1].captured_at : null;

    return c.json({ items, nextCursor });
  } catch (error: any) {
    return c.json({ error: error.message || "Failed to fetch media" }, 500);
  }
});
