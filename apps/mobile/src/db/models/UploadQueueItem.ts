import { Model } from '@nozbe/watermelondb';
import { field, date } from '@nozbe/watermelondb/decorators';

export class UploadQueueItemModel extends Model {
  static table = 'upload_queue';

  @field('local_uri') localUri!: string;
  @field('file_name') fileName!: string;
  @field('file_type') fileType!: 'photo' | 'video';
  @field('file_size') fileSize!: number;
  @field('status') status!: 'pending' | 'uploading' | 'completed' | 'failed';
  @field('attempts') attempts!: number;
  @field('error_message') errorMessage?: string;
  @date('scheduled_at') scheduledAt!: Date;
  @date('created_at') createdAt!: Date;
}
