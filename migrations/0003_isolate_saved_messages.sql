-- Migration: 0003_isolate_saved_messages.sql
-- Description: Clean up legacy shared 'me' channel row to guarantee strict per-user Saved Messages isolation

-- Remove legacy shared 'me' gallery channels
DELETE FROM gallery_channels WHERE channel_id IN (SELECT id FROM channels WHERE telegram_channel_id = 'me');

-- Clean up media items tied to the legacy shared 'me' channel
DELETE FROM media_items WHERE channel_id IN (SELECT id FROM channels WHERE telegram_channel_id = 'me');

-- Remove legacy shared 'me' channel
DELETE FROM channels WHERE telegram_channel_id = 'me';
