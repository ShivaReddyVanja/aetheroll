import { Hono } from "hono";
import crypto from "crypto";
import { getDb } from "../lib/db";
import { resolveUserAuth } from "../lib/auth";
import { getConnectedClient, getDefaultTelegramConfig } from "../lib/telegram";
import { emitGalleryEvent, emitGalleryBatch, GalleryOp } from "../lib/ledger";

export const tagsRouter = new Hono();

async function getAuthContext(c: any) {
  const auth = await resolveUserAuth(c);
  if (!auth.authenticated || !auth.userId) throw new Error("Unauthorized");

  const db = getDb((c.env as any)?.DB);
  return {
    user: {
      id: auth.userId,
      telegram_user_id: auth.telegramUserId,
      display_name: auth.displayName,
      session_string: auth.sessionString,
    },
    auth,
    db,
    env: c.env,
  };
}

async function getTargetPeer(client: any, channelIdStr: string) {
  if (channelIdStr === "me" || channelIdStr.startsWith("me_")) {
    return "me";
  }
  try {
    return await client.getInputEntity(channelIdStr);
  } catch {
    try {
      return await client.getEntity(channelIdStr);
    } catch {
      return channelIdStr;
    }
  }
}

// =============================================================
// 1. PEOPLE TAGS
// =============================================================

/**
 * GET /api/tags/people?channel_id=...
 */
