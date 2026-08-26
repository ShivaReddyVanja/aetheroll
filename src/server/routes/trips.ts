import { Hono } from "hono";
import crypto from "crypto";
import { getDb } from "../lib/db";
import { resolveUserAuth } from "../lib/auth";
import { dispatchLedgerEvent, dispatchLedgerBatch, GalleryOp } from "../lib/ledger";

export const tripsRouter = new Hono();

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

/**
 * GET /api/trips?channel_id=...
 */
tripsRouter.get("/", async (c) => {
  try {
    const channelId = c.req.query("channel_id");
    if (!channelId) return c.json({ error: "channel_id is required" }, 400);

    const db = getDb((c.env as any)?.DB);
    const trips = await db.all(
      `SELECT t.*,
              COUNT(tm.media_item_id) as media_count,
              m.thumbnail_r2_key as cover_thumbnail_r2_key,
              m.blur_hash as cover_blur_hash
       FROM trips t
       LEFT JOIN trip_media tm ON tm.trip_id = t.id
       LEFT JOIN media_items m ON m.id = t.cover_media_id
       WHERE t.channel_id = ?
       GROUP BY t.id
       ORDER BY COALESCE(t.start_date, t.created_at) DESC`,
      [channelId]
    );

    return c.json({ trips });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

/**
 * POST /api/trips (Create a trip)
 */
tripsRouter.post("/", async (c) => {
  try {
    const { user, db } = await getAuthContext(c);
    const { channel_id, name, description, start_date, end_date, cover_media_id } = await c.req.json();
    if (!channel_id || !name?.trim()) return c.json({ error: "channel_id and name are required" }, 400);

    const tripId = crypto.randomUUID();

    await db.run(
      `INSERT INTO trips (id, channel_id, user_id, name, description, start_date, end_date, cover_media_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tripId,
        channel_id,
        user.id,
        name.trim(),
        description || null,
        start_date || null,
        end_date || null,
        cover_media_id || null,
      ]
    );

    const trip = await db.get("SELECT * FROM trips WHERE id = ?", [tripId]);
    return c.json({ success: true, trip });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

/**
 * PUT /api/trips/:id (Update a trip)
 */
tripsRouter.put("/:id", async (c) => {
  try {
    const { db } = await getAuthContext(c);
    const tripId = c.req.param("id");
    const { name, description, start_date, end_date, cover_media_id } = await c.req.json();

    await db.run(
      `UPDATE trips
       SET name = COALESCE(?, name),
           description = COALESCE(?, description),
           start_date = COALESCE(?, start_date),
           end_date = COALESCE(?, end_date),
           cover_media_id = COALESCE(?, cover_media_id)
       WHERE id = ?`,
      [
        name ? name.trim() : null,
        description !== undefined ? description : null,
        start_date !== undefined ? start_date : null,
        end_date !== undefined ? end_date : null,
        cover_media_id !== undefined ? cover_media_id : null,
        tripId,
      ]
    );

    const trip = await db.get("SELECT * FROM trips WHERE id = ?", [tripId]);
    return c.json({ success: true, trip });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

/**
 * DELETE /api/trips/:id (Delete a trip)
 */
tripsRouter.delete("/:id", async (c) => {
  try {
    const { db } = await getAuthContext(c);
    const tripId = c.req.param("id");

    await db.run("DELETE FROM trip_media WHERE trip_id = ?", [tripId]);
    await db.run("DELETE FROM trips WHERE id = ?", [tripId]);

    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

/**
 * POST /api/trips/:id/media (Add or remove media from a trip)
 */
tripsRouter.post("/:id/media", async (c) => {
  try {
    const { user, auth, db } = await getAuthContext(c);
    const tripId = c.req.param("id");
    const body = await c.req.json();
    const { remove } = body;
    const mediaItemIds: string[] = Array.isArray(body.media_item_ids)
      ? body.media_item_ids
      : body.media_item_id
      ? [body.media_item_id]
      : [];

    if (mediaItemIds.length === 0) {
      return c.json({ error: "media_item_ids is required" }, 400);
    }

    const trip = await db.get("SELECT name, channel_id FROM trips WHERE id = ?", [tripId]);
    if (!trip) return c.json({ error: "Trip not found" }, 404);

    if (remove) {
      for (const mId of mediaItemIds) {
        await db.run("DELETE FROM trip_media WHERE trip_id = ? AND media_item_id = ?", [tripId, mId]);
      }
    } else {
      for (const mId of mediaItemIds) {
        await db.run(
          "INSERT INTO trip_media (media_item_id, trip_id, added_by) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
          [mId, tripId, user.id]
        );
      }
    }

    // Emit Telegram WAL / Batch ledger event (non-blocking)
    if (!remove) {
      const emitPromise = (async () => {
        try {
          const placeholders = mediaItemIds.map(() => "?").join(",");
          const mediaItems = await db.all(
            `SELECT m.id, m.channel_id, m.telegram_message_id, c.telegram_channel_id FROM media_items m
             JOIN channels c ON c.id = m.channel_id WHERE m.id IN (${placeholders})`,
            mediaItemIds
          );

          if (mediaItems.length > 0) {
            const channelTgId = mediaItems[0].telegram_channel_id;

            if (mediaItems.length >= 5) {
              const ops: GalleryOp[] = [
                {
                  op: "SET_TRIP",
                  refs: mediaItems.map((m: any) => m.telegram_message_id),
                  data: { trip: trip.name },
                },
              ];
              await dispatchLedgerBatch({
                c,
                auth,
                channelTgId,
                channelDbId: mediaItems[0].channel_id,
                items: mediaItems.map((m: any) => ({ id: m.id, telegram_message_id: m.telegram_message_id })),
                ops,
                db,
              });
            } else {
              for (const item of mediaItems) {
                await dispatchLedgerEvent({
                  c,
                  auth,
                  channelTgId: item.telegram_channel_id,
                  channelDbId: item.channel_id,
                  mediaDbId: item.id,
                  refMsgId: item.telegram_message_id,
                  op: "SET_TRIP",
                  data: { trip: trip.name },
                  db,
                });
              }
            }
          }
        } catch (e) {
          console.warn("[EventLedger] Failed emitting trip media WAL:", e);
        }
      })();

      if ((c.executionCtx as any)?.waitUntil) {
        c.executionCtx.waitUntil(emitPromise.catch(() => {}));
      }
    }

    return c.json({ success: true, action: remove ? "removed" : "added", count: mediaItemIds.length });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});
