import { Hono } from "hono";
import { getDb } from "../../lib/db";
import { resolveUserAuth } from "../../lib/auth";
import { getConnectedClient } from "../../lib/telegram";
import { Api } from "telegram";
import bigInt from "big-integer";
import crypto from "crypto";

export const createShareRoute = new Hono();

/**
 * POST /api/shares/create
 * Creates a public, bot-relayed share link for a media item
 */
createShareRoute.post("/create", async (c) => {
  try {
    const auth = await resolveUserAuth(c);
    if (!auth.authenticated || !auth.userId || !auth.sessionString) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const body = await c.req.json().catch(() => ({}));
    const { media_id, title, expires_in_seconds } = body;
    if (!media_id) {
      return c.json({ error: "media_id is required" }, 400);
    }

    const db = getDb((c.env as any)?.DB);

    // 1. Fetch original media item and verify user has access to its channel
    const item = await db.get(
      `SELECT m.*, c.telegram_channel_id 
       FROM media_items m
       JOIN channels c ON c.id = m.channel_id
       JOIN user_channels uc ON uc.channel_id = c.id
       WHERE m.id = ? AND uc.user_id = ?`,
      [media_id, auth.userId]
    );

    if (!item) {
      return c.json({ error: "Media item not found or permission denied" }, 404);
    }

    // 2. Check if an active, non-expired share already exists for this media item by this user
    const existingShare = await db.get(
      `SELECT * FROM media_shares 
       WHERE user_id = ? AND media_id = ? AND is_revoked = 0 
         AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
       ORDER BY created_at DESC LIMIT 1`,
      [auth.userId, media_id]
    );

    const origin = new URL(c.req.url).origin;

    if (existingShare) {
      return c.json({
        success: true,
        share: existingShare,
        share_url: `${origin}/v/${existingShare.id}`,
      });
    }

    // 3. Resolve Platform Central Vault Channel ID
    const publicVaultChannelId =
      (c.env as any)?.PUBLIC_VAULT_CHANNEL_ID ||
      process.env?.PUBLIC_VAULT_CHANNEL_ID ||
      item.telegram_channel_id; // Fallback to current channel if vault channel not separately configured

    // 4. Connect user MTProto client to forward the message with dropAuthor: true
    const userClient = await getConnectedClient(auth.sessionString, auth.telegramConfig);

    let fromPeer: any = item.telegram_channel_id;
    if (fromPeer !== "me" && !fromPeer.startsWith("me_")) {
      try {
        fromPeer = await userClient.getInputEntity(fromPeer);
      } catch {
        try {
          fromPeer = await userClient.getEntity(fromPeer);
        } catch {}
      }
    } else {
      fromPeer = "me";
    }

    let toPeer: any = publicVaultChannelId;
    if (toPeer !== "me" && !toPeer.startsWith("me_")) {
      try {
        toPeer = await userClient.getInputEntity(toPeer);
      } catch {
        try {
          toPeer = await userClient.getEntity(toPeer);
        } catch {}
      }
    } else {
      toPeer = "me";
    }

    let publicMessageId = Number(item.telegram_message_id);
    let publicChannelId = String(publicVaultChannelId);
    let docId = "";
    let accessHash = "";
    let fileRefHex = "";

    // Forward to central vault if different from original channel
    if (String(publicVaultChannelId) !== String(item.telegram_channel_id)) {
      const forwardResult = await userClient.invoke(
        new Api.messages.ForwardMessages({
          fromPeer,
          id: [Number(item.telegram_message_id)],
          toPeer,
          randomId: [bigInt(Math.floor(Math.random() * 1e16)) as any],
          dropAuthor: true,
        })
      );

      // Extract new message ID from updates
      const updates = (forwardResult as any)?.updates || [];
      const newMsg = updates.find((u: any) => u.message)?.message ||
                     (forwardResult as any)?.messages?.[0];

      if (newMsg?.id) {
        publicMessageId = newMsg.id;
      }
      if (newMsg?.media?.document) {
        const doc = newMsg.media.document;
        docId = doc.id ? String(doc.id) : "";
        accessHash = doc.accessHash ? String(doc.accessHash) : "";
        fileRefHex = doc.fileReference ? Buffer.from(doc.fileReference).toString("hex") : "";
      } else if (newMsg?.media?.photo) {
        const photo = newMsg.media.photo;
        docId = photo.id ? String(photo.id) : "";
        accessHash = photo.accessHash ? String(photo.accessHash) : "";
        fileRefHex = photo.fileReference ? Buffer.from(photo.fileReference).toString("hex") : "";
      }
    }

    // 5. Generate secure, collision-resistant share ID
    const shareId = `sh_${crypto.randomBytes(9).toString("base64url")}`;

    let expiresAt: string | null = null;
    if (expires_in_seconds && Number(expires_in_seconds) > 0) {
      const expDate = new Date(Date.now() + Number(expires_in_seconds) * 1000);
      expiresAt = expDate.toISOString();
    }

    // 6. Insert share record in D1
    await db.run(
      `INSERT INTO media_shares (
        id, user_id, media_id, public_channel_id, public_message_id,
        document_id, access_hash, file_reference_hex, mime_type,
        file_size_bytes, duration_seconds, title, is_revoked, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      [
        shareId,
        auth.userId,
        media_id,
        publicChannelId,
        publicMessageId,
        docId,
        accessHash,
        fileRefHex,
        item.mime_type || "video/mp4",
        Number(item.file_size_bytes) || 0,
        item.duration_seconds || null,
        title || item.caption || null,
        expiresAt,
      ]
    );

    const shareRecord = await db.get("SELECT * FROM media_shares WHERE id = ?", [shareId]);

    return c.json({
      success: true,
      share: shareRecord,
      share_url: `${origin}/v/${shareId}`,
    });
  } catch (err: any) {
    console.error("[Share:Create Error]:", err);
    return c.json({ error: err.message || "Failed to create share link" }, 500);
  }
});
