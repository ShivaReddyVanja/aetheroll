-- 0002_media_event_messages.sql
-- Tracks Telegram WAL Event Message IDs for clean cascading batch deletion

CREATE TABLE IF NOT EXISTS media_event_messages (
    id                     TEXT PRIMARY KEY,
    channel_id             TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    media_item_id          TEXT REFERENCES media_items(id) ON DELETE CASCADE,
    media_telegram_msg_id  INTEGER NOT NULL,
    event_telegram_msg_id  INTEGER NOT NULL,
    created_at             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(channel_id, event_telegram_msg_id)
);

CREATE INDEX IF NOT EXISTS idx_event_messages_media ON media_event_messages(channel_id, media_telegram_msg_id);
CREATE INDEX IF NOT EXISTS idx_event_messages_item  ON media_event_messages(media_item_id);
