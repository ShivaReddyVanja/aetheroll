import { Hono } from "hono";
import { getDb } from "../../lib/db.ts";
import { resolveUserAuth } from "../../lib/auth.ts";
import { getR2Storage } from "../../lib/r2.ts";
import { getConnectedClient } from "../../lib/telegram.ts";
import { dispatchLedgerEvent } from "../../lib/ledger.ts";

export const actionsMediaRoute = new Hono();

/**
 * POST /:id/favorite
 * Toggles favorite state
 */
actionsMediaRoute.post("/:id/favorite", async (c) => {
  try {
    const auth = await resolveUserAuth(c);
    if (!auth.authenticated || !auth.userId) return c.json({ error: "Unauthorized" }, 401);

    const db = getDb((c.env as any)?.DB);
    const mediaId = c.req.param("id");
    const existing = await db.get(
      "SELECT 1 FROM media_favorites WHERE user_id = ? AND media_item_id = ?",
      [auth.userId, mediaId]
    );

    const isFavorited = !existing;
    if (existing) {
      await db.run("DELETE FROM media_favorites WHERE user_id = ? AND media_item_id = ?", [auth.userId, mediaId]);
    } else {
      await db.run("INSERT INTO media_favorites (user_id, media_item_id) VALUES (?, ?)", [auth.userId, mediaId]);
    }

    // Emit WAL Event to Telegram channel in background (non-blocking)
    const emitPromise = (async () => {
      try {
        const item = await db.get(
          `SELECT m.telegram_message_id, m.channel_id, c.telegram_channel_id FROM media_items m
           JOIN channels c ON c.id = m.channel_id
           WHERE m.id = ?`,
          [mediaId]
        );
        if (item) {
          await dispatchLedgerEvent({
            c,
            auth,
            channelTgId: item.telegram_channel_id,
            channelDbId: item.channel_id,
            mediaDbId: mediaId,
            refMsgId: item.telegram_message_id,
            op: "FAVORITE",
            data: { fav: isFavorited },
            db,
          });
        }
      } catch (eventErr) {
        console.warn("[EventLedger] Failed emitting favorite event:", eventErr);
      }
    })();

    if ((c.executionCtx as any)?.waitUntil) {
      c.executionCtx.waitUntil(emitPromise.catch(() => {}));
    }

    return c.json({ favorited: isFavorited });
  } catch (error: any) {
    return c.json({ error: error.message || "Failed to toggle favorite" }, 500);
  }
});

/**
 * POST /delete
 * Deletes one or more media items from D1, R2 cache, and Telegram channels
 */
