-- Migration: 0002_add_gallery_channels.sql
-- Description: Create dedicated gallery_channels table for user-curated gallery libraries

CREATE TABLE IF NOT EXISTS gallery_channels (
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_id  TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    added_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, channel_id)
);

CREATE INDEX IF NOT EXISTS idx_gallery_channels_user ON gallery_channels(user_id);
CREATE INDEX IF NOT EXISTS idx_gallery_channels_channel ON gallery_channels(channel_id);
