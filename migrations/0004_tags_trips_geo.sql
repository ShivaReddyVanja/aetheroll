-- Migration: 0004_tags_trips_geo.sql
-- Description: Add tags, trips, geo columns on media_items, and update people/events scoping

-- 1. Extend media_items with inline geo columns
ALTER TABLE media_items ADD COLUMN latitude REAL DEFAULT NULL;
ALTER TABLE media_items ADD COLUMN longitude REAL DEFAULT NULL;
ALTER TABLE media_items ADD COLUMN altitude REAL DEFAULT NULL;

-- 2. Drop redundant legacy location tables (replaced by inline geo)
DROP TABLE IF EXISTS media_location_tags;
DROP TABLE IF EXISTS locations;

-- 3. Extend people with user_id scoping
ALTER TABLE people ADD COLUMN user_id TEXT REFERENCES users(id);

-- 4. Extend events with user_id and event_date
ALTER TABLE events ADD COLUMN user_id TEXT REFERENCES users(id);
ALTER TABLE events ADD COLUMN event_date TEXT DEFAULT NULL; -- ISO 'YYYY-MM-DD'

-- 5. User-defined tags table
CREATE TABLE IF NOT EXISTS tags (
    id          TEXT PRIMARY KEY,
    channel_id  TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL REFERENCES users(id),
    name        TEXT NOT NULL,
    color       TEXT DEFAULT NULL,   -- e.g. '#3B82F6'
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(channel_id, name)
);
CREATE INDEX IF NOT EXISTS idx_tags_channel ON tags(channel_id);

-- 6. Media ↔ Tags pivot table
CREATE TABLE IF NOT EXISTS media_tags (
    media_item_id  TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
    tag_id         TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    tagged_by      TEXT NOT NULL REFERENCES users(id),
    tagged_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (media_item_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_media_tags_media ON media_tags(media_item_id);
CREATE INDEX IF NOT EXISTS idx_media_tags_tag   ON media_tags(tag_id);

-- 7. Trips table
CREATE TABLE IF NOT EXISTS trips (
    id              TEXT PRIMARY KEY,
    channel_id      TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id         TEXT NOT NULL REFERENCES users(id),
    name            TEXT NOT NULL,
    description     TEXT DEFAULT NULL,
    start_date      TEXT DEFAULT NULL,  -- ISO 'YYYY-MM-DD'
    end_date        TEXT DEFAULT NULL,  -- ISO 'YYYY-MM-DD'
    cover_media_id  TEXT DEFAULT NULL,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_trips_channel ON trips(channel_id);

-- 8. Media ↔ Trips pivot table
CREATE TABLE IF NOT EXISTS trip_media (
    media_item_id  TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
    trip_id        TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    added_by       TEXT NOT NULL REFERENCES users(id),
    added_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (media_item_id, trip_id)
);
CREATE INDEX IF NOT EXISTS idx_trip_media_media ON trip_media(media_item_id);
CREATE INDEX IF NOT EXISTS idx_trip_media_trip  ON trip_media(trip_id);

-- 9. Performance index for geo filtering
CREATE INDEX IF NOT EXISTS idx_media_geo ON media_items(latitude, longitude)
    WHERE latitude IS NOT NULL;