actionsMediaRoute.post("/delete", async (c) => {
  try {
    const auth = await resolveUserAuth(c);
    if (!auth.authenticated || !auth.userId) return c.json({ error: "Unauthorized" }, 401);

    const db = getDb((c.env as any)?.DB);
    const body = await c.req.json();
    const media_ids: string[] = Array.isArray(body.media_ids)
      ? body.media_ids
      : body.media_id
      ? [body.media_id]
      : [];

    if (media_ids.length === 0) {
      return c.json({ error: "media_ids array required" }, 400);
    }

    const placeholders = media_ids.map(() => "?").join(",");
    const items = await db.all(
      `SELECT m.*, c.telegram_channel_id FROM media_items m
       JOIN channels c ON c.id = m.channel_id
       WHERE m.id IN (${placeholders})`,
      media_ids
    );

    // Fetch all linked WAL event message IDs for these media items
    let eventRows: any[] = [];
    const tgMsgIds = items.map((it) => it.telegram_message_id).filter(Boolean);
    try {
      if (tgMsgIds.length > 0) {
        const tgPlaceholders = tgMsgIds.map(() => "?").join(",");
        eventRows = await db.all(
          `SELECT m.channel_id, m.media_item_id, m.media_telegram_msg_id, m.event_telegram_msg_id, c.telegram_channel_id
           FROM media_event_messages m
           JOIN channels c ON c.id = m.channel_id
           WHERE m.media_item_id IN (${placeholders}) OR m.media_telegram_msg_id IN (${tgPlaceholders})`,
          [...media_ids, ...tgMsgIds]
        );
      } else {
        eventRows = await db.all(
          `SELECT m.channel_id, m.media_item_id, m.media_telegram_msg_id, m.event_telegram_msg_id, c.telegram_channel_id
           FROM media_event_messages m
           JOIN channels c ON c.id = m.channel_id
           WHERE m.media_item_id IN (${placeholders})`,
          media_ids
        );
      }
    } catch (e) {
      console.warn("[MediaDelete] Error querying media_event_messages:", e);
    }

    // 1. Batched D1 Database Deletions
    await db.run(`DELETE FROM media_favorites WHERE media_item_id IN (${placeholders})`, media_ids);
    await db.run(`DELETE FROM media_person_tags WHERE media_item_id IN (${placeholders})`, media_ids);
    await db.run(`DELETE FROM media_tags WHERE media_item_id IN (${placeholders})`, media_ids);
    await db.run(`DELETE FROM media_event_tags WHERE media_item_id IN (${placeholders})`, media_ids);
    await db.run(`DELETE FROM trip_media WHERE media_item_id IN (${placeholders})`, media_ids);
    try {
      if (tgMsgIds.length > 0) {
        const tgPlaceholders = tgMsgIds.map(() => "?").join(",");
        await db.run(
          `DELETE FROM media_event_messages WHERE media_item_id IN (${placeholders}) OR media_telegram_msg_id IN (${tgPlaceholders})`,
          [...media_ids, ...tgMsgIds]
        );
      } else {
        await db.run(`DELETE FROM media_event_messages WHERE media_item_id IN (${placeholders})`, media_ids);
      }
    } catch {}
    await db.run(`DELETE FROM media_items WHERE id IN (${placeholders})`, media_ids);

    const deletedCount = items.length || media_ids.length;

    // 2. Batched R2 Cache cleanup
    const r2 = getR2Storage((c.env as any)?.R2_BUCKET);
    Promise.allSettled(
      items.map(async (item: any) => {
        if (item.thumbnail_r2_key) {
          try { await r2.delete(item.thumbnail_r2_key); } catch {}
        }
        try { await r2.delete(`cache/${item.channel_id}/${item.id}.bin`); } catch {}
      })
    ).catch(() => {});

    // 3. Batched Telegram Message Deletion grouped by target channel (includes parent photo & WAL events)
    if (auth.sessionString && items.length > 0) {
      const itemsByChannel = new Map<string, Set<number>>();
      for (const item of items) {
        if (item.telegram_message_id && item.telegram_channel_id) {
          const set = itemsByChannel.get(item.telegram_channel_id) || new Set<number>();
          set.add(Number(item.telegram_message_id));
          itemsByChannel.set(item.telegram_channel_id, set);
        }
      }

      for (const evt of eventRows) {
        const item = items.find(
          (it) => it.id === evt.media_item_id || String(it.telegram_message_id) === String(evt.media_telegram_msg_id)
        );
        const channelTgId = evt.telegram_channel_id || item?.telegram_channel_id;
        if (channelTgId && evt.event_telegram_msg_id) {
          const set = itemsByChannel.get(channelTgId) || new Set<number>();
          set.add(Number(evt.event_telegram_msg_id));
          itemsByChannel.set(channelTgId, set);
        }
      }

      if (itemsByChannel.size > 0) {
        const authDo = (c.env as any)?.AUTH_DO;
        if (authDo && typeof authDo.idFromName === "function") {
          try {
            const token = auth.sessionId || auth.userId || "default";
            const doId = authDo.idFromName(token);
            const stub = authDo.get(doId);

            const headers = new Headers();
            headers.set("Content-Type", "application/json");
            if (auth.sessionId) headers.set("x-tg-session", auth.sessionId);
            if (c.req.header("cookie")) headers.set("cookie", c.req.header("cookie")!);
            if (c.req.header("authorization")) headers.set("authorization", c.req.header("authorization")!);
            const env = c.env as any;
            if (env?.TELEGRAM_API_ID) headers.set("x-tg-api-id", String(env.TELEGRAM_API_ID));
            if (env?.TELEGRAM_API_HASH) headers.set("x-tg-api-hash", String(env.TELEGRAM_API_HASH));
            if (env?.TELEGRAM_TEST_MODE) headers.set("x-tg-test-mode", String(env.TELEGRAM_TEST_MODE));
            if (env?.SESSION_ENCRYPTION_KEY) headers.set("x-tg-enc-key", String(env.SESSION_ENCRYPTION_KEY));

            const channelItems = Array.from(itemsByChannel.entries()).map(([channelTgId, msgSet]) => ({
              channelTgId,
              messageIds: Array.from(msgSet).filter(Boolean),
            }));

            const deleteReq = new Request("https://internal.do/api/media/delete", {
              method: "POST",
              headers,
              body: JSON.stringify({ channel_items: channelItems }),
            });

            await stub.fetch(deleteReq).catch((err: any) => {
              console.warn("[MediaDelete] DO deletion non-fatal error:", err);
            });
          } catch (doErr) {
            console.warn("[MediaDelete] DO dispatch error:", doErr);
          }
        } else {
          // Fallback for local Node / testing environment without Durable Object
          try {
            const client = await getConnectedClient(auth.sessionString!, auth.telegramConfig);

            for (const [channelTgId, msgSet] of itemsByChannel.entries()) {
              try {
                let targetPeer: any = channelTgId;
                if (targetPeer !== "me" && !targetPeer.startsWith("me_")) {
                  try { targetPeer = await client.getInputEntity(targetPeer); }
                  catch { try { targetPeer = await client.getEntity(targetPeer); } catch {} }
                } else {
                  targetPeer = "me";
                }

                const idArray = Array.from(msgSet).filter(Boolean);
                if (idArray.length === 0) continue;

                const TG_BATCH_LIMIT = 100;
                for (let i = 0; i < idArray.length; i += TG_BATCH_LIMIT) {
                  const chunk = idArray.slice(i, i + TG_BATCH_LIMIT);
                  await client.deleteMessages(targetPeer, chunk, { revoke: true });
                }
              } catch (chErr) {
                console.warn(`[MediaDelete] Failed batch deleting messages in channel ${channelTgId}:`, chErr);
              }
            }
          } catch (clientErr) {
            console.warn("[MediaDelete] Telegram client fallback error:", clientErr);
          }
        }
      }
    }

    return c.json({ success: true, deletedCount });
  } catch (error: any) {
    console.error("Delete Error:", error);
    return c.json({ error: error.message || "Failed to delete media" }, 500);
  }
});
