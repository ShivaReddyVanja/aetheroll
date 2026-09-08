import { appSchema, tableSchema } from '@nozbe/watermelondb';

export const schema = appSchema({
  version: 1,
  tables: [
    tableSchema({
      name: 'media_items',
      columns: [
        { name: 'telegram_message_id', type: 'number' },
        { name: 'channel_id', type: 'string' },
        { name: 'file_type', type: 'string' },
        { name: 'mime_type', type: 'string', isOptional: true },
        { name: 'file_size_bytes', type: 'number' },
        { name: 'width', type: 'number' },
        { name: 'height', type: 'number' },
        { name: 'duration_seconds', type: 'number', isOptional: true },
        { name: 'blur_hash', type: 'string', isOptional: true },
        { name: 'local_thumb_path', type: 'string', isOptional: true },
        { name: 'captured_at', type: 'number' },
        { name: 'is_favorite', type: 'boolean' },
        { name: 'uploader_name', type: 'string', isOptional: true },
        { name: 'synced_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'upload_queue',
      columns: [
        { name: 'local_uri', type: 'string' },
        { name: 'file_name', type: 'string' },
        { name: 'file_type', type: 'string' },
        { name: 'file_size', type: 'number' },
        { name: 'status', type: 'string' }, // 'pending' | 'uploading' | 'completed' | 'failed'
        { name: 'attempts', type: 'number' },
        { name: 'error_message', type: 'string', isOptional: true },
        { name: 'scheduled_at', type: 'number' },
        { name: 'created_at', type: 'number' },
      ],
    }),
  ],
});
