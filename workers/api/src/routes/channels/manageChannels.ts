import { Hono } from "hono";
import crypto from "crypto";
import { Api, utils } from "telegram";
import { toSafeNumber } from "../../lib/db";
import { verifyAetherollSignature } from "../../lib/crypto";
import { getR2Storage } from "../../lib/r2";
import { isTelegramAuthError, handleTelegramAuthFailure } from "../../lib/telegram";
import { getAuthUserClient } from "./utils";

export const manageChannelsRoute = new Hono();

/**
 * POST /add
 * Explicitly adds a Telegram channel to active galleries and performs initial sync
 */
manageChannelsRoute.post("/add", async (c) => {
  try {
    const { user, client, db } = await getAuthUserClient(c);
    const { telegram_channel_id, name } = await c.req.json();

    if (!telegram_channel_id) {
      return c.json({ error: "telegram_channel_id required" }, 400);
    }

    const userMeTgId = `me_${user.telegram_user_id}`;
    const targetTgId = telegram_channel_id === "me" ? userMeTgId : telegram_channel_id;

    let channelRow = await db.get("SELECT * FROM channels WHERE telegram_channel_id = ?", [targetTgId]);
    const channelId = channelRow?.id || crypto.randomUUID();

    if (!channelRow) {
      await db.run(
        "INSERT INTO channels (id, telegram_channel_id, name) VALUES (?, ?, ?)",
        [channelId, targetTgId, name || "Telegram Channel"]
      );
    }

    // Explicitly add to gallery_channels table
    await db.run(
      `INSERT INTO gallery_channels (user_id, channel_id)
       VALUES (?, ?)
       ON CONFLICT(user_id, channel_id) DO NOTHING`,
      [user.id, channelId]
    );

    // Initial background sync for newly added channel
    try {
      if (!client.connected) await client.connect();
      let targetPeer: any = targetTgId;
      if (targetTgId === "me" || targetTgId.startsWith("me_")) {
        targetPeer = "me";
      } else {
        try { targetPeer = await client.getInputEntity(targetTgId); }
        catch { try { targetPeer = await client.getEntity(targetTgId); } catch {} }
      }
      const messages = await client.getMessages(targetPeer, { limit: 100 });
      for (const msg of messages) {
        if (!msg.media) continue;

        const doc = (msg.document || (msg.media as any)?.document) as any;
        const isLegacyPhoto = !!msg.photo;
        const isDocImage = !!(doc && (
          doc.mimeType?.startsWith("image/") ||
          doc.mimeType === "image/jpeg" ||
          doc.mimeType === "image/png" ||
          doc.mimeType === "image/webp" ||
          doc.mimeType === "image/heic" ||
          doc.mimeType === "image/gif" ||
          doc.mimeType === "image/avif"
        ));
        const isPhoto = isLegacyPhoto || isDocImage;
        const isVideo = !!(msg.video || (doc && doc.mimeType?.startsWith("video/")));

        if (!isPhoto && !isVideo) continue;

        const fileType = isVideo ? "video" : "photo";
        const mimeType = doc?.mimeType || (isPhoto ? "image/jpeg" : "video/mp4");
        const fileSize = toSafeNumber((msg.photo as any)?.sizes?.slice(-1)[0]?.size || doc?.size || 0);
        const dateSeconds = toSafeNumber(msg.date, Math.floor(Date.now() / 1000));

        // Strictly verify Aetheroll cryptographic upload signature or WAL event
        const isAetherollMedia = await verifyAetherollSignature(
          msg.message,
          fileSize,
          dateSeconds,
          (c.env as any)?.SESSION_ENCRYPTION_KEY
        );
        if (!isAetherollMedia) {
          continue; // Strictly ignore any non-Aetheroll media
        }

        const docAttrs = doc?.attributes || [];
        const imageAttr = docAttrs.find((a: any) => a.w && a.h);
        const videoAttr = docAttrs.find((a: any) => a.w && a.h);
        const photoSizes = (msg.photo as any)?.sizes || [];
        const largestPhotoSize = photoSizes[photoSizes.length - 1];

        const width = toSafeNumber(imageAttr?.w || videoAttr?.w || largestPhotoSize?.w || 1920);
        const height = toSafeNumber(imageAttr?.h || videoAttr?.h || largestPhotoSize?.h || 1080);
        const rawDuration = docAttrs.find((a: any) => a.duration != null)?.duration;
        const duration = rawDuration != null ? toSafeNumber(rawDuration) : null;
        const capturedAt = new Date(dateSeconds * 1000).toISOString();
        const tgMsgId = toSafeNumber(msg.id);

        await db.run(
          `INSERT INTO media_items (
             id, channel_id, uploader_user_id, telegram_message_id, file_type,
             mime_type, file_size_bytes, width, height, duration_seconds,
             blur_hash, captured_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'LEHV6nWB2yk8pyo0adR*.7kCMdnj', ?)
           ON CONFLICT(channel_id, telegram_message_id) DO NOTHING`,
          [crypto.randomUUID(), channelId, user.id, tgMsgId, fileType, mimeType, fileSize, width, height, duration, capturedAt]
        );
      }
      await db.run("UPDATE channels SET last_synced_at = CURRENT_TIMESTAMP WHERE id = ?", [channelId]);
    } catch (syncErr: any) {
      console.warn("Initial sync error on add:", syncErr);
      if (isTelegramAuthError(syncErr)) {
        await handleTelegramAuthFailure(db, user.id);
        return c.json({ error: "Telegram session has been revoked or expired" }, 401);
      }
    }

    return c.json({ success: true, channelId });
  } catch (error: any) {
    if (isTelegramAuthError(error)) {
      return c.json({ error: "Telegram session has been revoked or expired" }, 401);
    }
    return c.json({ error: error.message || "Failed to add channel" }, error.message === "Unauthorized" ? 401 : 500);
  }
});

