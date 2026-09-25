import { Hono } from "hono";
import { getDb } from "../../lib/db";
import { resolveUserAuth } from "../../lib/auth";
import { getConnectedBotClient } from "../../lib/telegram";
import { Api } from "telegram";

export const revokeShareRoute = new Hono();

/**
 * POST /api/shares/:id/revoke
 * Instantly revokes a public share link and deletes forwarded message from Telegram central vault
 */
revokeShareRoute.post("/:id/revoke", async (c) => {
  try {
    const auth = await resolveUserAuth(c);
    if (!auth.authenticated || !auth.userId) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const shareId = c.req.param("id");
    const db = getDb((c.env as any)?.DB);

    const share = await db.get(
      `SELECT * FROM media_shares WHERE id = ? AND user_id = ?`,
      [shareId, auth.userId]
    );

    if (!share) {
      return c.json({ error: "Share not found or permission denied" }, 404);
    }

    // 1. Instantly mark as revoked in D1 (< 3ms)
    await db.run("UPDATE media_shares SET is_revoked = 1 WHERE id = ?", [shareId]);

    // 2. In background, delete message from Telegram central vault if bot is available
    const cleanupPromise = (async () => {
      try {
        const botClient = await getConnectedBotClient(c.env);
        let targetPeer: any = share.public_channel_id;
        if (targetPeer !== "me" && !targetPeer.startsWith("me_")) {
          try {
            targetPeer = await botClient.getInputEntity(targetPeer);
          } catch {
            try {
              targetPeer = await botClient.getEntity(targetPeer);
            } catch {}
          }
        }
        await botClient.invoke(
          new Api.channels.DeleteMessages({
            channel: targetPeer,
            id: [Number(share.public_message_id)],
          })
        );
      } catch (delErr: any) {
        console.warn("[Share:Revoke Cleanup]: Could not delete forwarded message:", delErr?.message);
      }
    })();

    if ((c.executionCtx as any)?.waitUntil) {
      c.executionCtx.waitUntil(cleanupPromise);
    }

    return c.json({
      success: true,
      message: "Share revoked successfully",
    });
  } catch (err: any) {
    console.error("[Share:Revoke Error]:", err);
    return c.json({ error: err.message || "Failed to revoke share" }, 500);
  }
});
