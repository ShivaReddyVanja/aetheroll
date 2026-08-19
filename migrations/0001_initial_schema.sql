-- 0001_initial_schema.sql
-- Cloudflare D1 / SQLite schema for Telegram-Backed Media Gallery

-- 1. Users table (Whitelisted gallery members)
CREATE TABLE IF NOT EXISTS users (
    id                TEXT PRIMARY KEY,              -- UUID
    telegram_user_id  INTEGER NOT NULL UNIQUE,       -- Telegram User ID
    display_name      TEXT NOT NULL,                 -- First name / last name / username
    avatar_url        TEXT,                          -- Profile picture URL / R2 key
    session_string    TEXT NOT NULL,                 -- Encrypted MTProto StringSession
    created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. Web browser session tokens (HttpOnly cookie mapping)
CREATE TABLE IF NOT EXISTS user_sessions (
    id          TEXT PRIMARY KEY,                    -- Session Token (opaque UUID / token)
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at  TIMESTAMP NOT NULL,
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_at);

-- 3. Telegram Channels (Independent Galleries)
CREATE TABLE IF NOT EXISTS channels (
    id                    TEXT PRIMARY KEY,          -- UUID
    telegram_channel_id   TEXT NOT NULL UNIQUE,      -- Telegram Peer Channel ID (e.g. "-1001234567890")
    name                  TEXT NOT NULL,             -- Channel Title
    cover_media_id        TEXT,                      -- ID of cover media (No FK to prevent circular dependency)
    last_synced_at        TIMESTAMP,                 -- Last sync timestamp
    created_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 4. User ↔ Channel Access Mapping (Many-to-Many)
CREATE TABLE IF NOT EXISTS user_channels (
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_id  TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    role        TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('owner', 'member')),
    joined_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, channel_id)
);
CREATE INDEX IF NOT EXISTS idx_user_channels_user    ON user_channels(user_id);
CREATE INDEX IF NOT EXISTS idx_user_channels_channel ON user_channels(channel_id);

-- 5. Media Items (Photos and Videos belonging to a Channel)
CREATE TABLE IF NOT EXISTS media_items (
    id                   TEXT PRIMARY KEY,           -- UUID
    channel_id           TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    uploader_user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
    telegram_message_id  INTEGER NOT NULL,          -- Message ID inside the Telegram Channel
    file_type            TEXT NOT NULL CHECK(file_type IN ('photo', 'video')),
    mime_type            TEXT NOT NULL,             -- e.g. 'image/jpeg', 'video/mp4'
    file_size_bytes      INTEGER NOT NULL,
    width                INTEGER NOT NULL,          -- Width in px (required for masonry grid aspect-ratio)
    height               INTEGER NOT NULL,          -- Height in px
    duration_seconds     REAL,                      -- Duration in seconds (NULL for photos)
    blur_hash            TEXT NOT NULL,             -- BlurHash string for instant placeholder
    thumbnail_r2_key     TEXT DEFAULT NULL,         -- Low-res thumbnail key in R2
    full_r2_key          TEXT DEFAULT NULL,         -- Full-res cached key in R2
    last_accessed_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    captured_at          TIMESTAMP,                 -- Date from EXIF original metadata
    created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at           TIMESTAMP DEFAULT NULL,    -- Soft delete flag if deleted on Telegram
    UNIQUE(channel_id, telegram_message_id)
);
CREATE INDEX IF NOT EXISTS idx_media_channel         ON media_items(channel_id);
CREATE INDEX IF NOT EXISTS idx_media_captured_at     ON media_items(channel_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_created_at      ON media_items(channel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_last_accessed   ON media_items(last_accessed_at ASC);

-- 6. People Table (Scoped to a Channel)
CREATE TABLE IF NOT EXISTS people (
    id              TEXT PRIMARY KEY,                -- UUID
    channel_id      TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    cover_media_id  TEXT,                            -- No FK constraint
    linked_user_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_by      TEXT NOT NULL REFERENCES users(id),
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_people_channel ON people(channel_id);

-- 7. Media Person Tags (Bounding boxes + tagging)
CREATE TABLE IF NOT EXISTS media_person_tags (
    id             TEXT PRIMARY KEY,                 -- UUID
    media_item_id  TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
    person_id      TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    bbox_x         REAL,                             -- 0.0-1.0 relative bounding box X
    bbox_y         REAL,                             -- 0.0-1.0 relative bounding box Y
    bbox_w         REAL,                             -- 0.0-1.0 relative bounding box W
    bbox_h         REAL,                             -- 0.0-1.0 relative bounding box H
    tagged_by      TEXT NOT NULL REFERENCES users(id),
    tagged_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(media_item_id, person_id)
);
CREATE INDEX IF NOT EXISTS idx_person_tags_media  ON media_person_tags(media_item_id);
CREATE INDEX IF NOT EXISTS idx_person_tags_person ON media_person_tags(person_id);

-- 8. Locations Table (Named Places & GPS Coordinates)
CREATE TABLE IF NOT EXISTS locations (
    id          TEXT PRIMARY KEY,                    -- UUID
    name        TEXT NOT NULL,                       -- Place name (e.g. 'Goa', 'Baga Beach')
    latitude    REAL,
    longitude   REAL,
    place_type  TEXT,                                -- 'city', 'landmark', 'country', 'custom'
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 9. Media Location Tags
CREATE TABLE IF NOT EXISTS media_location_tags (
    id             TEXT PRIMARY KEY,                 -- UUID
    media_item_id  TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
    location_id    TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    source         TEXT NOT NULL CHECK(source IN ('exif', 'manual')),
    tagged_by      TEXT NOT NULL REFERENCES users(id),
    tagged_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(media_item_id, location_id)
);
CREATE INDEX IF NOT EXISTS idx_location_tags_media    ON media_location_tags(media_item_id);
CREATE INDEX IF NOT EXISTS idx_location_tags_location ON media_location_tags(location_id);

-- 10. Events Table (User-created named events)
CREATE TABLE IF NOT EXISTS events (
    id              TEXT PRIMARY KEY,                -- UUID
    channel_id      TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    description     TEXT,
    cover_media_id  TEXT,                            -- No FK constraint
    created_by      TEXT NOT NULL REFERENCES users(id),
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_events_channel ON events(channel_id);

-- 11. Media Event Tags
CREATE TABLE IF NOT EXISTS media_event_tags (
    id             TEXT PRIMARY KEY,                 -- UUID
    media_item_id  TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
    event_id       TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    tagged_by      TEXT NOT NULL REFERENCES users(id),
    tagged_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(media_item_id, event_id)
);
CREATE INDEX IF NOT EXISTS idx_event_tags_media ON media_event_tags(media_item_id);
CREATE INDEX IF NOT EXISTS idx_event_tags_event ON media_event_tags(event_id);

-- 12. Media Favorites (Per-user favorites)
CREATE TABLE IF NOT EXISTS media_favorites (
    user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    media_item_id  TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
    favorited_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, media_item_id)
);
CREATE INDEX IF NOT EXISTS idx_favorites_user ON media_favorites(user_id);
