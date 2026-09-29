import { Hono } from "hono";
import { getDb } from "../../lib/db";
import { resolveUserAuth } from "../../lib/auth";
import { AdminService } from "../../services/adminService";

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
 * Checks whether a given Telegram User ID has administrator privileges
 */
async function isTelegramAdmin(
  db: any,
  env: any,
  telegramUserId: number | string
): Promise<boolean> {
  const numId = Number(telegramUserId);
  if (!numId) return false;

  // 1. Check environment variable list of admin IDs (e.g. "1139540899,987654321")
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

  if (adminIds.includes(String(numId))) {
    return true;
  }

  // 2. Check D1 users table for tier = 'admin'
  try {
    const user = await db.get(
      `SELECT tier FROM users WHERE telegram_user_id = ? LIMIT 1`,
      [numId]
    );
    if (user && user.tier === "admin") {
      return true;
    }
  } catch {}

  return false;
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

  // Secret Token verification
  const secretHeader = c.req.header("x-telegram-bot-api-secret-token");
  const expectedSecret = envObj.TELEGRAM_WEBHOOK_SECRET || process.env.TELEGRAM_WEBHOOK_SECRET;
  const isTestMode = envObj.TELEGRAM_TEST_MODE === "true" || process.env.TELEGRAM_TEST_MODE === "true";

  if (expectedSecret) {
    if (secretHeader !== expectedSecret) {
      return c.text("Unauthorized secret token", 403);
    }
  } else if (!isTestMode) {
    console.warn("[Bot Webhook Security Warning]: TELEGRAM_WEBHOOK_SECRET is not configured. Webhook calls are unauthenticated.");
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