tagsRouter.get("/people", async (c) => {
  try {
    const channelId = c.req.query("channel_id");
    if (!channelId) return c.json({ error: "channel_id is required" }, 400);

    const db = getDb((c.env as any)?.DB);
    const people = await db.all(
      `SELECT p.*, COUNT(t.media_item_id) as media_count
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
    const { user, db } = await getAuthContext(c);
    const { channel_id, name } = await c.req.json();
    if (!channel_id || !name?.trim()) return c.json({ error: "channel_id and name are required" }, 400);

    const personId = crypto.randomUUID();

    await db.run(
      "INSERT INTO people (id, channel_id, name, created_by, user_id) VALUES (?, ?, ?, ?, ?)",
      [personId, channel_id, name.trim(), user.id, user.id]
    );

    return c.json({ success: true, person: { id: personId, name: name.trim(), channel_id } });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

/**
 * POST /api/tags/media-person (Tag or untag person on media items)
 */
tagsRouter.post("/media-person", async (c) => {
  try {
    const { user, auth, db } = await getAuthContext(c);
    const body = await c.req.json();
    const { person_id, bbox, remove } = body;
    const mediaItemIds: string[] = Array.isArray(body.media_item_ids)
      ? body.media_item_ids
      : body.media_item_id
      ? [body.media_item_id]
      : [];

    if (mediaItemIds.length === 0 || !person_id) {
      return c.json({ error: "media_item_ids and person_id are required" }, 400);
    }

    const person = await db.get("SELECT name, channel_id FROM people WHERE id = ?", [person_id]);
    if (!person) return c.json({ error: "Person not found" }, 404);

    if (remove) {
      for (const mId of mediaItemIds) {
        await db.run("DELETE FROM media_person_tags WHERE media_item_id = ? AND person_id = ?", [mId, person_id]);
      }
    } else {
      for (const mId of mediaItemIds) {
        const tagId = crypto.randomUUID();
        await db.run(
          `INSERT INTO media_person_tags (id, media_item_id, person_id, bbox_x, bbox_y, bbox_w, bbox_h, tagged_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(media_item_id, person_id) DO UPDATE SET
             bbox_x = excluded.bbox_x,
             bbox_y = excluded.bbox_y,
             bbox_w = excluded.bbox_w,
             bbox_h = excluded.bbox_h`,
          [tagId, mId, person_id, bbox?.x || null, bbox?.y || null, bbox?.w || null, bbox?.h || null, user.id]
        );
      }
    }

    // Telegram WAL / Batch ledger emit
    try {
      if (auth.sessionString && !remove) {
        const placeholders = mediaItemIds.map(() => "?").join(",");
        const mediaItems = await db.all(
          `SELECT m.id, m.telegram_message_id, c.telegram_channel_id FROM media_items m
           JOIN channels c ON c.id = m.channel_id WHERE m.id IN (${placeholders})`,
          mediaItemIds
        );

        if (mediaItems.length > 0) {
          const client = await getConnectedClient(auth.sessionString, auth.telegramConfig);
          const channelTgId = mediaItems[0].telegram_channel_id;
          const targetPeer = await getTargetPeer(client, channelTgId);

          if (mediaItems.length >= 5) {
            // Batch document upload for >= 5 photos
            const ops: GalleryOp[] = [
              {
                op: "TAG_PEOPLE",
                refs: mediaItems.map((m: any) => m.telegram_message_id),
                data: { people: [person.name] },
              },
            ];
            await emitGalleryBatch(client, targetPeer, channelTgId, ops, (c.env as any)?.MASTER_ENCRYPTION_KEY);
          } else {
            // Threaded reply for < 5 photos
            for (const item of mediaItems) {
              await emitGalleryEvent(client, targetPeer, item.telegram_message_id, "TAG_PEOPLE", {
                people: [person.name],
              }, (c.env as any)?.MASTER_ENCRYPTION_KEY);
            }
          }
        }
      }
    } catch (e) {
      console.warn("[EventLedger] Failed emitting person tag WAL:", e);
    }

    return c.json({ success: true, action: remove ? "removed" : "tagged", count: mediaItemIds.length });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// =============================================================
// 2. USER-DEFINED TAGS
// =============================================================

/**
 * GET /api/tags/user-tags?channel_id=...
 */
tagsRouter.get("/user-tags", async (c) => {
  try {
    const channelId = c.req.query("channel_id");
    if (!channelId) return c.json({ error: "channel_id is required" }, 400);

    const db = getDb((c.env as any)?.DB);
    const tags = await db.all(
      `SELECT t.*, COUNT(mt.media_item_id) as media_count
       FROM tags t
       LEFT JOIN media_tags mt ON mt.tag_id = t.id
       WHERE t.channel_id = ?
       GROUP BY t.id
       ORDER BY t.name ASC`,
      [channelId]
    );

    return c.json({ tags });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

/**
 * POST /api/tags/user-tags (Create a user-defined tag)
 */
tagsRouter.post("/user-tags", async (c) => {
  try {
    const { user, db } = await getAuthContext(c);
    const { channel_id, name, color } = await c.req.json();
    if (!channel_id || !name?.trim()) return c.json({ error: "channel_id and name are required" }, 400);

    const tagId = crypto.randomUUID();

    await db.run(
      `INSERT INTO tags (id, channel_id, user_id, name, color)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(channel_id, name) DO UPDATE SET color = COALESCE(excluded.color, tags.color)`,
      [tagId, channel_id, user.id, name.trim(), color || null]
    );

    const tag = await db.get("SELECT * FROM tags WHERE channel_id = ? AND name = ?", [channel_id, name.trim()]);
    return c.json({ success: true, tag });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

/**
 * DELETE /api/tags/user-tags/:id (Delete a user tag)
 */
tagsRouter.delete("/user-tags/:id", async (c) => {
  try {
    const { db } = await getAuthContext(c);
    const tagId = c.req.param("id");

    await db.run("DELETE FROM media_tags WHERE tag_id = ?", [tagId]);
    await db.run("DELETE FROM tags WHERE id = ?", [tagId]);

    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

/**
 * POST /api/tags/media-tag (Apply or remove tag on media items)
 */
tagsRouter.post("/media-tag", async (c) => {
  try {
    const { user, auth, db } = await getAuthContext(c);
    const body = await c.req.json();
    const { tag_id, remove } = body;
    const mediaItemIds: string[] = Array.isArray(body.media_item_ids)
      ? body.media_item_ids
      : body.media_item_id
      ? [body.media_item_id]
      : [];

    if (mediaItemIds.length === 0 || !tag_id) {
      return c.json({ error: "media_item_ids and tag_id are required" }, 400);
    }

    const tag = await db.get("SELECT name, channel_id FROM tags WHERE id = ?", [tag_id]);
    if (!tag) return c.json({ error: "Tag not found" }, 404);

    if (remove) {
      for (const mId of mediaItemIds) {
        await db.run("DELETE FROM media_tags WHERE media_item_id = ? AND tag_id = ?", [mId, tag_id]);
      }
    } else {
      for (const mId of mediaItemIds) {
        await db.run(
          "INSERT INTO media_tags (media_item_id, tag_id, tagged_by) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
          [mId, tag_id, user.id]
        );
      }
    }

    // Emit Telegram WAL / Batch ledger event
    try {
      if (auth.sessionString && !remove) {
        const placeholders = mediaItemIds.map(() => "?").join(",");
        const mediaItems = await db.all(
          `SELECT m.id, m.telegram_message_id, c.telegram_channel_id FROM media_items m
           JOIN channels c ON c.id = m.channel_id WHERE m.id IN (${placeholders})`,
          mediaItemIds
        );

        if (mediaItems.length > 0) {
          const client = await getConnectedClient(auth.sessionString, auth.telegramConfig);
          const channelTgId = mediaItems[0].telegram_channel_id;
          const targetPeer = await getTargetPeer(client, channelTgId);

          if (mediaItems.length >= 5) {
            const ops: GalleryOp[] = [
              {
                op: "ADD_TAG",
                refs: mediaItems.map((m: any) => m.telegram_message_id),
                data: { tags: [tag.name] },
              },
            ];
            await emitGalleryBatch(client, targetPeer, channelTgId, ops, (c.env as any)?.MASTER_ENCRYPTION_KEY);
          } else {
            for (const item of mediaItems) {
              await emitGalleryEvent(client, targetPeer, item.telegram_message_id, "ADD_TAG", {
                tags: [tag.name],
              }, (c.env as any)?.MASTER_ENCRYPTION_KEY);
            }
          }
        }
      }
    } catch (e) {
      console.warn("[EventLedger] Failed emitting media tag WAL:", e);
    }

    return c.json({ success: true, action: remove ? "removed" : "tagged", count: mediaItemIds.length });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// =============================================================
// 3. EVENT TAGS
// =============================================================

/**
 * GET /api/tags/events?channel_id=...
 */
tagsRouter.get("/events", async (c) => {
  try {
    const channelId = c.req.query("channel_id");
    if (!channelId) return c.json({ error: "channel_id is required" }, 400);

    const db = getDb((c.env as any)?.DB);
    const events = await db.all(
      `SELECT e.*, COUNT(t.media_item_id) as media_count
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
    const { user, db } = await getAuthContext(c);
    const { channel_id, name, description, event_date } = await c.req.json();
    if (!channel_id || !name?.trim()) return c.json({ error: "channel_id and name are required" }, 400);

    const eventId = crypto.randomUUID();

    await db.run(
      "INSERT INTO events (id, channel_id, name, description, event_date, created_by, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [eventId, channel_id, name.trim(), description || null, event_date || null, user.id, user.id]
    );

    return c.json({ success: true, event: { id: eventId, name: name.trim(), channel_id, event_date } });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

/**
 * POST /api/tags/media-event (Tag or untag event on media items)
 */
tagsRouter.post("/media-event", async (c) => {
  try {
    const { user, auth, db } = await getAuthContext(c);
    const body = await c.req.json();
    const { event_id, remove } = body;
    const mediaItemIds: string[] = Array.isArray(body.media_item_ids)
      ? body.media_item_ids
      : body.media_item_id
      ? [body.media_item_id]
      : [];

    if (mediaItemIds.length === 0 || !event_id) {
      return c.json({ error: "media_item_ids and event_id are required" }, 400);
    }

    const ev = await db.get("SELECT name, channel_id FROM events WHERE id = ?", [event_id]);
    if (!ev) return c.json({ error: "Event not found" }, 404);

    if (remove) {
      for (const mId of mediaItemIds) {
        await db.run("DELETE FROM media_event_tags WHERE media_item_id = ? AND event_id = ?", [mId, event_id]);
      }
    } else {
      for (const mId of mediaItemIds) {
        const tagId = crypto.randomUUID();
        await db.run(
          `INSERT INTO media_event_tags (id, media_item_id, event_id, tagged_by)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(media_item_id, event_id) DO NOTHING`,
          [tagId, mId, event_id, user.id]
        );
      }
    }

    // Emit Telegram WAL / Batch ledger event
    try {
      if (auth.sessionString && !remove) {
        const placeholders = mediaItemIds.map(() => "?").join(",");
        const mediaItems = await db.all(
          `SELECT m.id, m.telegram_message_id, c.telegram_channel_id FROM media_items m
           JOIN channels c ON c.id = m.channel_id WHERE m.id IN (${placeholders})`,
          mediaItemIds
        );

        if (mediaItems.length > 0) {
          const client = await getConnectedClient(auth.sessionString, auth.telegramConfig);
          const channelTgId = mediaItems[0].telegram_channel_id;
          const targetPeer = await getTargetPeer(client, channelTgId);

          if (mediaItems.length >= 5) {
            const ops: GalleryOp[] = [
              {
                op: "SET_EVENT",
                refs: mediaItems.map((m: any) => m.telegram_message_id),
                data: { event: ev.name },
              },
            ];
            await emitGalleryBatch(client, targetPeer, channelTgId, ops, (c.env as any)?.MASTER_ENCRYPTION_KEY);
          } else {
            for (const item of mediaItems) {
              await emitGalleryEvent(client, targetPeer, item.telegram_message_id, "SET_EVENT", {
                event: ev.name,
              }, (c.env as any)?.MASTER_ENCRYPTION_KEY);
            }
          }
        }
      }
    } catch (e) {
      console.warn("[EventLedger] Failed emitting event tag WAL:", e);
    }

    return c.json({ success: true, action: remove ? "removed" : "tagged", count: mediaItemIds.length });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// =============================================================
// 4. GEO LOCATION TAGS
// =============================================================

/**
 * POST /api/tags/media-geo (Update GPS coordinates directly on media items)
 */
tagsRouter.post("/media-geo", async (c) => {
  try {
    const { auth, db } = await getAuthContext(c);
    const body = await c.req.json();
    const { latitude, longitude, altitude } = body;
    const mediaItemIds: string[] = Array.isArray(body.media_item_ids)
      ? body.media_item_ids
      : body.media_item_id
      ? [body.media_item_id]
      : [];

    if (mediaItemIds.length === 0 || latitude == null || longitude == null) {
      return c.json({ error: "media_item_ids, latitude, and longitude are required" }, 400);
    }

    const lat = Number(latitude);
    const lng = Number(longitude);
    const alt = altitude != null ? Number(altitude) : null;

    for (const mId of mediaItemIds) {
      await db.run(
        "UPDATE media_items SET latitude = ?, longitude = ?, altitude = ? WHERE id = ?",
        [lat, lng, alt, mId]
      );
    }

    // Emit Telegram WAL
    try {
      if (auth.sessionString) {
        const placeholders = mediaItemIds.map(() => "?").join(",");
        const mediaItems = await db.all(
          `SELECT m.id, m.telegram_message_id, c.telegram_channel_id FROM media_items m
           JOIN channels c ON c.id = m.channel_id WHERE m.id IN (${placeholders})`,
          mediaItemIds
        );

        if (mediaItems.length > 0) {
          const client = await getConnectedClient(auth.sessionString, auth.telegramConfig);
          const channelTgId = mediaItems[0].telegram_channel_id;
          const targetPeer = await getTargetPeer(client, channelTgId);

          if (mediaItems.length >= 5) {
            const ops: GalleryOp[] = [
              {
                op: "SET_LOCATION",
                refs: mediaItems.map((m: any) => m.telegram_message_id),
                data: { gps: { lat, lng, alt: alt || undefined } },
              },
            ];
            await emitGalleryBatch(client, targetPeer, channelTgId, ops, (c.env as any)?.MASTER_ENCRYPTION_KEY);
          } else {
            for (const item of mediaItems) {
              await emitGalleryEvent(client, targetPeer, item.telegram_message_id, "SET_LOCATION", {
                gps: { lat, lng, alt: alt || undefined },
              }, (c.env as any)?.MASTER_ENCRYPTION_KEY);
            }
          }
        }
      }
    } catch (e) {
      console.warn("[EventLedger] Failed emitting geo WAL:", e);
    }

    return c.json({ success: true, count: mediaItemIds.length });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});
