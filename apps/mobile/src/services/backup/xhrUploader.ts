import { getApiBaseUrl, getSessionToken } from '../api';
import { BackupItem } from './types';
import { RatePacer } from './ratePacer';
import { NativeBackgroundService } from './nativeBackgroundService';

export class FloodWaitError extends Error {
  seconds: number;
  constructor(seconds: number) {
    super(`Telegram FLOOD_WAIT: Please wait ${seconds} seconds`);
    this.name = 'FloodWaitError';
    this.seconds = seconds;
  }
}

export interface UploadResult {
  success: boolean;
  mediaItem?: any;
  telegramMessageId?: number;
  mediaId?: string;
  error?: string;
}

export class XhrUploader {
  /**
   * Upload single media asset using XMLHttpRequest for real byte-level streaming progress.
   *
   * Implemented as a proper async function (not async-inside-new-Promise) so that any
   * throw from RatePacer.waitIfNeeded() propagates cleanly as a rejected Promise instead
   * of becoming an unhandled rejection.
   */
  static async uploadItem(
    item: BackupItem,
    signal?: AbortSignal,
    onProgress?: (uploadedBytes: number, totalBytes: number, percent: number) => void
  ): Promise<UploadResult> {
    if (signal?.aborted) {
      throw new Error('Upload cancelled');
    }

    // Await rate pacer BEFORE constructing the XHR Promise — any throw here is a clean
    // rejection from the async function, not an unhandled rejection in a Promise executor.
    await RatePacer.waitIfNeeded();

    // After the rate-pacer wait, check again in case the task was cancelled while waiting
    if (signal?.aborted) {
      throw new Error('Upload cancelled');
    }

    let videoMeta: { duration: number; width: number; height: number; thumbnailBase64: string } | null = null;
    const isVideo = item.mimeType.includes('video') || (item.fileName && item.fileName.toLowerCase().endsWith('.mp4'));
    if (isVideo) {
      try {
        videoMeta = await NativeBackgroundService.extractVideoMetadata(item.uri);
      } catch {}
    }

    return new Promise<UploadResult>((resolve, reject) => {
      const baseUrl = getApiBaseUrl();
      const token = getSessionToken();
      const url = `${baseUrl}/api/media/upload`;

      console.log(`[XhrUploader] 🚀 Starting upload for "${item.fileName}" (${(item.fileSize / 1024 / 1024).toFixed(2)} MB)`);
      console.log(`[XhrUploader] 📍 Target URL: ${url}`);
      console.log(`[XhrUploader] 🔑 Auth Token Present: ${Boolean(token)} (length: ${token?.length || 0})`);
      console.log(`[XhrUploader] 📁 File URI: ${item.uri}`);
      console.log(`[XhrUploader] 🏷️ Channel ID: ${item.channelId} | MIME: ${item.mimeType}`);

      const xhr = new XMLHttpRequest();
      let isSettled = false;

      const safeResolve = (res: UploadResult) => {
        if (!isSettled) {
          isSettled = true;
          resolve(res);
        }
      };

      const safeReject = (err: any) => {
        if (!isSettled) {
          isSettled = true;
          reject(err);
        }
      };

      const onAbort = () => {
        console.warn(`[XhrUploader] 🛑 Upload aborted for "${item.fileName}"`);
        try {
          xhr.abort();
        } catch {}
        safeReject(new Error('Upload cancelled'));
      };

      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
      }

      // Setup Real Streaming Upload Progress
      let lastLoggedPercent = -1;
      if (xhr.upload && onProgress) {
        xhr.upload.onprogress = (event: ProgressEvent) => {
          if (event.lengthComputable && event.total > 0) {
            const rawTotal = Math.max(item.fileSize || 0, event.total);
            const rawLoaded = Math.min(event.loaded, rawTotal);
            // Cap at 99% during client transmission; reaches 100% when server confirms
            const percent = Math.min(99, Math.max(1, Math.round((rawLoaded / rawTotal) * 100)));
            if (percent !== lastLoggedPercent && (percent % 10 === 0 || percent === 99 || lastLoggedPercent === -1)) {
              console.log(`[XhrUploader] ⏳ Progress for "${item.fileName}": ${percent}% (${(rawLoaded / 1024 / 1024).toFixed(2)}MB / ${(rawTotal / 1024 / 1024).toFixed(2)}MB)`);
              lastLoggedPercent = percent;
            }
            onProgress(rawLoaded, rawTotal, percent);
          } else {
            const rawTotal = item.fileSize || 1;
            const rawLoaded = Math.min(event.loaded, rawTotal);
            const percent = Math.min(99, Math.max(1, Math.round((rawLoaded / rawTotal) * 100)));
            onProgress(rawLoaded, rawTotal, percent);
          }
        };
      }

      xhr.onload = () => {
        if (signal) {
          signal.removeEventListener('abort', onAbort);
        }

        const status = xhr.status;
        const responseText = xhr.responseText || '';
        console.log(`[XhrUploader] 📥 Response received for "${item.fileName}": HTTP ${status} | Body preview: ${responseText.slice(0, 200)}`);

        if (status === 429) {
          let waitSeconds = 15;
          const match = responseText.match(/(\d+)/);
          if (match && match[1]) {
            waitSeconds = parseInt(match[1], 10);
          }
          console.warn(`[XhrUploader] ⚠️ Rate limit 429 hit for "${item.fileName}". Wait ${waitSeconds}s`);
          RatePacer.applyFloodWaitPenalty(waitSeconds);
          return safeReject(new FloodWaitError(waitSeconds));
        }

        if (status >= 200 && status < 300) {
          try {
            const data = JSON.parse(responseText);
            const mediaItem = data.media_item || data.item || data;
            const telegramMessageId = mediaItem?.telegram_message_id || data.telegramMessageId;
            const mediaId = mediaItem?.id || data.mediaId;

            console.log(`[XhrUploader] ✅ Upload completed for "${item.fileName}": mediaId=${mediaId}, tgMsgId=${telegramMessageId}`);

            // Notify 100% progress upon successful server completion
            if (onProgress) {
              onProgress(item.fileSize || 1, item.fileSize || 1, 100);
            }

            return safeResolve({
              success: true,
              mediaItem,
              telegramMessageId,
              mediaId,
            });
          } catch (e) {
            console.log(`[XhrUploader] ✅ Upload completed for "${item.fileName}" (raw parse)`);
            return safeResolve({ success: true, mediaItem: { fileName: item.fileName } });
          }
        }

        let errMsg = `Upload failed with HTTP ${status}`;
        try {
          const errJson = JSON.parse(responseText);
          if (errJson?.error) errMsg = errJson.error;
        } catch {}

        console.error(`[XhrUploader] ❌ Server returned error for "${item.fileName}": HTTP ${status} - ${errMsg}`);
        safeReject(new Error(errMsg));
      };

      xhr.onerror = (e) => {
        if (signal) {
          signal.removeEventListener('abort', onAbort);
        }
        console.error(`[XhrUploader] ❌ Network error during upload of "${item.fileName}":`, e);
        safeReject(new Error('Network error during upload'));
      };

      xhr.ontimeout = () => {
        if (signal) {
          signal.removeEventListener('abort', onAbort);
        }
        console.error(`[XhrUploader] ⏰ Request timed out for "${item.fileName}" after ${xhr.timeout}ms`);
        safeReject(new Error('Upload request timed out on server'));
      };

      // Dynamic request timeout: At least 3 minutes, up to 10 minutes for large videos
      const estimatedSec = Math.ceil((item.fileSize || 5 * 1024 * 1024) / (50 * 1024));
      xhr.timeout = Math.max(180000, Math.min(600000, estimatedSec * 1000));

      try {
        xhr.open('POST', url, true);

        if (token) {
          xhr.setRequestHeader('Authorization', `Bearer ${token}`);
          xhr.setRequestHeader('x-tg-session', token);
        }

        const formData = new FormData();
        formData.append('file', {
          uri: item.uri,
          name: item.fileName || `media_${Date.now()}.${item.mimeType.includes('video') ? 'mp4' : 'jpg'}`,
          type: item.mimeType || 'image/jpeg',
        } as any);

        formData.append('channel_id', item.channelId);
        formData.append('captured_at', new Date(item.createdAt || Date.now()).toISOString());

        const width = videoMeta?.width || item.width || 1920;
        const height = videoMeta?.height || item.height || 1080;
        const duration = videoMeta?.duration || item.duration || 0;
        const thumb = videoMeta?.thumbnailBase64 || item.thumbnailBase64 || '';

        formData.append('width', String(width));
        formData.append('height', String(height));
        formData.append('duration', String(duration));
        if (thumb) {
          formData.append('thumbnail_base64', thumb);
        }

        console.log(`[XhrUploader] 📤 Sending FormData to ${url}...`);
        xhr.send(formData);
      } catch (err: any) {
        console.error(`[XhrUploader] 💥 Exception during xhr.send for "${item.fileName}":`, err);
        safeReject(err);
      }
    });
  }
}
