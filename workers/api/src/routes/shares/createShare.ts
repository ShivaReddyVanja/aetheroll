import { Hono } from "hono";
import { getDb, toSafeString, toSafeNumber } from "../../lib/db";
import { resolveUserAuth } from "../../lib/auth";
import { getConnectedClient } from "../../lib/telegram";
import { Api, helpers } from "telegram";

export const createShareRoute = new Hono();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolves a Telegram peer from a raw channel-id string using the connected
 * client. Tries the cheap InputEntity path first, falls back to full Entity
 * resolution, and throws a descriptive error if both fail so callers can
 * surface a proper HTTP response instead of silently continuing with a broken
 * peer value.
 */
async function resolvePeer(client: any, channelId: string): Promise<any> {
  if (channelId === "me" || channelId.startsWith("me_")) {
    return "me";
  }
  try {
    return await client.getInputEntity(channelId);
  } catch {
    // Fallback – full entity lookup (slightly more expensive but more robust)
    try {
      return await client.getEntity(channelId);
    } catch (err: any) {
      throw new Error(
        `[Share:Create] Unable to resolve Telegram peer for channel "${channelId}": ${err?.message ?? String(err)}`
      );
    }
  }
}

/**
 * Extracts document/photo metadata from a raw Telegram message object.
 * Returns null when the message carries no file media.
 */
function extractFileMetadata(msg: any): {
  docId: string;
  accessHash: string;
  fileRefHex: string;
} | null {
  const media = msg?.media;
  if (!media) return null;

  const doc = media.document ?? null;
  const photo = media.photo ?? null;
  const subject = doc ?? photo;

  if (!subject?.id || !subject?.accessHash) return null;

  return {
    docId: toSafeString(subject.id),
    accessHash: toSafeString(subject.accessHash),
    fileRefHex: subject.fileReference
      ? Buffer.from(subject.fileReference).toString("hex")
      : "",
  };
}

/**
 * Generates a cryptographically secure 64-bit random integer compatible with
 * Telegram's randomId field (which expects a unique signed 64-bit value per
 * request to prevent duplicate forwarding).
 */
