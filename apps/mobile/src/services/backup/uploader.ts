import { BackupItem } from './types';
import { XhrUploader, FloodWaitError } from './xhrUploader';

export { FloodWaitError };

export class MediaUploader {
  /**
   * Upload single media asset using XhrUploader
   */
  static async uploadItem(
    item: BackupItem,
    onProgress?: (percent: number) => void
  ): Promise<{ mediaItem: any }> {
    const res = await XhrUploader.uploadItem(item, undefined, (_loaded, _total, pct) => {
      if (onProgress) onProgress(pct);
    });
    return { mediaItem: res.mediaItem };
  }
}

