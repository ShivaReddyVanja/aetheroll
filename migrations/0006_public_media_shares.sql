-- 0006_public_media_shares.sql
-- Cloudflare D1 table for Zero-Knowledge, Bot-Relayed Public Media Shares

CREATE TABLE IF NOT EXISTS media_shares (
    id                   TEXT PRIMARY KEY,              -- Nanoid / URL safe identifier (e.g. "sh_k9F2mPx7QwL4vNa8")
    user_id              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    media_id             TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
    public_channel_id    TEXT NOT NULL,                 -- Central platform vault Telegram channel ID (e.g. "-1001234567890")
    public_message_id    INTEGER NOT NULL,              -- Telegram message ID in central vault
    document_id          TEXT NOT NULL,                 -- Telegram MTProto Document ID
    access_hash          TEXT NOT NULL,                 -- Telegram MTProto Access Hash
    file_reference_hex   TEXT NOT NULL,                 -- Binary file reference in hex string format
    mime_type            TEXT NOT NULL,                 -- e.g. "video/mp4", "image/jpeg"
    file_size_bytes      INTEGER NOT NULL,              -- Total file size in bytes
    duration_seconds     REAL,                          -- Duration for video/audio (NULL for images)
    title                TEXT,                          -- Optional title / caption for the public share
    is_revoked           INTEGER NOT NULL DEFAULT 0,    -- 0 = Active, 1 = Revoked
    expires_at           TIMESTAMP DEFAULT NULL,        -- NULL = Never expires, or ISO timestamp
    view_count           INTEGER NOT NULL DEFAULT 0,    -- Counter for public streams/views
    created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_media_shares_user_id ON media_shares(user_id);
CREATE INDEX IF NOT EXISTS idx_media_shares_media_id ON media_shares(media_id);
CREATE INDEX IF NOT EXISTS idx_media_shares_lookup ON media_shares(id, is_revoked, expires_at);