function secureTelegramRandomId(): any {
  return helpers.readBigIntFromBuffer(helpers.generateRandomBytes(8), true, true);
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

/**
 * POST /api/shares/create
 * Creates a public share link for a media item owned by the authenticated user.
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

    // ------------------------------------------------------------------
    // 1. Fetch media item — verify authenticated user has access to the
    //    channel via gallery_channels (the live ownership table).
    // ------------------------------------------------------------------
    const item = await db.get(
      `SELECT m.*, c.telegram_channel_id
       FROM media_items m
       JOIN channels c ON c.id = m.channel_id
       JOIN gallery_channels gc ON gc.channel_id = c.id
       WHERE m.id = ? AND gc.user_id = ?`,
      [media_id, auth.userId]
    );

    if (!item) {
      return c.json({ error: "Media item not found or permission denied" }, 404);
    }

    // ------------------------------------------------------------------
    // 2. Return existing active, non-expired share if one already exists
    // ------------------------------------------------------------------
    const existingShare = await db.get(
      `SELECT * FROM media_shares
       WHERE user_id = ? AND media_id = ? AND is_revoked = 0
         AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
       ORDER BY created_at DESC LIMIT 1`,
      [auth.userId, item.id]
    );

    const origin = new URL(c.req.url).origin;

    if (existingShare) {
      return c.json({
        success: true,
        share: existingShare,
        share_url: `${origin}/v/${existingShare.id}`,
      });
    }

    // ------------------------------------------------------------------
    // 3. Resolve Public Vault Channel ID strictly from env — no fallback
    //    to item.telegram_channel_id to prevent accidental data exposure
    //    if the env var is missing.
    // ------------------------------------------------------------------
    const envObj = (c.env as any) ?? {};
    const publicVaultChannelId: string | undefined =
      envObj.PUBLIC_VAULT_CHANNEL_ID;

    // ------------------------------------------------------------------
    // 4. Connect user MTProto client and resolve the source peer
    // ------------------------------------------------------------------
    const userClient = await getConnectedClient(
      auth.sessionString,
      auth.telegramConfig
    );

    const fromPeer = await resolvePeer(
      userClient,
      toSafeString(item.telegram_channel_id)
    );

    // ------------------------------------------------------------------
    // 5. Fetch document metadata from the original message upfront.
    //    This is always needed — either as the final metadata (no vault
    //    forward) or as a validated baseline before the forward attempt.
    // ------------------------------------------------------------------
    const originalMsgId = toSafeNumber(item.telegram_message_id);
    const originalMessages = await userClient.getMessages(fromPeer, {
      ids: [originalMsgId],
    });
    const originalMsg = originalMessages?.[0];

    if (!originalMsg || !originalMsg.media) {
      return c.json(
        { error: "Source message not found or contains no media" },
        404
      );
    }

    const originalMeta = extractFileMetadata(originalMsg);
    if (!originalMeta) {
      return c.json(
        { error: "Unsupported media type — only documents and photos are shareable" },
        422
      );
    }

    // Working state — will be overwritten if a vault forward succeeds
    let publicMessageId = originalMsgId;
    let publicChannelId = toSafeString(item.telegram_channel_id);
    let { docId, accessHash, fileRefHex } = originalMeta;

    // ------------------------------------------------------------------
    // 6. Forward to central vault channel when configured and different
    //    from the source channel. On success, update all three tracking
    //    fields atomically from the forwarded message so they are always
    //    consistent with publicChannelId / publicMessageId.
    // ------------------------------------------------------------------
    if (
      publicVaultChannelId &&
      toSafeString(publicVaultChannelId) !== toSafeString(item.telegram_channel_id)
    ) {
      const toPeer = await resolvePeer(
        userClient,
        toSafeString(publicVaultChannelId)
      );

      const forwardResult = await userClient.invoke(
        new Api.messages.ForwardMessages({
          fromPeer,
          id: [originalMsgId],
          toPeer,
          randomId: [secureTelegramRandomId()],
          dropAuthor: true,
        })
      );

      // Extract forwarded message robustly from the Updates object
      const updates: any[] = (forwardResult as any)?.updates ?? [];
      const newMsg =
        updates.find((u: any) => u?.message?.id)?.message ??
        (forwardResult as any)?.messages?.[0] ??
        null;

      if (!newMsg?.id) {
        // Forward call returned no usable message — fail loudly rather than
        // storing a share record that points to the wrong channel/message.
        return c.json(
          {
            error:
              "Failed to forward media to public vault — Telegram returned no message ID",
          },
          502
        );
      }

      const vaultMeta = extractFileMetadata(newMsg);
      if (!vaultMeta) {
        // The forwarded message has no file metadata; we cannot safely stream it.
        return c.json(
          { error: "Forwarded vault message carries no file metadata" },
          502
        );
      }

      // All three fields must come from the same (vault) message to stay consistent
      publicMessageId = toSafeNumber(newMsg.id);
      publicChannelId = toSafeString(publicVaultChannelId);
      docId = vaultMeta.docId;
      accessHash = vaultMeta.accessHash;
      fileRefHex = vaultMeta.fileRefHex;
    }

    // ------------------------------------------------------------------
    // 7. Build share ID and optional expiry
    // ------------------------------------------------------------------
    // crypto.randomBytes is available in Node; use getRandomValues in
    // a pure Worker environment. Both coexist because Cloudflare Workers
    // also expose the Node-compat crypto module.
    const randomSuffix =
      typeof crypto?.getRandomValues === "function"
        ? Buffer.from(crypto.getRandomValues(new Uint8Array(9))).toString("base64url")
        : require("crypto").randomBytes(9).toString("base64url");

    const shareId = `sh_${randomSuffix}`;

    let expiresAt: string | null = null;
    if (expires_in_seconds && Number(expires_in_seconds) > 0) {
      expiresAt = new Date(
        Date.now() + Number(expires_in_seconds) * 1000
      ).toISOString();
    }

    // ------------------------------------------------------------------
    // 8. Persist share record
    // ------------------------------------------------------------------
    const now = new Date().toISOString();

    await db.run(
      `INSERT INTO media_shares (
        id, user_id, media_id, public_channel_id, public_message_id,
        document_id, access_hash, file_reference_hex, mime_type,
        file_size_bytes, duration_seconds, title, is_revoked, expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      [
        shareId,
        auth.userId,
        item.id,
        publicChannelId,
        publicMessageId,
        docId,
        accessHash,
        fileRefHex,
        toSafeString(item.mime_type),       // NOT NULL in schema; no fallback
        toSafeNumber(item.file_size_bytes),
        item.duration_seconds ?? null,
        title ?? item.caption ?? null,
        expiresAt,
        now,
      ]
    );

    // Return the record using the same values we inserted — avoids an extra
    // DB round-trip and any replication-lag race on D1.
    const shareRecord = {
      id: shareId,
      user_id: auth.userId,
      media_id: item.id,
      public_channel_id: publicChannelId,
      public_message_id: publicMessageId,
      document_id: docId,
      access_hash: accessHash,
      file_reference_hex: fileRefHex,
      mime_type: toSafeString(item.mime_type),
      file_size_bytes: toSafeNumber(item.file_size_bytes),
      duration_seconds: item.duration_seconds ?? null,
      title: title ?? item.caption ?? null,
      is_revoked: 0,
      expires_at: expiresAt,
      view_count: 0,
      created_at: now,
    };

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
