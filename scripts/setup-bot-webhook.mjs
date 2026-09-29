#!/usr/bin/env node

/**
 * ⚡ Aetheroll Telegram Bot Webhook Setup & Inspector
 *
 * Usage:
 *   node scripts/setup-bot-webhook.mjs [options]
 *
 * Options:
 *   --set, -s       Register webhook URL with Telegram Bot API
 *   --url, -u       Worker base URL (e.g. https://aetheroll.shivareddyvanja.workers.dev)
 *   --secret        Optional secret token for X-Telegram-Bot-Api-Secret-Token
 *   --info, -i      Fetch current webhook info from Telegram
 *   --delete, -d    Delete existing webhook (switches bot to polling)
 *   --token, -t     Telegram Bot Token (defaults to env TELEGRAM_BOT_TOKEN)
 *
 * Examples:
 *   node scripts/setup-bot-webhook.mjs --set --url https://aetheroll.shivareddyvanja.workers.dev
 *   node scripts/setup-bot-webhook.mjs --info
 */

import https from 'https';

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    action: 'info', // 'set', 'info', 'delete'
    url: 'https://aetheroll.shivareddyvanja.workers.dev',
    secret: process.env.TELEGRAM_WEBHOOK_SECRET || '',
    token: process.env.TELEGRAM_BOT_TOKEN || '',
    admins: process.env.ADMIN_TELEGRAM_USER_IDS || process.env.ADMIN_TELEGRAM_IDS || '1139540899',
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--set' || arg === '-s') {
      options.action = 'set';
    } else if (arg === '--commands' || arg === '-c') {
      options.action = 'commands';
    } else if (arg === '--info' || arg === '-i') {
      options.action = 'info';
    } else if (arg === '--delete' || arg === '-d') {
      options.action = 'delete';
    } else if (arg === '--url' || arg === '-u') {
      options.url = args[++i];
    } else if (arg === '--secret') {
      options.secret = args[++i];
    } else if (arg === '--token' || arg === '-t') {
      options.token = args[++i];
    } else if (arg === '--admins' || arg === '-a') {
      options.admins = args[++i];
    }
  }

  return options;
}

async function request(url, body = null) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: body ? 'POST' : 'GET',
      headers: body
        ? {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(JSON.stringify(body)),
          }
        : {},
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(data);
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  const opts = parseArgs();

  console.log('\n' + '━'.repeat(64));
  console.log('  ⚡ AETHEROLL TELEGRAM BOT WEBHOOK SETUP');
  console.log('━'.repeat(64));

  // If token is missing, try reading from .dev.vars if available
  let botToken = opts.token;
  if (!botToken) {
    try {
      const fs = await import('fs');
      if (fs.existsSync('workers/api/.dev.vars')) {
        const content = fs.readFileSync('workers/api/.dev.vars', 'utf8');
        const match = content.match(/TELEGRAM_BOT_TOKEN=["']?([^"'\n\r]+)["']?/);
        if (match) botToken = match[1];
      }
    } catch {}
  }

  if (!botToken) {
    console.error('❌ Error: TELEGRAM_BOT_TOKEN is required. Pass --token or set in environment.\n');
    process.exit(1);
  }

  const publicCommands = [
    { command: 'status', description: 'Check your account & subscription status' },
    { command: 'help', description: 'Get help and app information' },
  ];

  const adminCommands = [
    { command: 'status', description: 'Check your account & subscription status' },
    { command: 'users', description: 'List registered users & tiers (Admin)' },
    { command: 'user', description: 'Inspect single user details (Admin)' },
    { command: 'gen', description: 'Generate a Pro activation code (Admin)' },
    { command: 'assign', description: 'Grant Pro membership to user (Admin)' },
    { command: 'hold', description: 'Put user subscription on hold (Admin)' },
    { command: 'resume', description: 'Resume paused subscription (Admin)' },
    { command: 'revoke', description: 'Revoke subscription to Free (Admin)' },
    { command: 'help', description: 'Show admin command guide' },
  ];

  const adminList = (opts.admins || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  async function registerScopedCommands() {
    console.log('📋 1. Registering DEFAULT commands for regular users...');
    const defRes = await request(`https://api.telegram.org/bot${botToken}/setMyCommands`, {
      commands: publicCommands,
      scope: { type: 'default' },
    });
    console.log('Default Scope Response:', JSON.stringify(defRes, null, 2));

    for (const adminId of adminList) {
      const numericId = parseInt(adminId, 10);
      if (isNaN(numericId)) continue;
      console.log(`📋 2. Registering ADMIN commands for chat ID [${numericId}]...`);
      const admRes = await request(`https://api.telegram.org/bot${botToken}/setMyCommands`, {
        commands: adminCommands,
        scope: { type: 'chat', chat_id: numericId },
      });
      console.log(`Admin [${numericId}] Scope Response:`, JSON.stringify(admRes, null, 2));
    }
  }

  if (opts.action === 'commands') {
    await registerScopedCommands();
    console.log('\n✅ Scoped command menus successfully updated in Telegram!\n');
  } else if (opts.action === 'set') {
    const baseUrl = opts.url.replace(/\/$/, '');
    const webhookUrl = `${baseUrl}/api/bot/webhook`;

    console.log(`📡 Setting webhook to: ${webhookUrl}`);
    const payload = {
      url: webhookUrl,
      allowed_updates: ['message'],
    };
    if (opts.secret) {
      payload.secret_token = opts.secret;
    }

    const res = await request(`https://api.telegram.org/bot${botToken}/setWebhook`, payload);
    console.log('Telegram Webhook Response:', JSON.stringify(res, null, 2));

    await registerScopedCommands();

    if (res.ok) {
      console.log('\n✅ Webhook and Scoped Command Menus successfully registered!\n');
    } else {
      console.error('\n⚠️ Setup completed with warnings. Check API responses above.\n');
    }
  } else if (opts.action === 'delete') {
    console.log('🗑️ Deleting webhook from Telegram Bot API...');
    const res = await request(`https://api.telegram.org/bot${botToken}/deleteWebhook`);
    console.log('Telegram API Response:', JSON.stringify(res, null, 2));
  } else {
    console.log('🔍 Fetching current webhook info...');
    const res = await request(`https://api.telegram.org/bot${botToken}/getWebhookInfo`);
    console.log('\nCurrent Webhook Status:');
    console.log(JSON.stringify(res, null, 2));

    const cmdInfo = await request(`https://api.telegram.org/bot${botToken}/getMyCommands`);
    console.log('\nCurrent Registered Commands:');
    console.log(JSON.stringify(cmdInfo, null, 2));

    console.log('\n💡 Tip: To register webhook & commands, run:');
    console.log(`  node scripts/setup-bot-webhook.mjs --set --url "${opts.url}"\n`);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
