-- 0009_signup_campaigns.sql
-- Dynamic Onboarding & Signup Campaigns Table

CREATE TABLE IF NOT EXISTS signup_campaigns (
    id              TEXT PRIMARY KEY,                     -- e.g. 'welcome_first_100', 'camp_next_50'
    name            TEXT NOT NULL,                        -- e.g. 'Early Adopter Welcome - First 100 Users'
    target_tier     TEXT NOT NULL DEFAULT 'premium',      -- 'premium' or 'free'
    duration_days   INTEGER DEFAULT 30,                   -- e.g. 30, 14, 7, or NULL for lifetime
    max_claims      INTEGER NOT NULL,                     -- Max allowed successful claims (e.g. 100)
    claimed_count   INTEGER NOT NULL DEFAULT 0,           -- Count of successfully granted rewards
    is_active       INTEGER NOT NULL DEFAULT 1,           -- 1 = Active, 0 = Paused/Disabled
    priority        INTEGER NOT NULL DEFAULT 0,           -- Higher priority evaluated first
    starts_at       TIMESTAMP DEFAULT NULL,               -- Start date limit (optional)
    ends_at         TIMESTAMP DEFAULT NULL,               -- Expiration date limit (optional)
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_signup_campaigns_active ON signup_campaigns(is_active, priority DESC);

-- Seed initial Welcome Campaign for First 100 Users (30-day Premium)
INSERT OR IGNORE INTO signup_campaigns (
    id,
    name,
    target_tier,
    duration_days,
    max_claims,
    claimed_count,
    is_active,
    priority
) VALUES (
    'welcome_first_100',
    'Early Adopter Welcome - First 100 Users',
    'premium',
    30,
    100,
    0,
    1,
    100
);
