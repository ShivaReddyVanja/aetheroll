import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import crypto from "crypto";
import { getDb } from "../lib/db";

export const tagsRouter = new Hono();

async function getAuthUserId(c: any): Promise<string> {
  const token = getCookie(c, "tg_session");
  if (!token) throw new Error("Unauthorized");

  const db = getDb((c.env as any)?.DB);
  const session = await db.get(
    `SELECT user_id FROM user_sessions WHERE id = ? AND expires_at > CURRENT_TIMESTAMP`,
    [token]
  );
  if (!session) throw new Error("Unauthorized");
  return session.user_id;
}

// -------------------------------------------------------------
// PEOPLE TAGS
// -------------------------------------------------------------

/**
 * GET /api/tags/people?channel_id=...
 */
tagsRouter.get("/people", async (c) => {
  try {
    const channelId = c.req.query("channel_id");
    if (!channelId) return c.json({ error: "channel_id is required" }, 400);

    const db = getDb((c.env as any)?.DB);
    const people = await db.all(
      `SELECT p.*, COUNT(t.id) as media_count
       FROM people p
       LEFT JOIN media_person_tags t ON t.person_id = p.id
       WHERE p.channel_id = ?
       GROUP BY p.id
       ORDER BY p.name ASC`,
      [channelId]
    );

    return c.json({ people });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

/**
 * POST /api/tags/people (Create a person)
 */
tagsRouter.post("/people", async (c) => {
  try {
    const userId = await getAuthUserId(c);
    const { channel_id, name } = await c.req.json();
    if (!channel_id || !name?.trim()) return c.json({ error: "channel_id and name are required" }, 400);

    const db = getDb((c.env as any)?.DB);
    const personId = crypto.randomUUID();

    await db.run(
      "INSERT INTO people (id, channel_id, name, created_by) VALUES (?, ?, ?, ?)",
      [personId, channel_id, name.trim(), userId]
    );

    return c.json({ success: true, person: { id: personId, name: name.trim(), channel_id } });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

/**
 * POST /api/tags/media-person (Tag or untag person on media item)
 */
tagsRouter.post("/media-person", async (c) => {
  try {
    const userId = await getAuthUserId(c);
    const { media_item_id, person_id, bbox, remove } = await c.req.json();
    const db = getDb((c.env as any)?.DB);

    if (remove) {
      await db.run("DELETE FROM media_person_tags WHERE media_item_id = ? AND person_id = ?", [media_item_id, person_id]);
      return c.json({ success: true, action: "removed" });
    }

    const tagId = crypto.randomUUID();
    await db.run(
      `INSERT INTO media_person_tags (id, media_item_id, person_id, bbox_x, bbox_y, bbox_w, bbox_h, tagged_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(media_item_id, person_id) DO UPDATE SET
         bbox_x = excluded.bbox_x,
         bbox_y = excluded.bbox_y,
         bbox_w = excluded.bbox_w,
         bbox_h = excluded.bbox_h`,
      [tagId, media_item_id, person_id, bbox?.x || null, bbox?.y || null, bbox?.w || null, bbox?.h || null, userId]
    );

    return c.json({ success: true, action: "tagged" });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// -------------------------------------------------------------
// LOCATION TAGS
// -------------------------------------------------------------

/**
 * GET /api/tags/locations
 */
tagsRouter.get("/locations", async (c) => {
  try {
    const db = getDb((c.env as any)?.DB);
    const locations = await db.all(
      `SELECT l.*, COUNT(t.id) as media_count
       FROM locations l
       LEFT JOIN media_location_tags t ON t.location_id = l.id
       GROUP BY l.id
       ORDER BY media_count DESC, l.name ASC`
    );
    return c.json({ locations });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

/**
 * POST /api/tags/media-location (Attach location to media item)
 */
tagsRouter.post("/media-location", async (c) => {
  try {
    const userId = await getAuthUserId(c);
    const { media_item_id, name, latitude, longitude, place_type, source, location_id, remove } = await c.req.json();
    const db = getDb((c.env as any)?.DB);

    if (remove && location_id) {
      await db.run("DELETE FROM media_location_tags WHERE media_item_id = ? AND location_id = ?", [media_item_id, location_id]);
      return c.json({ success: true, action: "removed" });
    }

    let targetLocationId = location_id;
    if (!targetLocationId && name) {
      // Find or create location
      let loc = await db.get("SELECT id FROM locations WHERE name = ?", [name.trim()]);
      if (!loc) {
        targetLocationId = crypto.randomUUID();
        await db.run(
          "INSERT INTO locations (id, name, latitude, longitude, place_type) VALUES (?, ?, ?, ?, ?)",
          [targetLocationId, name.trim(), latitude || null, longitude || null, place_type || "custom"]
        );
      } else {
        targetLocationId = loc.id;
      }
    }

    if (!targetLocationId) return c.json({ error: "Invalid location" }, 400);

    const tagId = crypto.randomUUID();
    await db.run(
      `INSERT INTO media_location_tags (id, media_item_id, location_id, source, tagged_by)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(media_item_id, location_id) DO NOTHING`,
      [tagId, media_item_id, targetLocationId, source || "manual", userId]
    );

    return c.json({ success: true, action: "tagged", locationId: targetLocationId });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// -------------------------------------------------------------
// EVENT TAGS
// -------------------------------------------------------------

/**
 * GET /api/tags/events?channel_id=...
 */
tagsRouter.get("/events", async (c) => {
  try {
    const channelId = c.req.query("channel_id");
    if (!channelId) return c.json({ error: "channel_id is required" }, 400);

    const db = getDb((c.env as any)?.DB);
    const events = await db.all(
      `SELECT e.*, COUNT(t.id) as media_count
       FROM events e
       LEFT JOIN media_event_tags t ON t.event_id = e.id
       WHERE e.channel_id = ?
       GROUP BY e.id
       ORDER BY e.name ASC`,
      [channelId]
    );

    return c.json({ events });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

/**
 * POST /api/tags/events (Create a new event)
 */
tagsRouter.post("/events", async (c) => {
  try {
    const userId = await getAuthUserId(c);
    const { channel_id, name, description } = await c.req.json();
    if (!channel_id || !name?.trim()) return c.json({ error: "channel_id and name are required" }, 400);

    const db = getDb((c.env as any)?.DB);
    const eventId = crypto.randomUUID();

    await db.run(
      "INSERT INTO events (id, channel_id, name, description, created_by) VALUES (?, ?, ?, ?, ?)",
      [eventId, channel_id, name.trim(), description || null, userId]
    );

    return c.json({ success: true, event: { id: eventId, name: name.trim(), channel_id } });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

/**
 * POST /api/tags/media-event (Tag or untag event on media item)
 */
tagsRouter.post("/media-event", async (c) => {
  try {
    const userId = await getAuthUserId(c);
    const { media_item_id, event_id, remove } = await c.req.json();
    const db = getDb((c.env as any)?.DB);

    if (remove) {
      await db.run("DELETE FROM media_event_tags WHERE media_item_id = ? AND event_id = ?", [media_item_id, event_id]);
      return c.json({ success: true, action: "removed" });
    }

    const tagId = crypto.randomUUID();
    await db.run(
      `INSERT INTO media_event_tags (id, media_item_id, event_id, tagged_by)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(media_item_id, event_id) DO NOTHING`,
      [tagId, media_item_id, event_id, userId]
    );

    return c.json({ success: true, action: "tagged" });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});
