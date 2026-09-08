import { Model } from '@nozbe/watermelondb';
import { field, date, readonly } from '@nozbe/watermelondb/decorators';

export class MediaItemModel extends Model {
  static table = 'media_items';

  @field('telegram_message_id') telegramMessageId!: number;
  @field('channel_id') channelId!: string;
  @field('file_type') fileType!: 'photo' | 'video';
  @field('mime_type') mimeType?: string;
  @field('file_size_bytes') fileSizeBytes!: number;
  @field('width') width!: number;
  @field('height') height!: number;
  @field('duration_seconds') durationSeconds?: number;
  @field('blur_hash') blurHash?: string;
  @field('local_thumb_path') localThumbPath?: string;
  @date('captured_at') capturedAt!: Date;
  @field('is_favorite') isFavorite!: boolean;
  @field('uploader_name') uploaderName?: string;
  @date('synced_at') syncedAt!: Date;
}