/**
 * POST /remove
 * Removes a channel from active galleries
 */
manageChannelsRoute.post("/remove", async (c) => {
  try {
    const { user, db } = await getAuthUserClient(c);
    const { channel_id } = await c.req.json();

    if (!channel_id) {
      return c.json({ error: "channel_id required" }, 400);
    }

    await db.run("DELETE FROM gallery_channels WHERE user_id = ? AND channel_id = ?", [user.id, channel_id]);
    return c.json({ success: true });
  } catch (error: any) {
    return c.json({ error: error.message || "Failed to remove channel" }, error.message === "Unauthorized" ? 401 : 500);
  }
});

/**
 * POST /create
 * Creates a new Telegram Channel or Megagroup (Private or Public), registers it and adds it to the user's gallery catalog
 */
manageChannelsRoute.post("/create", async (c) => {
  try {
    const { user, client, db } = await getAuthUserClient(c);
    const { title, about, is_megagroup, is_public, username } = await c.req.json();

    if (!title || !title.trim()) {
      return c.json({ error: "title is required" }, 400);
    }

    if (!client.connected) {
      await client.connect();
    }

    // 1. Create channel in Telegram (initially private)
    const result = await client.invoke(
      new Api.channels.CreateChannel({
        title: title.trim(),
        about: about ? about.trim() : "",
        broadcast: !is_megagroup,
        megagroup: !!is_megagroup,
      })
    );

    const chats = (result as any).chats || [];
    const createdChat = chats[0];
    if (!createdChat) {
      return c.json({ error: "Failed to retrieve created channel from Telegram" }, 500);
    }

    const rawTgId = createdChat.id?.toString() || "";
    // Format channel ID with -100 prefix if not already present
    const targetTgId = rawTgId.startsWith("-100") ? rawTgId : `-100${rawTgId}`;
    let publicUsername: string | null = null;

    // 2. If Public channel requested, assign public username
    if (is_public && username && username.trim()) {
      const cleanUsername = username.trim().replace(/^@/, "");
      if (!/^[a-zA-Z0-9_]{5,32}$/.test(cleanUsername)) {
        // Delete orphaned channel on validation error
        try { await client.invoke(new Api.channels.DeleteChannel({ channel: createdChat })); } catch {}
        return c.json({
          error: "Invalid public username. Must be 5-32 characters long and contain only letters, numbers, and underscores.",
        }, 400);
      }

      try {
        await client.invoke(
          new Api.channels.UpdateUsername({
            channel: createdChat,
            username: cleanUsername,
          })
        );
        publicUsername = cleanUsername;
      } catch (userErr: any) {
        // Delete orphaned channel on Telegram username error
        try { await client.invoke(new Api.channels.DeleteChannel({ channel: createdChat })); } catch {}

        const errMsg = userErr.errorMessage || userErr.message || "";
        if (errMsg === "USERNAME_OCCUPIED") {
          return c.json({ error: `The username @${cleanUsername} is already taken on Telegram.` }, 400);
        } else if (errMsg === "USERNAME_INVALID") {
          return c.json({ error: `The username @${cleanUsername} is not allowed by Telegram.` }, 400);
        } else if (errMsg === "CHANNELS_ADMIN_PUBLIC_TOO_MUCH") {
          return c.json({ error: "Your Telegram account has reached the maximum allowed number of public channels." }, 400);
        } else {
          return c.json({ error: `Failed to set public username: ${errMsg}` }, 400);
        }
      }
    }

    let channelRow = await db.get("SELECT * FROM channels WHERE telegram_channel_id = ?", [targetTgId]);
    const channelId = channelRow?.id || crypto.randomUUID();

    try {
      if (!channelRow) {
        await db.run(
          "INSERT INTO channels (id, telegram_channel_id, name) VALUES (?, ?, ?)",
          [channelId, targetTgId, title.trim()]
        );
      }

      // Add to gallery_channels table for this user
      await db.run(
        `INSERT INTO gallery_channels (user_id, channel_id)
         VALUES (?, ?)
         ON CONFLICT(user_id, channel_id) DO NOTHING`,
        [user.id, channelId]
      );
    } catch (dbErr) {
      // Delete orphaned channel in Telegram if DB write fails
      try { await client.invoke(new Api.channels.DeleteChannel({ channel: createdChat })); } catch {}
      throw dbErr;
    }

    const inviteLink = publicUsername
      ? `https://t.me/${publicUsername}`
      : undefined;

    return c.json({
      success: true,
      channel: {
        id: channelId,
        telegram_channel_id: targetTgId,
        name: title.trim(),
        username: publicUsername,
        media_count: 0,
        is_added: 1,
        is_channel: !is_megagroup,
        is_group: !!is_megagroup,
        is_public: !!is_public && !!publicUsername,
        invite_link: inviteLink,
      },
    });
  } catch (error: any) {
    if (isTelegramAuthError(error)) {
      return c.json({ error: "Telegram session has been revoked or expired" }, 401);
    }
    return c.json({ error: error.message || "Failed to create channel" }, error.message === "Unauthorized" ? 401 : 500);
  }
});

