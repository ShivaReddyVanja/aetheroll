import { Api } from "telegram";
import { getDb, toSafeString, toSafeNumber } from "../../lib/db";
import { ClientSessionManager } from "../auth/clientSessionManager";
import {
  resolveTelegramPeer,
  extractShareableFileMetadata,
  secureTelegramRandomId,
  generateShareId,
} from "../../lib/shareUtils";

export class ShareHandler {
  /**
   * Handles POST /api/shares/create inside the Durable Object.
   * Runs with a warm, persistent MTProto user session managed by ClientSessionManager.
   */
  async handleCreateShare(
    request: Request,
    effectiveEnv: any,
    clientSessionManager: ClientSessionManager
  ): Promise<Response> {
    try {
      const { client, userId, error } = await clientSessionManager.getOrConnectUserClient(
        request,
        effectiveEnv
      );
      if (!client || !userId) {
        return new Response(JSON.stringify({ error: error || "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      const body = (await request.json().catch(() => ({}))) as any;
      const { media_id, title, expires_in_seconds } = body;
      if (!media_id) {
        return new Response(JSON.stringify({ error: "media_id is required" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const db = getDb(effectiveEnv?.DB);

      // 1. Fetch media item — verify ownership via gallery_channels
      const item = await db.get(
        `SELECT m.*, c.telegram_channel_id
         FROM media_items m
         JOIN channels c ON c.id = m.channel_id
         JOIN gallery_channels gc ON gc.channel_id = c.id
         WHERE m.id = ? AND gc.user_id = ?`,
        [media_id, userId]
      );

      if (!item) {
        return new Response(
          JSON.stringify({ error: "Media item not found or permission denied" }),
          { status: 404, headers: { "Content-Type": "application/json" } }
        );
      }

      const webAppUrl = (effectiveEnv?.WEB_APP_URL || "https://aetheroll.builtbyshiva.com").replace(/\/$/, "");

      // 2. Return existing active share if one already exists
      const existingShare = await db.get(
        `SELECT * FROM media_shares
         WHERE user_id = ? AND media_id = ? AND is_revoked = 0
           AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
         ORDER BY created_at DESC LIMIT 1`,
        [userId, item.id]
      );

      if (existingShare) {
        return new Response(
          JSON.stringify({
            success: true,
            share: existingShare,
            share_url: `${webAppUrl}/v/${existingShare.id}`,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      // 3. Resolve Public Vault Channel ID (from env only — no fallback to source channel)
      const publicVaultChannelId: string | undefined = effectiveEnv.PUBLIC_VAULT_CHANNEL_ID;

      // 4. Resolve source peer
      const fromPeer = await resolveTelegramPeer(client, toSafeString(item.telegram_channel_id));

      // 5. Fetch and validate original message media
      const originalMsgId = toSafeNumber(item.telegram_message_id);
      const originalMessages = await client.getMessages(fromPeer, { ids: [originalMsgId] });
      const originalMsg = originalMessages?.[0];

      if (!originalMsg?.media) {
        return new Response(
          JSON.stringify({ error: "Source message not found or contains no media" }),
          { status: 404, headers: { "Content-Type": "application/json" } }
        );
      }

      const originalMeta = extractShareableFileMetadata(originalMsg);
      if (!originalMeta) {
        return new Response(
          JSON.stringify({
            error: "Unsupported media type — only documents and photos are shareable",
          }),
          { status: 422, headers: { "Content-Type": "application/json" } }
        );
      }

      let publicMessageId = originalMsgId;
      let publicChannelId = toSafeString(item.telegram_channel_id);
      let { docId, accessHash, fileRefHex } = originalMeta;

      // 6. Forward to vault channel if configured and different from source channel
      if (
        publicVaultChannelId &&
        toSafeString(publicVaultChannelId) !== toSafeString(item.telegram_channel_id)
      ) {
        const toPeer = await resolveTelegramPeer(client, toSafeString(publicVaultChannelId));

        const forwardResult = await client.invoke(
          new Api.messages.ForwardMessages({
            fromPeer,
            id: [originalMsgId],
            toPeer,
            randomId: [secureTelegramRandomId()],
            dropAuthor: true,
          })
        );

        const updates: any[] = (forwardResult as any)?.updates ?? [];
        const newMsg =
          updates.find((u: any) => u?.message?.id)?.message ??
          (forwardResult as any)?.messages?.[0] ??
          null;

        if (!newMsg?.id) {
          return new Response(
            JSON.stringify({
              error: "Failed to forward media to public vault — Telegram returned no message ID",
            }),
            { status: 502, headers: { "Content-Type": "application/json" } }
          );
        }

        const vaultMeta = extractShareableFileMetadata(newMsg);
        if (!vaultMeta) {
          return new Response(
            JSON.stringify({ error: "Forwarded vault message carries no file metadata" }),
            { status: 502, headers: { "Content-Type": "application/json" } }
          );
        }

        // All three fields come from the vault message — always consistent
        publicMessageId = toSafeNumber(newMsg.id);
        publicChannelId = toSafeString(publicVaultChannelId);
        docId = vaultMeta.docId;
        accessHash = vaultMeta.accessHash;
        fileRefHex = vaultMeta.fileRefHex;
      }

      // 7. Generate share token and optional expiry
      const shareId = generateShareId();

      let expiresAt: string | null = null;
      if (expires_in_seconds && Number(expires_in_seconds) > 0) {
        expiresAt = new Date(Date.now() + Number(expires_in_seconds) * 1000).toISOString();
      }

      // 8. Persist share record
      const now = new Date().toISOString();

      await db.run(
        `INSERT INTO media_shares (
          id, user_id, media_id, public_channel_id, public_message_id,
          document_id, access_hash, file_reference_hex, mime_type,
          file_size_bytes, duration_seconds, title, is_revoked, expires_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        [
          shareId,
          userId,
          item.id,
          publicChannelId,
          publicMessageId,
          docId,
          accessHash,
          fileRefHex,
          toSafeString(item.mime_type),
          toSafeNumber(item.file_size_bytes),
          item.duration_seconds ?? null,
          title ?? item.caption ?? null,
          expiresAt,
          now,
        ]
      );

      const shareRecord = {
        id: shareId,
        user_id: userId,
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

      return new Response(
        JSON.stringify({ success: true, share: shareRecord, share_url: `${webAppUrl}/v/${shareId}` }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    } catch (err: any) {
      console.error("[DO:Share Error]:", err);
      return new Response(
        JSON.stringify({ error: err.message || "Failed to create share link" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  }
}
