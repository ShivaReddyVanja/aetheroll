import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { getDb, toSafeString, toSafeNumber } from "../../lib/db";
import { resolveUserAuth, extractAllSessionTokens } from "../../lib/auth";
import { getConnectedClient } from "../../lib/telegram";
import { Api } from "telegram";
import {
  resolveTelegramPeer,
  extractShareableFileMetadata,
  secureTelegramRandomId,
  generateShareId,
} from "../../lib/shareUtils";

export const createShareRoute = new Hono();

/**
 * POST /api/shares/create
 * Creates a public share link for a media item owned by the authenticated user.
 *
 * Production path: Forwarded to AUTH_DO (ShareHandler) which holds a warm
 * MTProto connection — avoids the stateless Worker CPU/socket timeout.
 *
 * Local dev path: Runs the same logic inline using Node SQLite + getConnectedClient.
 */
createShareRoute.post("/create", async (c) => {
  // ------------------------------------------------------------------
  // Production: Route to Cloudflare Durable Object
  // ------------------------------------------------------------------
  const authDo = (c.env as any)?.AUTH_DO;
  if (authDo && typeof authDo.idFromName === "function") {
    const candidates = extractAllSessionTokens(c);
    const token =
      candidates[0]?.fullToken ||
      candidates[0]?.sessionId ||
      getCookie(c, "tg_session") ||
      c.req.header("x-tg-session") ||
      "default";

    const doId = authDo.idFromName(token);
    const stub = authDo.get(doId);

    const envObj = (c.env as any) || {};

    // Read body first so we control what gets forwarded
    const bodyText = await c.req.text().catch(() => "{}");

    // Build a clean header set — do NOT copy Content-Length from the original
    // request because the body may have been re-encoded and its byte length
    // could differ, causing the DO to truncate or reject the payload.
    const headers = new Headers();
    // Preserve auth headers from original request
    const authHeader = c.req.header("authorization");
    const cookieHeader = c.req.header("cookie");
    const sessionHeader = c.req.header("x-tg-session");
    if (authHeader) headers.set("authorization", authHeader);
    if (cookieHeader) headers.set("cookie", cookieHeader);
    if (sessionHeader) headers.set("x-tg-session", sessionHeader);

    // Pass env secrets to DO
    if (envObj.TELEGRAM_API_ID) headers.set("x-tg-api-id", String(envObj.TELEGRAM_API_ID));
    if (envObj.TELEGRAM_API_HASH) headers.set("x-tg-api-hash", String(envObj.TELEGRAM_API_HASH));
    if (envObj.TELEGRAM_TEST_MODE) headers.set("x-tg-test-mode", String(envObj.TELEGRAM_TEST_MODE));
    if (envObj.SESSION_ENCRYPTION_KEY) headers.set("x-tg-enc-key", String(envObj.SESSION_ENCRYPTION_KEY));
    if (envObj.ENABLE_TELEMETRY) headers.set("x-enable-telemetry", String(envObj.ENABLE_TELEMETRY));
    if (envObj.PUBLIC_VAULT_CHANNEL_ID) headers.set("x-tg-public-vault", String(envObj.PUBLIC_VAULT_CHANNEL_ID));
    if (envObj.WEB_APP_URL) headers.set("x-web-app-url", String(envObj.WEB_APP_URL));

    // Content-Type and Content-Length are set fresh from our known body
    headers.set("content-type", "application/json");
    headers.set("content-length", String(Buffer.byteLength(bodyText, "utf8")));

    const req = new Request(c.req.url, {
      method: "POST",
      headers,
      body: bodyText,
    });

    return stub.fetch(req);
  }

  // ------------------------------------------------------------------
  // Local dev fallback (no Durable Objects — Node + SQLite)
  // ------------------------------------------------------------------
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

    // 1. Fetch media item with ownership check via gallery_channels
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

    const webAppUrl = ((c.env as any)?.WEB_APP_URL || "https://aetheroll.builtbyshiva.com").replace(/\/$/, "");

    // 2. Return existing active share if one already exists
    const existingShare = await db.get(
      `SELECT * FROM media_shares
       WHERE user_id = ? AND media_id = ? AND is_revoked = 0
         AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
       ORDER BY created_at DESC LIMIT 1`,
      [auth.userId, item.id]
    );

    if (existingShare) {
      return c.json({
        success: true,
        share: existingShare,
        share_url: `${webAppUrl}/v/${existingShare.id}`,
      });
    }

    // 3. Resolve Public Vault Channel ID (from env only — no fallback)
    const publicVaultChannelId: string | undefined =
      (c.env as any)?.PUBLIC_VAULT_CHANNEL_ID;

    // 4. Connect user MTProto client and resolve source peer
    const userClient = await getConnectedClient(auth.sessionString, auth.telegramConfig);
    const fromPeer = await resolveTelegramPeer(userClient, toSafeString(item.telegram_channel_id));

    // 5. Fetch and validate original message media
    const originalMsgId = toSafeNumber(item.telegram_message_id);
    const originalMessages = await userClient.getMessages(fromPeer, { ids: [originalMsgId] });
    const originalMsg = originalMessages?.[0];

    if (!originalMsg?.media) {
      return c.json({ error: "Source message not found or contains no media" }, 404);
    }

    const originalMeta = extractShareableFileMetadata(originalMsg);
    if (!originalMeta) {
      return c.json(
        { error: "Unsupported media type — only documents and photos are shareable" },
        422
      );
    }

    let publicMessageId = originalMsgId;
    let publicChannelId = toSafeString(item.telegram_channel_id);
    let { docId, accessHash, fileRefHex } = originalMeta;

    // 6. Forward to vault channel if configured and different from source
    if (publicVaultChannelId && toSafeString(publicVaultChannelId) !== toSafeString(item.telegram_channel_id)) {
      const toPeer = await resolveTelegramPeer(userClient, toSafeString(publicVaultChannelId));

      const forwardResult = await userClient.invoke(
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
        return c.json(
          { error: "Failed to forward media to public vault — Telegram returned no message ID" },
          502
        );
      }

      const vaultMeta = extractShareableFileMetadata(newMsg);
      if (!vaultMeta) {
        return c.json({ error: "Forwarded vault message carries no file metadata" }, 502);
      }

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
        auth.userId,
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

    return c.json({ success: true, share: shareRecord, share_url: `${webAppUrl}/v/${shareId}` });
  } catch (err: any) {
    console.error("[Share:Create Error]:", err);
    return c.json({ error: err.message || "Failed to create share link" }, 500);
  }
});