/**
 * POST /invite-link
 * Generates or retrieves an export invite link (https://t.me/+... or https://t.me/username) for a channel
 */
manageChannelsRoute.post("/invite-link", async (c) => {
  try {
    const { user, client, db } = await getAuthUserClient(c);
    const { telegram_channel_id } = await c.req.json();

    if (!telegram_channel_id) {
      return c.json({ error: "telegram_channel_id required" }, 400);
    }

    if (telegram_channel_id === "me" || telegram_channel_id.startsWith("me_")) {
      return c.json({ error: "Cannot generate invite link for private Saved Messages" }, 400);
    }

    if (!client.connected) {
      await client.connect();
    }

    let targetPeer: any = telegram_channel_id;
    let entity: any = null;
    try {
      targetPeer = await client.getInputEntity(telegram_channel_id);
      entity = await client.getEntity(telegram_channel_id);
    } catch {
      try {
        entity = await client.getEntity(telegram_channel_id);
        targetPeer = entity;
      } catch (err: any) {
        return c.json({ error: `Could not resolve Telegram channel: ${err.message || err}` }, 400);
      }
    }

    // If channel is public with a username, return the direct public link
    if (entity?.username) {
      return c.json({
        success: true,
        invite_link: `https://t.me/${entity.username}`,
        is_public: true,
      });
    }

    // Otherwise export private chat invite link
    const inviteResult = await client.invoke(
      new Api.messages.ExportChatInvite({
        peer: targetPeer,
      })
    );

    const inviteLink = (inviteResult as any)?.link || (inviteResult as any)?.invite?.link;
    if (!inviteLink) {
      return c.json({ error: "Telegram did not return an invite link" }, 500);
    }

    return c.json({
      success: true,
      invite_link: inviteLink,
      is_public: false,
    });
  } catch (error: any) {
    if (isTelegramAuthError(error)) {
      return c.json({ error: "Telegram session has been revoked or expired" }, 401);
    }
    return c.json({ error: error.message || "Failed to generate invite link" }, error.message === "Unauthorized" ? 401 : 500);
  }
});


