import { Hono } from "hono";
import { getDb } from "../../lib/db";
import { resolveUserAuth } from "../../lib/auth";

export const listSharesRoute = new Hono();

/**
 * GET /api/shares
 * Lists all active and past shares created by the authenticated user
 */
listSharesRoute.get("/", async (c) => {
  try {
    const auth = await resolveUserAuth(c);
    if (!auth.authenticated || !auth.userId) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const db = getDb((c.env as any)?.DB);
    const shares = await db.all(
      `SELECT s.*, m.file_type, m.thumbnail_r2_key, m.blur_hash, m.width, m.height
       FROM media_shares s
       JOIN media_items m ON m.id = s.media_id
       WHERE s.user_id = ?
       ORDER BY s.created_at DESC`,
      [auth.userId]
    );

    return c.json({
      success: true,
      shares: shares || [],
    });
  } catch (err: any) {
    return c.json({ error: err.message || "Failed to list shares" }, 500);
  }
});

/**
 * GET /api/shares/media/:mediaId
 * Gets the active share link for a specific media item (if any exists)
 */
listSharesRoute.get("/media/:mediaId", async (c) => {
  try {
    const auth = await resolveUserAuth(c);
    if (!auth.authenticated || !auth.userId) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const mediaId = c.req.param("mediaId");
    const db = getDb((c.env as any)?.DB);

    const share = await db.get(
      `SELECT * FROM media_shares
       WHERE user_id = ? AND media_id = ? AND is_revoked = 0
         AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
       ORDER BY created_at DESC LIMIT 1`,
      [auth.userId, mediaId]
    );

    const origin = new URL(c.req.url).origin;

    return c.json({
      success: true,
      share: share || null,
      share_url: share ? `${origin}/v/${share.id}` : null,
    });
  } catch (err: any) {
    return c.json({ error: err.message || "Failed to fetch share for media" }, 500);
  }
});
