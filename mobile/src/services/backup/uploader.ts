import { apiFetch } from '../api';
import { BackupItem } from './types';
import { RatePacer } from './ratePacer';

export class FloodWaitError extends Error {
  seconds: number;
  constructor(seconds: number) {
    super(`Telegram FLOOD_WAIT: Please wait ${seconds} seconds`);
    this.name = 'FloodWaitError';
    this.seconds = seconds;
  }
}

export class MediaUploader {
  /**
   * Upload single media asset to backend /api/media/upload
   */
  static async uploadItem(
    item: BackupItem,
    onProgress?: (percent: number) => void
  ): Promise<{ mediaItem: any }> {
    // Wait for rate pacer before initiating upload
    await RatePacer.waitIfNeeded();

    if (onProgress) onProgress(15);

    const formData = new FormData();
    formData.append('file', {
      uri: item.uri,
      name: item.fileName || `media_${Date.now()}.${item.mimeType.includes('video') ? 'mp4' : 'jpg'}`,
      type: item.mimeType || 'image/jpeg',
    } as any);

    formData.append('channel_id', item.channelId);
    formData.append('captured_at', new Date(item.createdAt || Date.now()).toISOString());

    if (onProgress) onProgress(45);

    const res = await apiFetch('/api/media/upload', {
      method: 'POST',
      body: formData,
    });

    if (onProgress) onProgress(85);

    if (res.status === 429) {
      const errorText = await res.text().catch(() => '');
      let waitSeconds = 15;
      const match = errorText.match(/(\d+)/);
      if (match && match[1]) {
        waitSeconds = parseInt(match[1], 10);
      }
      RatePacer.applyFloodWaitPenalty(waitSeconds);
      throw new FloodWaitError(waitSeconds);
    }

    if (!res.ok) {
      const errJson = await res.json().catch(() => null);
      const msg = errJson?.error || `Upload failed with HTTP ${res.status}`;
      throw new Error(msg);
    }

    const data = await res.json();
    if (onProgress) onProgress(100);

    return { mediaItem: data.media_item || data };
  }
}