/**
 * POST /invite-users
 * Invites a list of users (usernames or IDs) directly into the Telegram channel
 */
manageChannelsRoute.post("/invite-users", async (c) => {
  try {
    const { user, client, db } = await getAuthUserClient(c);
    const { telegram_channel_id, users } = await c.req.json();

    if (!telegram_channel_id || !Array.isArray(users) || users.length === 0) {
      return c.json({ error: "telegram_channel_id and users array required" }, 400);
    }

    if (telegram_channel_id === "me" || telegram_channel_id.startsWith("me_")) {
      return c.json({ error: "Cannot invite users to private Saved Messages" }, 400);
    }

    if (!client.connected) {
      await client.connect();
    }

    let targetPeer: any = telegram_channel_id;
    try {
      targetPeer = await client.getInputEntity(telegram_channel_id);
    } catch {
      try {
        targetPeer = await client.getEntity(telegram_channel_id);
      } catch (err: any) {
        return c.json({ error: `Could not resolve Telegram channel: ${err.message || err}` }, 400);
      }
    }

    const invited: string[] = [];
    const failed: Array<{ user: string; reason: string }> = [];

    const inputUserPairs: Array<{ entity: any; userStr: string }> = [];

    for (const u of users) {
      const uStr = String(u).trim();
      if (!uStr) continue;
      try {
        const inputEntity = await client.getInputEntity(uStr);
        inputUserPairs.push({ entity: inputEntity, userStr: uStr });
      } catch (err: any) {
        failed.push({ user: uStr, reason: err.message || "Could not resolve user" });
      }
    }

    if (inputUserPairs.length > 0) {
      try {
        await client.invoke(
          new Api.channels.InviteToChannel({
            channel: targetPeer,
            users: inputUserPairs.map((p) => p.entity),
          })
        );
        for (const pair of inputUserPairs) {
          invited.push(pair.userStr);
        }
      } catch (invErr: any) {
        const errMsg = invErr.errorMessage || invErr.message || "Failed to invite";
        for (const pair of inputUserPairs) {
          failed.push({
            user: pair.userStr,
            reason: errMsg === "USER_PRIVACY_RESTRICTED"
              ? "User's privacy settings prevent direct invites. Please share an invite link instead."
              : errMsg,
          });
        }
      }
    }

    return c.json({
      success: invited.length > 0,
      invited,
      failed,
    });
  } catch (error: any) {
    if (isTelegramAuthError(error)) {
      return c.json({ error: "Telegram session has been revoked or expired" }, 401);
    }
    return c.json({ error: error.message || "Failed to invite users" }, error.message === "Unauthorized" ? 401 : 500);
  }
});

/**
 * GET /contacts
 * Fetches the authenticated user's Telegram contacts for easy inviting
 */
manageChannelsRoute.get("/contacts", async (c) => {
  try {
    const { user, client } = await getAuthUserClient(c);

    if (!client.connected) {
      await client.connect();
    }

    const contactsResult: any = await client.invoke(
      new Api.contacts.GetContacts({
        hash: 0 as any,
      })
    );

    const usersList: any[] = contactsResult?.users || [];
    const contacts = usersList
      .filter((u: any) => !u.deleted && !u.bot)
      .map((u: any) => ({
        id: u.id?.toString() || "",
        first_name: u.firstName || "",
        last_name: u.lastName || undefined,
        username: u.username || undefined,
        mutual_contact: !!u.mutualContact,
      }))
      .filter((u: any) => u.id && (u.first_name || u.username));

    return c.json({
      success: true,
      contacts,
    });
  } catch (error: any) {
    if (isTelegramAuthError(error)) {
      return c.json({ error: "Telegram session has been revoked or expired" }, 401);
    }
    return c.json({ error: error.message || "Failed to fetch contacts" }, error.message === "Unauthorized" ? 401 : 500);
  }
});

