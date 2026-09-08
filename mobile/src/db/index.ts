import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';
import { schema } from './schema';
import { MediaItemModel } from './models/MediaItem';
import { UploadQueueItemModel } from './models/UploadQueueItem';

const adapter = new LokiJSAdapter({
  schema,
  useWebWorker: false,
  useIncrementalIndexedDB: true,
  onQuotaExceededError: (error) => {
    console.error('WatermelonDB quota exceeded:', error);
  },
});

export const database = new Database({
  adapter,
  modelClasses: [MediaItemModel, UploadQueueItemModel],
});
