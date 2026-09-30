import { Hono } from "hono";
import { getDb } from "../../lib/db";
import { resolveUserAuth } from "../../lib/auth";
import { AdminService } from "../../services/adminService";
import { CampaignService } from "../../services/campaignService";

export const botRouter = new Hono();

/**
 * Sends a message via Telegram Bot API
 */
async function sendTelegramMessage(
  botToken: string,
  chatId: number | string,
  text: string,
  options: { parse_mode?: string; reply_markup?: any } = {}
) {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: options.parse_mode || "HTML",
        disable_web_page_preview: true,
        reply_markup: options.reply_markup,
      }),
    });
    return await res.json();
  } catch (err) {
    console.error("[Bot API Error]: Failed to send message to Telegram:", err);
    return null;
  }
}

async function ensureAdminCommandMenu(botToken: string, chatId: number | string) {
  try {
    const adminCommands = [
      { command: "status", description: "Check your account & subscription status" },
      { command: "users", description: "List registered users & tiers (Admin)" },
      { command: "user", description: "Inspect single user details (Admin)" },
      { command: "gen", description: "Generate a Pro activation code (Admin)" },
      { command: "assign", description: "Grant Pro membership to user (Admin)" },
      { command: "hold", description: "Put user subscription on hold (Admin)" },
      { command: "resume", description: "Resume paused subscription (Admin)" },
      { command: "revoke", description: "Revoke subscription to Free (Admin)" },
      { command: "campaigns", description: "List signup reward campaigns (Admin)" },
      { command: "create_campaign", description: "Create a new signup campaign (Admin)" },
      { command: "campaign", description: "Inspect campaign details (Admin)" },
      { command: "pause_campaign", description: "Pause a signup campaign (Admin)" },
      { command: "resume_campaign", description: "Resume a paused campaign (Admin)" },
      { command: "extend_campaign", description: "Adjust campaign quota (Admin)" },
      { command: "delete_campaign", description: "Delete a signup campaign (Admin)" },
      { command: "help", description: "Show admin command guide" },
    ];
    await fetch(`https://api.telegram.org/bot${botToken}/setMyCommands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        commands: adminCommands,
        scope: { type: "chat", chat_id: chatId },
      }),
    });
  } catch {}
}

/**
 * Checks whether a given Telegram User ID has administrator privileges.
 * Admin privileges are strictly governed by ADMIN_TELEGRAM_USER_IDS / ADMIN_TELEGRAM_IDS.
 */
async function isTelegramAdmin(
  db: any,
  env: any,
  telegramUserId: number | string
): Promise<boolean> {
  const numId = Number(telegramUserId);
  if (!numId) return false;

  const adminIdsStr =
    env?.ADMIN_TELEGRAM_USER_IDS ||
    env?.ADMIN_TELEGRAM_IDS ||
    process.env?.ADMIN_TELEGRAM_USER_IDS ||
    process.env?.ADMIN_TELEGRAM_IDS ||
    "";
  const adminIds = adminIdsStr
    .split(",")
    .map((s: string) => s.trim())
    .filter(Boolean);

  return adminIds.includes(String(numId));
}

function escapeHtml(str: string): string {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatUserBadge(tier: string, isHeld: boolean): string {
  if (isHeld) return "⏸️ <b>ON HOLD</b>";
  if (tier === "admin") return "👑 <b>ADMIN</b>";
  if (tier === "premium") return "⚡ <b>PRO</b>";
  return "🆓 <b>FREE</b>";
}

function formatCampaignBadge(c: {
  isActive: boolean;
  claimedCount: number;
  maxClaims: number;
  startsAt?: string | null;
  endsAt?: string | null;
}): string {
  if (!c.isActive) return "⏸️ <b>PAUSED</b>";
  if (c.claimedCount >= c.maxClaims) return "🏁 <b>COMPLETED</b>";
  const now = Date.now();
  if (c.endsAt && new Date(c.endsAt).getTime() < now) return "⌛ <b>EXPIRED</b>";
  if (c.startsAt && new Date(c.startsAt).getTime() > now) return "⏳ <b>SCHEDULED</b>";
  return "🟢 <b>ACTIVE</b>";
}

/**
 * POST /api/bot/webhook
 * Main Telegram Bot Webhook endpoint
 */
botRouter.post("/webhook", async (c) => {
  const envObj = (c.env as any) || {};
  const botToken = envObj.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;

  if (!botToken) {
    console.error("[Bot Webhook Error]: TELEGRAM_BOT_TOKEN is missing");
    return c.text("Bot token missing", 500);
  }

  // Secret Token verification - mandatory in production
  const secretHeader = c.req.header("x-telegram-bot-api-secret-token");
  const expectedSecret = envObj.TELEGRAM_WEBHOOK_SECRET || process.env.TELEGRAM_WEBHOOK_SECRET;
  const isTestMode = envObj.TELEGRAM_TEST_MODE === "true" || process.env.TELEGRAM_TEST_MODE === "true";

  if (!isTestMode) {
    if (!expectedSecret || secretHeader !== expectedSecret) {
      return c.text("Unauthorized secret token", 403);
    }
  } else if (expectedSecret && secretHeader !== expectedSecret) {
    return c.text("Unauthorized secret token", 403);
  }

  const update = await c.req.json().catch(() => null);
  if (!update || !update.message) {
    return c.json({ ok: true });
  }

  const msg = update.message;
  const chatId = msg.chat?.id;
  const fromUser = msg.from;
  const text = (msg.text || "").trim();

  if (!chatId || !fromUser || !text) {
    return c.json({ ok: true });
  }

  const db = getDb(envObj.DB);
  const senderId = fromUser.id;
  const isAdmin = await isTelegramAdmin(db, envObj, senderId);

  // Command routing
  const parts = text.split(/\s+/);
  const rawCommand = parts[0].toLowerCase();
  const command = rawCommand.split("@")[0]; // handle /command@BotName
  const args = parts.slice(1);

  // --- 1. User-Facing / General Commands ---

  if (command === "/start" || command === "/help") {
    if (isAdmin) {
      const adminHelp = `⚡ <b>Aetheroll Admin Console</b>\n\n` +
        `Available administrative commands:\n\n` +
        `👥 <b>/users</b> [page] [search]\n` +
        `<i>List all registered users, tiers & media counts.</i>\n\n` +
        `👤 <b>/user</b> &lt;telegram_id&gt;\n` +
        `<i>Inspect a single user's detailed subscription status.</i>\n\n` +
        `🔑 <b>/gen</b> &lt;days&gt; [code] [max_uses]\n` +
        `<i>Generate a custom or random Pro promo code.</i>\n` +
        `<i>Example:</i> <code>/gen 30 SUMMER-2026</code>\n\n` +
        `⚡ <b>/assign</b> &lt;telegram_id&gt; [days]\n` +
        `<i>Directly grant Pro access to a user.</i>\n` +
        `<i>Example:</i> <code>/assign ${senderId} 30</code>\n\n` +
        `⏸️ <b>/hold</b> &lt;telegram_id&gt; [reason]\n` +
        `<i>Suspend a user's Pro privileges immediately.</i>\n` +
        `<i>Example:</i> <code>/hold ${senderId} Bandwidth limit</code>\n\n` +
        `▶️ <b>/resume</b> &lt;telegram_id&gt;\n` +
        `<i>Resume an on-hold Pro subscription.</i>\n\n` +
        `🗑️ <b>/revoke</b> &lt;telegram_id&gt;\n` +
        `<i>Reset user back to the Free tier.</i>\n\n` +
        `🎯 <b>/campaigns</b>\n` +
        `<i>List all signup reward campaigns & claims.</i>\n\n` +
        `➕ <b>/create_campaign</b> &lt;claims&gt; [days] &lt;name&gt;\n` +
        `<i>Create new signup campaign (e.g. <code>/create_campaign 100 30 Early Access</code>).</i>\n\n` +
        `🔍 <b>/campaign</b> &lt;campaign_id&gt;\n` +
        `<i>Inspect single campaign details.</i>\n\n` +
        `⏸️ <b>/pause_campaign</b> &lt;campaign_id&gt;\n` +
        `<i>Pause an active signup campaign.</i>\n\n` +
        `▶️ <b>/resume_campaign</b> &lt;campaign_id&gt;\n` +
        `<i>Resume a paused signup campaign.</i>\n\n` +
        `📈 <b>/extend_campaign</b> &lt;campaign_id&gt; &lt;new_max&gt;\n` +
        `<i>Adjust or increase max claims quota.</i>\n\n` +
        `🗑️ <b>/delete_campaign</b> &lt;campaign_id&gt;\n` +
        `<i>Delete a signup campaign.</i>\n\n` +
        `ℹ️ <b>/status</b>\n` +
        `<i>Check your own account status.</i>`;

      await sendTelegramMessage(botToken, chatId, adminHelp);
      ensureAdminCommandMenu(botToken, chatId);
      return c.json({ ok: true });
    } else {
      const userHelp = `🌌 <b>Welcome to Aetheroll!</b>\n\n` +
        `Aetheroll is your private, encrypted cloud gallery powered by Telegram MTProto.\n\n` +
        `📱 <b>Commands:</b>\n` +
        `• <b>/status</b> - Check your account tier and subscription details.\n\n` +
        `Download the app & log in with your Telegram account to get started!`;

      await sendTelegramMessage(botToken, chatId, userHelp);
      return c.json({ ok: true });
    }
  }

  if (command === "/status") {
    const user = await AdminService.getUserDetails(db, senderId);
    if (!user) {
      await sendTelegramMessage(
        botToken,
        chatId,
        `⚠️ <b>Account Not Found</b>\n\nYou have not logged into Aetheroll yet. Please sign in through the mobile app.`
      );
      return c.json({ ok: true });
    }

    const badge = formatUserBadge(user.tier, user.isTierHeld);
    const expStr = user.tierExpiresAt
      ? new Date(user.tierExpiresAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
      : "Lifetime / None";

    let statusMsg = `👤 <b>Aetheroll Account Status</b>\n\n` +
      `• <b>Name:</b> ${escapeHtml(user.displayName)}\n` +
      `• <b>Telegram ID:</b> <code>${user.telegramUserId}</code>\n` +
      `• <b>Tier:</b> ${badge}\n` +
      `• <b>Expiration:</b> ${expStr}\n` +
      `• <b>Indexed Media:</b> ${user.mediaCount ?? 0} items\n`;

    if (user.isTierHeld) {
      statusMsg += `\n⚠️ <i>Your Pro access is currently paused: ${escapeHtml(user.tierHoldReason || "Contact support")}</i>`;
    }

    await sendTelegramMessage(botToken, chatId, statusMsg);
    return c.json({ ok: true });
  }

  // --- 2. Admin-Only Commands ---

  if (!isAdmin) {
    await sendTelegramMessage(
      botToken,
      chatId,
      `⛔ <b>Access Denied</b>\n\nYou are not authorized to use administrator commands.`
    );
    return c.json({ ok: true });
  }

  // --- COMMAND: /users [page] [search] ---
  if (command === "/users" || command === "/list_users") {
    let page = 1;
    let search = "";

    if (args.length > 0) {
      if (/^\d+$/.test(args[0])) {
        page = parseInt(args[0], 10);
        search = args.slice(1).join(" ");
      } else {
        search = args.join(" ");
      }
    }

    const limit = 10;
    const offset = (page - 1) * limit;

    const { users, total } = await AdminService.listUsers(db, { limit, offset, search });
    const totalPages = Math.max(1, Math.ceil(total / limit));

    if (users.length === 0) {
      await sendTelegramMessage(
        botToken,
        chatId,
        `👥 <b>Aetheroll Users</b>\n\nNo users found matching your criteria.`
      );
      return c.json({ ok: true });
    }

    let response = `👥 <b>Aetheroll Users</b> (Page ${page}/${totalPages} • Total: ${total})\n\n`;

    users.forEach((u, idx) => {
      const num = offset + idx + 1;
      const badge = formatUserBadge(u.tier, u.isTierHeld);
      const expStr = u.tierExpiresAt
        ? ` (Exp: ${new Date(u.tierExpiresAt).toLocaleDateString()})`
        : "";

      response += `${num}. <b>${escapeHtml(u.displayName)}</b>\n` +
        `   • ID: <code>${u.telegramUserId}</code>\n` +
        `   • Tier: ${badge}${expStr}\n\n`;
    });

    if (totalPages > 1) {
      response += `<i>Use <code>/users ${page < totalPages ? page + 1 : 1}</code> to view next page.</i>`;
    }

    await sendTelegramMessage(botToken, chatId, response);
    return c.json({ ok: true });
  }

  // --- COMMAND: /user <telegram_id> ---
  if (command === "/user" || command === "/inspect") {
    if (args.length === 0) {
      await sendTelegramMessage(
        botToken,
        chatId,
        `⚠️ <b>Usage:</b> <code>/user &lt;telegram_id&gt;</code>`
      );
      return c.json({ ok: true });
    }

    const target = args[0];
    const user = await AdminService.getUserDetails(db, target);

    if (!user) {
      await sendTelegramMessage(
        botToken,
        chatId,
        `❌ User <code>${escapeHtml(target)}</code> not found in database.`
      );
      return c.json({ ok: true });
    }

    const badge = formatUserBadge(user.tier, user.isTierHeld);
    const expStr = user.tierExpiresAt
      ? new Date(user.tierExpiresAt).toISOString()
      : "Lifetime / None";

    const detailMsg = `👤 <b>User Inspection</b>\n\n` +
      `• <b>Name:</b> ${escapeHtml(user.displayName)}\n` +
      `• <b>Telegram ID:</b> <code>${user.telegramUserId}</code>\n` +
      `• <b>UUID:</b> <code>${user.id}</code>\n` +
      `• <b>Tier:</b> ${badge}\n` +
      `• <b>Expires:</b> <code>${expStr}</code>\n` +
      `• <b>Granted By:</b> <code>${escapeHtml(user.tierGrantedBy || "none")}</code>\n` +
      `• <b>Indexed Media:</b> <b>${user.mediaCount ?? 0}</b> items\n` +
      `• <b>Joined:</b> <code>${user.createdAt}</code>\n` +
      (user.isTierHeld ? `\n⚠️ <b>Hold Reason:</b> <i>${escapeHtml(user.tierHoldReason || "None")}</i>` : "");

    await sendTelegramMessage(botToken, chatId, detailMsg);
    return c.json({ ok: true });
  }

  // --- COMMAND: /gen <days> [custom_code] [max_uses] ---
  if (command === "/gen" || command === "/generate") {
    let days: number | null = 30;
    let customCode: string | undefined;
    let maxUses = 1;

    if (args.length > 0) {
      const parsedDays = parseInt(args[0], 10);
      if (!isNaN(parsedDays)) {
        days = parsedDays === 0 ? null : parsedDays;
      }
    }

    if (args.length > 1) {
      customCode = args[1];
    }

    if (args.length > 2) {
      const parsedUses = parseInt(args[2], 10);
      if (!isNaN(parsedUses) && parsedUses > 0) {
        maxUses = parsedUses;
      }
    }

    try {
      const codeRecord = await AdminService.generateActivationCode(db, {
        code: customCode,
        durationDays: days,
        maxUses,
        note: `Generated by admin telegram_id:${senderId}`,
      });

      const genMsg = `⚡ <b>Pro Activation Code Generated</b>\n\n` +
        `🔑 Code: <code>${codeRecord.code}</code> <i>(tap to copy)</i>\n` +
        `⏳ Duration: <b>${codeRecord.durationDays ? `${codeRecord.durationDays} days` : "Lifetime"}</b>\n` +
        `👥 Max Redemptions: <b>${codeRecord.maxUses}</b>\n\n` +
        `<i>Share this code with the user to redeem in Aetheroll settings.</i>`;

      await sendTelegramMessage(botToken, chatId, genMsg);
    } catch (err: any) {
      console.error("[Bot /gen Error]:", err);
      const safeMsg = err.message && !err.message.includes("SQLITE") && !err.message.includes("Prepare")
        ? err.message
        : "Failed to generate code. Please check parameters.";
      await sendTelegramMessage(
        botToken,
        chatId,
        `❌ <b>Generation Failed:</b> ${escapeHtml(safeMsg)}`
      );
    }
    return c.json({ ok: true });
  }

  // --- COMMAND: /assign <telegram_id> [days] ---
  if (command === "/assign" || command === "/upgrade") {
    if (args.length === 0) {
      await sendTelegramMessage(
        botToken,
        chatId,
        `⚠️ <b>Usage:</b> <code>/assign &lt;telegram_id&gt; [days=30]</code>`
      );
      return c.json({ ok: true });
    }

    const target = args[0];
    let days: number | null = 30;
    if (args.length > 1) {
      const parsed = parseInt(args[1], 10);
      if (!isNaN(parsed)) days = parsed === 0 ? null : parsed;
    }

    try {
      const { user } = await AdminService.assignUserTier(db, {
        targetUser: target,
        durationDays: days,
        grantedBy: `bot_admin_${senderId}`,
      });

      const expStr = user.tierExpiresAt
        ? new Date(user.tierExpiresAt).toLocaleDateString()
        : "Lifetime";

      const assignMsg = `✅ <b>Pro Membership Assigned</b>\n\n` +
        `• <b>User:</b> ${escapeHtml(user.displayName)}\n` +
        `• <b>ID:</b> <code>${user.telegramUserId}</code>\n` +
        `• <b>Tier:</b> ⚡ <b>PRO</b>\n` +
        `• <b>Duration:</b> ${days ? `${days} days` : "Lifetime"} (Expires: ${expStr})`;

      await sendTelegramMessage(botToken, chatId, assignMsg);
    } catch (err: any) {
      console.error("[Bot /assign Error]:", err);
      const safeMsg = err.message && !err.message.includes("SQLITE") ? err.message : "Failed to assign tier.";
      await sendTelegramMessage(
        botToken,
        chatId,
        `❌ <b>Assignment Failed:</b> ${escapeHtml(safeMsg)}`
      );
    }
    return c.json({ ok: true });
  }

  // --- COMMAND: /hold <telegram_id> [reason] ---
  if (command === "/hold" || command === "/pause") {
    if (args.length === 0) {
      await sendTelegramMessage(
        botToken,
        chatId,
        `⚠️ <b>Usage:</b> <code>/hold &lt;telegram_id&gt; [reason]</code>`
      );
      return c.json({ ok: true });
    }

    const target = args[0];
    const reason = args.slice(1).join(" ") || "Administrative hold";

    try {
      const { user } = await AdminService.holdUserTier(db, {
        targetUser: target,
        reason,
      });

      const holdMsg = `⏸️ <b>User Subscription On Hold</b>\n\n` +
        `• <b>User:</b> ${escapeHtml(user.displayName)}\n` +
        `• <b>ID:</b> <code>${user.telegramUserId}</code>\n` +
        `• <b>Reason:</b> <i>${escapeHtml(reason)}</i>\n\n` +
        `🚫 <i>Cloudflare Turbo Edge streaming and Direct Uploads are now suspended for this user.</i>`;

      await sendTelegramMessage(botToken, chatId, holdMsg);
    } catch (err: any) {
      console.error("[Bot /hold Error]:", err);
      const safeMsg = err.message && !err.message.includes("SQLITE") ? err.message : "Failed to hold tier.";
      await sendTelegramMessage(
        botToken,
        chatId,
        `❌ <b>Hold Failed:</b> ${escapeHtml(safeMsg)}`
      );
    }
    return c.json({ ok: true });
  }

  // --- COMMAND: /resume <telegram_id> ---
  if (command === "/resume" || command === "/unhold") {
    if (args.length === 0) {
      await sendTelegramMessage(
        botToken,
        chatId,
        `⚠️ <b>Usage:</b> <code>/resume &lt;telegram_id&gt;</code>`
      );
      return c.json({ ok: true });
    }

    const target = args[0];

    try {
      const { user } = await AdminService.resumeUserTier(db, target);

      const resumeMsg = `▶️ <b>User Subscription Resumed</b>\n\n` +
        `• <b>User:</b> ${escapeHtml(user.displayName)}\n` +
        `• <b>ID:</b> <code>${user.telegramUserId}</code>\n` +
        `• <b>Tier:</b> ${formatUserBadge(user.tier, false)}\n\n` +
        `✅ <i>User Pro privileges have been restored.</i>`;

      await sendTelegramMessage(botToken, chatId, resumeMsg);
    } catch (err: any) {
      console.error("[Bot /resume Error]:", err);
      const safeMsg = err.message && !err.message.includes("SQLITE") ? err.message : "Failed to resume tier.";
      await sendTelegramMessage(
        botToken,
        chatId,
        `❌ <b>Resume Failed:</b> ${escapeHtml(safeMsg)}`
      );
    }
    return c.json({ ok: true });
  }

  // --- COMMAND: /revoke <telegram_id> ---
  if (command === "/revoke" || command === "/remove") {
    if (args.length === 0) {
      await sendTelegramMessage(
        botToken,
        chatId,
        `⚠️ <b>Usage:</b> <code>/revoke &lt;telegram_id&gt;</code>`
      );
      return c.json({ ok: true });
    }

    const target = args[0];

    try {
      const { user } = await AdminService.revokeUserTier(db, target);

      const revokeMsg = `🗑️ <b>User Subscription Revoked</b>\n\n` +
        `• <b>User:</b> ${escapeHtml(user.displayName)}\n` +
        `• <b>ID:</b> <code>${user.telegramUserId}</code>\n` +
        `• <b>Tier:</b> 🆓 <b>FREE</b>\n\n` +
        `<i>User has been reset to the free tier.</i>`;

      await sendTelegramMessage(botToken, chatId, revokeMsg);
    } catch (err: any) {
      console.error("[Bot /revoke Error]:", err);
      const safeMsg = err.message && !err.message.includes("SQLITE") ? err.message : "Failed to revoke tier.";
      await sendTelegramMessage(
        botToken,
        chatId,
        `❌ <b>Revocation Failed:</b> ${escapeHtml(safeMsg)}`
      );
    }
    return c.json({ ok: true });
  }

  // --- COMMAND: /campaigns ---
  if (command === "/campaigns" || command === "/list_campaigns") {
    const campaigns = await CampaignService.listCampaigns(db);

    if (campaigns.length === 0) {
      await sendTelegramMessage(
        botToken,
        chatId,
        `🎯 <b>Signup Reward Campaigns</b>\n\nNo campaigns found.\n\n` +
        `<i>Create one with:</i>\n<code>/create_campaign 100 30 Early Access Promo</code>`
      );
      return c.json({ ok: true });
    }

    let response = `🎯 <b>Signup Reward Campaigns</b> (Total: ${campaigns.length})\n\n`;

    campaigns.forEach((camp, idx) => {
      const num = idx + 1;
      const badge = formatCampaignBadge(camp);
      const tierStr = camp.targetTier === "premium"
        ? `⚡ Pro (${camp.durationDays ? `${camp.durationDays}d` : "Lifetime"})`
        : "🆓 Free";
      const pct = camp.maxClaims > 0 ? Math.round((camp.claimedCount / camp.maxClaims) * 100) : 0;

      response += `${num}. <b>${escapeHtml(camp.name)}</b> [<code>${camp.id}</code>]\n` +
        `   • Status: ${badge}\n` +
        `   • Reward: ${tierStr}\n` +
        `   • Quota: <b>${camp.claimedCount}</b> / <b>${camp.maxClaims}</b> (${pct}%)\n` +
        (camp.priority ? `   • Priority: <code>${camp.priority}</code>\n` : "") +
        `\n`;
    });

    response += `<i>Use <code>/campaign &lt;id&gt;</code> to inspect or manage.</i>`;

    await sendTelegramMessage(botToken, chatId, response);
    return c.json({ ok: true });
  }

  // --- COMMAND: /campaign <campaign_id> ---
  if (command === "/campaign" || command === "/inspect_campaign") {
    if (args.length === 0) {
      await sendTelegramMessage(
        botToken,
        chatId,
        `⚠️ <b>Usage:</b> <code>/campaign &lt;campaign_id&gt;</code>\n\n<i>Example:</i> <code>/campaign welcome_first_100</code>`
      );
      return c.json({ ok: true });
    }

    const targetId = args[0].trim();
    const camp = await CampaignService.getCampaign(db, targetId);

    if (!camp) {
      await sendTelegramMessage(
        botToken,
        chatId,
        `❌ Campaign <code>${escapeHtml(targetId)}</code> not found in database.`
      );
      return c.json({ ok: true });
    }

    const badge = formatCampaignBadge(camp);
    const tierStr = camp.targetTier === "premium"
      ? `⚡ <b>PRO</b> (${camp.durationDays ? `${camp.durationDays} days` : "Lifetime"})`
      : "🆓 <b>FREE</b>";
    const remaining = Math.max(0, camp.maxClaims - camp.claimedCount);
    const pct = camp.maxClaims > 0 ? Math.round((camp.claimedCount / camp.maxClaims) * 100) : 0;

    const detailMsg = `🎯 <b>Campaign Inspection</b>\n\n` +
      `• <b>Name:</b> ${escapeHtml(camp.name)}\n` +
      `• <b>ID:</b> <code>${camp.id}</code>\n` +
      `• <b>Status:</b> ${badge}\n` +
      `• <b>Reward:</b> ${tierStr}\n` +
      `• <b>Claimed:</b> <b>${camp.claimedCount}</b> / <b>${camp.maxClaims}</b> (${pct}%)\n` +
      `• <b>Remaining Slots:</b> <b>${remaining}</b>\n` +
      `• <b>Priority:</b> <code>${camp.priority}</code>\n` +
      (camp.startsAt ? `• <b>Starts At:</b> <code>${camp.startsAt}</code>\n` : "") +
      (camp.endsAt ? `• <b>Ends At:</b> <code>${camp.endsAt}</code>\n` : "") +
      `• <b>Created:</b> <code>${camp.createdAt}</code>\n\n` +
      `💡 <i>Quick Actions:</i>\n` +
      `• <code>/pause_campaign ${camp.id}</code>\n` +
      `• <code>/resume_campaign ${camp.id}</code>\n` +
      `• <code>/extend_campaign ${camp.id} &lt;new_max&gt;</code>\n` +
      `• <code>/delete_campaign ${camp.id}</code>`;

    await sendTelegramMessage(botToken, chatId, detailMsg);
    return c.json({ ok: true });
  }

  // --- COMMAND: /create_campaign <claims> [days] <name> ---
  if (
    command === "/create_campaign" ||
    command === "/new_campaign" ||
    command === "/add_campaign"
  ) {
    if (args.length < 2) {
      const helpMsg = `⚠️ <b>Usage:</b> <code>/create_campaign &lt;max_claims&gt; [duration_days] &lt;name&gt;</code>\n\n` +
        `<b>Examples:</b>\n` +
        `• <code>/create_campaign 100 30 Launch Promo</code> (100 claims, 30-day Pro)\n` +
        `• <code>/create_campaign 50 0 VIP Lifetime</code> (50 claims, Lifetime Pro)\n` +
        `• <code>/create_campaign 200 Beta Access</code> (200 claims, default 30 days)`;
      await sendTelegramMessage(botToken, chatId, helpMsg);
      return c.json({ ok: true });
    }

    const maxClaims = parseInt(args[0], 10);
    if (isNaN(maxClaims) || maxClaims <= 0) {
      await sendTelegramMessage(
        botToken,
        chatId,
        `❌ <b>Invalid Quota:</b> <code>max_claims</code> must be a positive number.`
      );
      return c.json({ ok: true });
    }

    let durationDays: number | null = 30;
    let name = "";

    if (args.length >= 3 && /^\d+$/.test(args[1])) {
      const parsedDays = parseInt(args[1], 10);
      durationDays = parsedDays === 0 ? null : parsedDays;
      name = args.slice(2).join(" ").trim();
    } else {
      durationDays = 30;
      name = args.slice(1).join(" ").trim();
    }

    if (!name) {
      await sendTelegramMessage(
        botToken,
        chatId,
        `❌ <b>Missing Name:</b> Campaign name is required.`
      );
      return c.json({ ok: true });
    }

    try {
      const camp = await CampaignService.createCampaign(db, {
        name,
        maxClaims,
        durationDays,
        targetTier: "premium",
      });

      const tierStr = camp.targetTier === "premium"
        ? `⚡ <b>PRO (${camp.durationDays ? `${camp.durationDays} days` : "Lifetime"})</b>`
        : "🆓 <b>FREE</b>";

      const createMsg = `✅ <b>Signup Campaign Created!</b>\n\n` +
        `• <b>Name:</b> ${escapeHtml(camp.name)}\n` +
        `• <b>ID:</b> <code>${camp.id}</code>\n` +
        `• <b>Reward:</b> ${tierStr}\n` +
        `• <b>Quota:</b> <b>${camp.maxClaims}</b> claims\n` +
        `• <b>Status:</b> 🟢 <b>ACTIVE</b>\n\n` +
        `<i>New users signing up will automatically receive this reward until quota is exhausted.</i>`;

      await sendTelegramMessage(botToken, chatId, createMsg);
    } catch (err: any) {
      console.error("[Bot /create_campaign Error]:", err);
      const safeMsg = err.message && !err.message.includes("SQLITE") ? err.message : "Failed to create campaign.";
      await sendTelegramMessage(
        botToken,
        chatId,
        `❌ <b>Creation Failed:</b> ${escapeHtml(safeMsg)}`
      );
    }
    return c.json({ ok: true });
  }

  // --- COMMAND: /pause_campaign <campaign_id> ---
  if (command === "/pause_campaign" || command === "/hold_campaign") {
    if (args.length === 0) {
      await sendTelegramMessage(
        botToken,
        chatId,
        `⚠️ <b>Usage:</b> <code>/pause_campaign &lt;campaign_id&gt;</code>`
      );
      return c.json({ ok: true });
    }

    const targetId = args[0].trim();

    try {
      const camp = await CampaignService.updateCampaign(db, targetId, { isActive: false });

      const pauseMsg = `⏸️ <b>Campaign Paused</b>\n\n` +
        `• <b>Campaign:</b> ${escapeHtml(camp.name)} (<code>${camp.id}</code>)\n` +
        `• <b>Status:</b> ⏸️ <b>PAUSED</b>\n\n` +
        `<i>Reward claims for this campaign are now disabled.</i>`;

      await sendTelegramMessage(botToken, chatId, pauseMsg);
    } catch (err: any) {
      console.error("[Bot /pause_campaign Error]:", err);
      const safeMsg = err.message && !err.message.includes("SQLITE") ? err.message : "Failed to pause campaign.";
      await sendTelegramMessage(
        botToken,
        chatId,
        `❌ <b>Pause Failed:</b> ${escapeHtml(safeMsg)}`
      );
    }
    return c.json({ ok: true });
  }

  // --- COMMAND: /resume_campaign <campaign_id> ---
  if (command === "/resume_campaign" || command === "/unpause_campaign") {
    if (args.length === 0) {
      await sendTelegramMessage(
        botToken,
        chatId,
        `⚠️ <b>Usage:</b> <code>/resume_campaign &lt;campaign_id&gt;</code>`
      );
      return c.json({ ok: true });
    }

    const targetId = args[0].trim();

    try {
      const camp = await CampaignService.updateCampaign(db, targetId, { isActive: true });

      const resumeMsg = `▶️ <b>Campaign Resumed</b>\n\n` +
        `• <b>Campaign:</b> ${escapeHtml(camp.name)} (<code>${camp.id}</code>)\n` +
        `• <b>Status:</b> 🟢 <b>ACTIVE</b>\n\n` +
        `<i>Eligible new signups will now receive rewards from this campaign.</i>`;

      await sendTelegramMessage(botToken, chatId, resumeMsg);
    } catch (err: any) {
      console.error("[Bot /resume_campaign Error]:", err);
      const safeMsg = err.message && !err.message.includes("SQLITE") ? err.message : "Failed to resume campaign.";
      await sendTelegramMessage(
        botToken,
        chatId,
        `❌ <b>Resume Failed:</b> ${escapeHtml(safeMsg)}`
      );
    }
    return c.json({ ok: true });
  }

  // --- COMMAND: /extend_campaign <campaign_id> <new_max_claims> ---
  if (command === "/extend_campaign" || command === "/update_campaign_quota") {
    if (args.length < 2) {
      await sendTelegramMessage(
        botToken,
        chatId,
        `⚠️ <b>Usage:</b> <code>/extend_campaign &lt;campaign_id&gt; &lt;new_max_claims&gt;</code>\n\n` +
        `<i>Example:</i> <code>/extend_campaign welcome_first_100 200</code>`
      );
      return c.json({ ok: true });
    }

    const targetId = args[0].trim();
    const newMax = parseInt(args[1], 10);

    if (isNaN(newMax) || newMax <= 0) {
      await sendTelegramMessage(
        botToken,
        chatId,
        `❌ <code>new_max_claims</code> must be a positive integer.`
      );
      return c.json({ ok: true });
    }

    try {
      const camp = await CampaignService.updateCampaign(db, targetId, { maxClaims: newMax });
      const remaining = Math.max(0, camp.maxClaims - camp.claimedCount);

      const extendMsg = `📈 <b>Campaign Quota Updated</b>\n\n` +
        `• <b>Campaign:</b> ${escapeHtml(camp.name)} (<code>${camp.id}</code>)\n` +
        `• <b>New Quota:</b> <b>${camp.claimedCount}</b> / <b>${camp.maxClaims}</b> claims (${remaining} remaining slots)`;

      await sendTelegramMessage(botToken, chatId, extendMsg);
    } catch (err: any) {
      console.error("[Bot /extend_campaign Error]:", err);
      const safeMsg = err.message && !err.message.includes("SQLITE") ? err.message : "Failed to extend campaign.";
      await sendTelegramMessage(
        botToken,
        chatId,
        `❌ <b>Update Failed:</b> ${escapeHtml(safeMsg)}`
      );
    }
    return c.json({ ok: true });
  }

  // --- COMMAND: /delete_campaign <campaign_id> ---
  if (
    command === "/delete_campaign" ||
    command === "/del_campaign" ||
    command === "/remove_campaign"
  ) {
    if (args.length === 0) {
      await sendTelegramMessage(
        botToken,
        chatId,
        `⚠️ <b>Usage:</b> <code>/delete_campaign &lt;campaign_id&gt;</code>`
      );
      return c.json({ ok: true });
    }

    const targetId = args[0].trim();

    try {
      const deleted = await CampaignService.deleteCampaign(db, targetId);
      if (!deleted) {
        await sendTelegramMessage(
          botToken,
          chatId,
          `❌ Campaign <code>${escapeHtml(targetId)}</code> not found in database.`
        );
        return c.json({ ok: true });
      }

      const delMsg = `🗑️ <b>Campaign Deleted</b>\n\n` +
        `Campaign <code>${escapeHtml(targetId)}</code> has been permanently removed.`;

      await sendTelegramMessage(botToken, chatId, delMsg);
    } catch (err: any) {
      console.error("[Bot /delete_campaign Error]:", err);
      const safeMsg = err.message && !err.message.includes("SQLITE") ? err.message : "Failed to delete campaign.";
      await sendTelegramMessage(
        botToken,
        chatId,
        `❌ <b>Delete Failed:</b> ${escapeHtml(safeMsg)}`
      );
    }
    return c.json({ ok: true });
  }

  return c.json({ ok: true });
});

