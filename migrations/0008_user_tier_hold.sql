-- 0008_user_tier_hold.sql
-- Add suspension / on-hold support for user tiers

ALTER TABLE users ADD COLUMN is_tier_held INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN tier_hold_reason TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_users_tier_held ON users(is_tier_held);
