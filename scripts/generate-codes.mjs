#!/usr/bin/env node

/**
 * ⚡ Aetheroll Activation Code Generator CLI
 * Generates cryptographically secure promo/activation codes for Pro tier access.
 *
 * Usage:
 *   node scripts/generate-codes.mjs [options]
 *
 * Options:
 *   --count, -n     Number of codes to generate (default: 5)
 *   --days, -d      Validity duration in days after redemption (default: 30, use 0 for lifetime)
 *   --uses, -u      Max times code can be redeemed (default: 1)
 *   --tier, -t      Tier granted: "premium" (default) or "admin"
 *   --prefix, -p    Code prefix (default: "PRO")
 *   --note          Administrative note/tag (default: "Batch generated")
 *   --format, -f    Output format: "table" (default), "sql", or "json"
 *
 * Examples:
 *   node scripts/generate-codes.mjs -n 10 -d 30
 *   node scripts/generate-codes.mjs -n 1 -d 365 --prefix VIP --note "VIP Influencer Pass"
 *   node scripts/generate-codes.mjs -n 5 -f sql
 */

import crypto from 'crypto';

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    count: 5,
    days: 30,
    uses: 1,
    tier: 'premium',
    prefix: 'PRO',
    note: 'Batch generated',
    format: 'table',
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--count' || arg === '-n') {
      options.count = parseInt(args[++i], 10) || 5;
    } else if (arg === '--days' || arg === '-d') {
      options.days = parseInt(args[++i], 10);
    } else if (arg === '--uses' || arg === '-u') {
      options.uses = parseInt(args[++i], 10) || 1;
    } else if (arg === '--tier' || arg === '-t') {
      options.tier = args[++i] || 'premium';
    } else if (arg === '--prefix' || arg === '-p') {
      options.prefix = (args[++i] || 'PRO').toUpperCase();
    } else if (arg === '--note') {
      options.note = args[++i] || '';
    } else if (arg === '--format' || arg === '-f') {
      options.format = args[++i] || 'table';
    }
  }

  return options;
}

function generateReadableCode(prefix) {
  // Base32 charset omitting ambiguous characters: 0/O, 1/I/L
  const charset = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  const randomBytes = crypto.randomBytes(8);
  let chunk1 = '';
  let chunk2 = '';

  for (let i = 0; i < 4; i++) {
    chunk1 += charset[randomBytes[i] % charset.length];
    chunk2 += charset[randomBytes[i + 4] % charset.length];
  }

  return `${prefix}-${chunk1}-${chunk2}`;
}

function main() {
  const opts = parseArgs();
  const codes = [];

  for (let i = 0; i < opts.count; i++) {
    const code = generateReadableCode(opts.prefix);
    const durationDays = opts.days > 0 ? opts.days : null;
    codes.push({
      code,
      tier: opts.tier,
      duration_days: durationDays,
      max_uses: opts.uses,
      note: opts.note,
      created_at: new Date().toISOString(),
    });
  }

  if (opts.format === 'json') {
    console.log(JSON.stringify(codes, null, 2));
    return;
  }

  const sqlStatements = codes
    .map(
      (c) =>
        `INSERT INTO activation_codes (code, tier, duration_days, max_uses, times_used, is_active, note) VALUES ('${c.code}', '${c.tier}', ${c.duration_days === null ? 'NULL' : c.duration_days}, ${c.max_uses}, 0, 1, '${c.note.replace(/'/g, "''")}');`
    )
    .join('\n');

  if (opts.format === 'sql') {
    console.log(sqlStatements);
    return;
  }

  // Default "table" output
  console.log('\n' + '━'.repeat(64));
  console.log('  ⚡ AETHEROLL ACTIVATION CODES GENERATED');
  console.log('━'.repeat(64));
  console.log(`  Tier:          ${opts.tier.toUpperCase()}`);
  console.log(`  Duration:      ${opts.days > 0 ? `${opts.days} Days` : 'Lifetime (Permanent)'}`);
  console.log(`  Max Redemptions:${opts.uses} per code`);
  console.log(`  Note:          ${opts.note}`);
  console.log('─'.repeat(64));
  console.log('  #   Code               Duration    Uses');
  console.log('─'.repeat(64));

  codes.forEach((c, idx) => {
    const num = String(idx + 1).padStart(2, ' ');
    const dur = c.duration_days ? `${c.duration_days}d` : 'Lifetime';
    console.log(`  ${num}. ${c.code.padEnd(18, ' ')} ${dur.padEnd(11, ' ')} ${c.max_uses}`);
  });

  console.log('━'.repeat(64));
  console.log('\n📋 D1 Migration SQL (Run with `wrangler d1 execute DB --remote`):\n');
  console.log(sqlStatements);
  console.log('\n');
}

main();