/**
 * Checks if caller is authorized as an admin via secret header or admin session
 */
async function verifyAdminHttpCaller(c: any): Promise<boolean> {
  const envObj = (c.env as any) || {};
  const adminSecret = envObj.ADMIN_SECRET || process.env.ADMIN_SECRET;
  const reqSecret = c.req.header("x-admin-secret");

  if (adminSecret && reqSecret === adminSecret) {
    return true;
  }

  const auth = await resolveUserAuth(c);
  return !!(auth.authenticated && auth.isAdmin);
}

/**
 * POST /api/bot/setup-webhook
 * Helper endpoint to register the Telegram webhook with Telegram Bot API (Admin Protected)
 */
botRouter.post("/setup-webhook", async (c) => {
  const isAdmin = await verifyAdminHttpCaller(c);
  if (!isAdmin) {
    return c.json({ error: "Unauthorized: Admin privileges required." }, 403);
  }

  const envObj = (c.env as any) || {};
  const botToken = envObj.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return c.json({ error: "TELEGRAM_BOT_TOKEN is missing" }, 500);
  }

  const body = await c.req.json().catch(() => ({}));
  let targetHost = body.webhook_url;

  if (targetHost) {
    try {
      const parsed = new URL(targetHost);
      if (parsed.protocol !== "https:") {
        return c.json({ error: "webhook_url must use HTTPS" }, 400);
      }
      targetHost = parsed.origin;
    } catch {
      return c.json({ error: "Invalid webhook_url format" }, 400);
    }
  } else {
    targetHost = `https://${c.req.header("host")}`;
  }

  const fullWebhookUrl = `${targetHost}/api/bot/webhook`;
  const secretToken = envObj.TELEGRAM_WEBHOOK_SECRET || process.env.TELEGRAM_WEBHOOK_SECRET || undefined;

  const tgUrl = `https://api.telegram.org/bot${botToken}/setWebhook`;
  const res = await fetch(tgUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: fullWebhookUrl,
      secret_token: secretToken,
      allowed_updates: ["message"],
    }),
  });

  const tgData = await res.json();
  return c.json({
    configuredUrl: fullWebhookUrl,
    telegramResponse: tgData,
  });
});

/**
 * GET /api/bot/webhook-info
 * Returns current webhook status from Telegram Bot API (Admin Protected)
 */
botRouter.get("/webhook-info", async (c) => {
  const isAdmin = await verifyAdminHttpCaller(c);
  if (!isAdmin) {
    return c.json({ error: "Unauthorized: Admin privileges required." }, 403);
  }

  const envObj = (c.env as any) || {};
  const botToken = envObj.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return c.json({ error: "TELEGRAM_BOT_TOKEN is missing" }, 500);
  }

  const tgUrl = `https://api.telegram.org/bot${botToken}/getWebhookInfo`;
  const res = await fetch(tgUrl);
  const data = await res.json();
  return c.json(data);
});
