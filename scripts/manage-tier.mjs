#!/usr/bin/env node

/**
 * ⚡ Aetheroll Tier & Account Hold Management CLI
 * Allows administrators to pause, hold, resume, or check Pro tier status for users.
 *
 * Usage:
 *   node scripts/manage-tier.mjs [options]
 *
 * Options:
 *   --user, -u      User ID, username, or phone number (e.g. 1, @username, or +123456789)
 *   --hold          Place user tier on hold (suspends Pro access)
 *   --resume        Resume user tier (restores Pro access)
 *   --reason, -r    Reason for hold (default: "Administrative hold")
 *   --status, -s    Inspect user tier & hold status
 *   --exec, -e      Automatically run SQL via wrangler d1 execute DB --remote
 *   --format, -f    Output format: "sql" (default) or "json"
 *
 * Examples:
 *   node scripts/manage-tier.mjs --user 1 --hold --reason "Abnormal egress traffic"
 *   node scripts/manage-tier.mjs --user "@johndoe" --resume
 *   node scripts/manage-tier.mjs --user 1 --hold -e
 */

import { execSync } from 'child_process';

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    user: null,
    action: null, // 'hold', 'resume', 'status'
    reason: 'Administrative hold',
    exec: false,
    format: 'sql',
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--user' || arg === '-u') {
      options.user = args[++i];
    } else if (arg === '--hold') {
      options.action = 'hold';
    } else if (arg === '--resume') {
      options.action = 'resume';
    } else if (arg === '--status' || arg === '-s') {
      options.action = 'status';
    } else if (arg === '--reason' || arg === '-r') {
      options.reason = args[++i] || 'Administrative hold';
    } else if (arg === '--exec' || arg === '-e') {
      options.exec = true;
    } else if (arg === '--format' || arg === '-f') {
      options.format = args[++i] || 'sql';
    }
  }

  return options;
}

function buildUserWhereClause(identifier) {
  if (!identifier) {
    throw new Error('User identifier (--user <id|tgUserId|displayName>) is required.');
  }

  const clean = identifier.trim();
  if (/^\d+$/.test(clean)) {
    // Numeric Telegram User ID
    return `(telegram_user_id = ${clean} OR id = '${clean}')`;
  }
  const escaped = clean.replace(/'/g, "''");
  return `(id = '${escaped}' OR display_name LIKE '%${escaped}%')`;
}

function main() {
  const opts = parseArgs();

  if (!opts.user) {
    console.log(`
⚡ Aetheroll Tier & Hold Management CLI

Usage:
  node scripts/manage-tier.mjs --user <id|@username|phone> --hold [--reason "Reason"]
  node scripts/manage-tier.mjs --user <id|@username|phone> --resume
  node scripts/manage-tier.mjs --user <id|@username|phone> --status

Options:
  --user, -u    Target user ID, @username, or phone number
  --hold        Suspend user Pro access
  --resume      Restore user Pro access
  --reason, -r  Hold reason note
  --exec, -e    Directly execute via wrangler d1 DB --remote
`);
    process.exit(1);
  }

  const whereClause = buildUserWhereClause(opts.user);
  let sql = '';
  let description = '';

  if (opts.action === 'hold') {
    const escapedReason = opts.reason.replace(/'/g, "''");
    sql = `UPDATE users SET is_tier_held = 1, tier_hold_reason = '${escapedReason}' WHERE ${whereClause};`;
    description = `Hold tier access for user [${opts.user}] (Reason: ${opts.reason})`;
  } else if (opts.action === 'resume') {
    sql = `UPDATE users SET is_tier_held = 0, tier_hold_reason = NULL WHERE ${whereClause};`;
    description = `Resume tier access for user [${opts.user}]`;
  } else {
    // Status query
    sql = `SELECT id, telegram_user_id, display_name, tier, tier_expires_at, is_tier_held, tier_hold_reason FROM users WHERE ${whereClause};`;
    description = `Check tier & hold status for user [${opts.user}]`;
  }

  console.log('\n' + '━'.repeat(64));
  console.log('  ⚡ AETHEROLL TIER MANAGEMENT');
  console.log('━'.repeat(64));
  console.log(`  Action:      ${description}`);
  console.log(`  Target:      ${opts.user}`);
  console.log('─'.repeat(64));
  console.log('📋 SQL Query:');
  console.log(sql);
  console.log('━'.repeat(64));

  if (opts.exec) {
    console.log('\n🚀 Executing remotely via Cloudflare D1...\n');
    try {
      const output = execSync(
        `pnpm --filter @aetheroll/api exec wrangler d1 execute aetheroll-db --remote --command="${sql.replace(/"/g, '\\"')}"`,
        { stdio: 'inherit' }
      );
      console.log('\n✅ Successfully executed on remote D1.');
    } catch (err) {
      console.error('\n❌ Execution failed:', err.message);
      process.exit(1);
    }
  } else {
    console.log('\n💡 Tip: Add `-e` or `--exec` to execute directly on remote D1:');
    console.log(`  node scripts/manage-tier.mjs --user "${opts.user}" ${opts.action ? `--${opts.action}` : '--status'} -e\n`);
  }
}

main();
