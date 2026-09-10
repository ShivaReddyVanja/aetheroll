import { Hono } from "hono";
import crypto from "crypto";
import { getUserChannels, isTelegramAuthError, handleTelegramAuthFailure } from "../../lib/telegram";
import { getAuthUserClient } from "./utils";

export const listChannelsRoute = new Hono();

/**
 * GET /
 * Returns channels for the user.
 * - By default: Returns only active channels (with media or 'me' vault)
 * - With ?all=true: Returns all Telegram channels and groups the user belongs to
 */
listChannelsRoute.get("/", async (c) => {
  try {
    const { user, client, db } = await getAuthUserClient(c);
    const returnAll = c.req.query("all") === "true";

    // Ensure 'me' (Saved Messages) exists in channels catalog specifically for THIS user
    const userMeTgId = `me_${user.telegram_user_id}`;
    let meChannel = await db.get("SELECT * FROM channels WHERE telegram_channel_id = ?", [userMeTgId]);
    const meChannelId = meChannel?.id || crypto.randomUUID();
    if (!meChannel) {
      await db.run(
        "INSERT INTO channels (id, telegram_channel_id, name) VALUES (?, ?, 'Saved Messages (Private Cloud)')",
        [meChannelId, userMeTgId]
      );
    }

    // Guarantee user's Saved Messages is linked to gallery_channels for this user
    await db.run(
      `INSERT INTO gallery_channels (user_id, channel_id)
       VALUES (?, ?)
       ON CONFLICT(user_id, channel_id) DO NOTHING`,
      [user.id, meChannelId]
    );

    if (returnAll) {
      // 1. Fetch live channels from Telegram strictly for THIS user
      const userTgChannelIds = new Set<string>();
      userTgChannelIds.add(userMeTgId);

      try {
        const tgChannels = await getUserChannels(client);

        for (const ch of tgChannels) {
          const targetTgId = ch.id === "me" ? userMeTgId : String(ch.id);
          userTgChannelIds.add(targetTgId);

          let channelRow = await db.get("SELECT * FROM channels WHERE telegram_channel_id = ?", [targetTgId]);
          const channelId = channelRow?.id || crypto.randomUUID();

          if (!channelRow) {
            await db.run(
              "INSERT INTO channels (id, telegram_channel_id, name) VALUES (?, ?, ?)",
              [channelId, targetTgId, ch.title]
            );
          } else {
            await db.run("UPDATE channels SET name = ? WHERE id = ?", [ch.title, channelId]);
          }
        }
      } catch (tgErr: any) {
        console.warn("Failed live TG channel sync:", tgErr);
        if (isTelegramAuthError(tgErr)) {
          await handleTelegramAuthFailure(db, user.id);
          return c.json({ error: "Telegram session has been revoked or expired" }, 401);
        }
      }

      // Return ONLY the channels that belong to THIS user from Telegram / gallery
      if (userTgChannelIds.size > 0) {
        const idList = Array.from(userTgChannelIds);
        const placeholders = idList.map(() => "?").join(", ");
        const allChannels = await db.all(
          `SELECT c.id, c.telegram_channel_id, c.name, c.cover_media_id, c.last_synced_at,
                  COUNT(m.id) as media_count,
                  EXISTS(SELECT 1 FROM gallery_channels gc WHERE gc.channel_id = c.id AND gc.user_id = ?) as is_added
           FROM channels c
           LEFT JOIN media_items m ON m.channel_id = c.id AND m.deleted_at IS NULL
           WHERE c.telegram_channel_id IN (${placeholders})
           GROUP BY c.id
           ORDER BY is_added DESC, (c.telegram_channel_id = ?) DESC, c.name ASC`,
          [user.id, ...idList, userMeTgId]
        );
        return c.json({ channels: allChannels });
      }

      // Fallback: return ONLY channels already added to this user's gallery
      const fallbackChannels = await db.all(
        `SELECT c.id, c.telegram_channel_id, c.name, c.cover_media_id, c.last_synced_at,
                COUNT(m.id) as media_count,
                1 as is_added
         FROM channels c
         JOIN gallery_channels gc ON gc.channel_id = c.id
         LEFT JOIN media_items m ON m.channel_id = c.id AND m.deleted_at IS NULL
         WHERE gc.user_id = ?
         GROUP BY c.id
         ORDER BY (c.telegram_channel_id = ? OR c.telegram_channel_id = 'me') DESC, media_count DESC, c.name ASC`,
        [user.id, userMeTgId]
      );
      return c.json({ channels: fallbackChannels });
    }

    // Default: Return ONLY channels explicitly added to the user's gallery
    const userChannels = await db.all(
      `SELECT c.id, c.telegram_channel_id, c.name, c.cover_media_id, c.last_synced_at,
              COUNT(m.id) as media_count
       FROM channels c
       JOIN gallery_channels gc ON gc.channel_id = c.id
       LEFT JOIN media_items m ON m.channel_id = c.id AND m.deleted_at IS NULL
       WHERE gc.user_id = ?
       GROUP BY c.id
       ORDER BY (c.telegram_channel_id = ? OR c.telegram_channel_id = 'me') DESC, media_count DESC, c.name ASC`,
      [user.id, userMeTgId]
    );

    return c.json({ channels: userChannels });
  } catch (error: any) {
    if (isTelegramAuthError(error)) {
      return c.json({ error: "Telegram session has been revoked or expired" }, 401);
    }
    return c.json({ error: error.message || "Failed to fetch channels" }, error.message === "Unauthorized" ? 401 : 500);
  }
});
