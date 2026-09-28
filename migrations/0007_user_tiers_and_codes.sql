-- 0007_user_tiers_and_codes.sql
-- User Tiers (Free vs Premium) and Activation / Promo Code Tables

-- 1. Extend users table with tier status and expiration
ALTER TABLE users ADD COLUMN tier TEXT DEFAULT 'free';
ALTER TABLE users ADD COLUMN tier_expires_at TIMESTAMP DEFAULT NULL;
ALTER TABLE users ADD COLUMN tier_granted_by TEXT DEFAULT NULL;

-- 2. Activation / Promo Codes Table
CREATE TABLE IF NOT EXISTS activation_codes (
    code            TEXT PRIMARY KEY,                     -- e.g. 'PRO-2026-ALPHA', 'VIP-SHIVA-99'
    tier            TEXT NOT NULL DEFAULT 'premium',      -- 'premium' or 'admin'
    duration_days   INTEGER DEFAULT NULL,                 -- NULL = Lifetime, 30 = 30 days, 365 = 1 year
    max_uses        INTEGER NOT NULL DEFAULT 1,           -- Max redemption count (1 = single use)
    times_used      INTEGER NOT NULL DEFAULT 0,
    is_active       INTEGER NOT NULL DEFAULT 1,           -- 1 = Active, 0 = Disabled
    note            TEXT DEFAULT NULL,                    -- Admin note (e.g. 'Beta Tester Invite')
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at      TIMESTAMP DEFAULT NULL                -- Code validity expiration
);

-- 3. Code Redemptions Audit Log
CREATE TABLE IF NOT EXISTS code_redemptions (
    id              TEXT PRIMARY KEY,                     -- UUID / Nanoid
    code            TEXT NOT NULL REFERENCES activation_codes(code) ON DELETE CASCADE,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    redeemed_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(code, user_id)
);

CREATE INDEX IF NOT EXISTS idx_users_tier ON users(tier);
CREATE INDEX IF NOT EXISTS idx_activation_codes_active ON activation_codes(is_active);
CREATE INDEX IF NOT EXISTS idx_code_redemptions_user ON code_redemptions(user_id);
