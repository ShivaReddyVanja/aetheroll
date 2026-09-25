import { Hono } from "hono";
import { getDb } from "../../lib/db";
import type { PublicShareInfo } from "@aetheroll/types";

export const infoShareRoute = new Hono();

/**
 * GET /api/shares/info/:id
 * Public, unauthenticated endpoint to fetch metadata for a shared media file
 */
infoShareRoute.get("/info/:id", async (c) => {
  try {
    const shareId = c.req.param("id");
    const db = getDb((c.env as any)?.DB);

    const share = await db.get(
      `SELECT s.*, m.file_type, m.width, m.height, m.blur_hash, m.thumbnail_r2_key, m.created_at as media_created_at
       FROM media_shares s
       JOIN media_items m ON m.id = s.media_id
       WHERE s.id = ? AND s.is_revoked = 0 AND (s.expires_at IS NULL OR s.expires_at > CURRENT_TIMESTAMP)`,
      [shareId]
    );

    if (!share) {
      return c.json({ error: "Share not found or has expired" }, 404);
    }

    const origin = new URL(c.req.url).origin;

    const publicInfo: PublicShareInfo = {
      id: share.id,
      media_id: share.media_id,
      file_type: share.file_type || (share.mime_type?.startsWith("video/") ? "video" : "image"),
      mime_type: share.mime_type,
      file_size_bytes: Number(share.file_size_bytes) || 0,
      duration_seconds: share.duration_seconds || null,
      width: share.width || null,
      height: share.height || null,
      blurhash: share.blur_hash || null,
      title: share.title || null,
      created_at: share.created_at,
      expires_at: share.expires_at || null,
      stream_url: `${origin}/api/stream/public/${share.id}`,
      thumbnail_url: share.thumbnail_r2_key ? `${origin}/api/media/${share.media_id}/thumbnail` : undefined,
    };

    return c.json({
      success: true,
      info: publicInfo,
    });
  } catch (err: any) {
    return c.json({ error: err.message || "Failed to fetch share metadata" }, 500);
  }
});
