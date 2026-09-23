import AsyncStorage from '@react-native-async-storage/async-storage';
import { BackupItem } from './types';
import { UploadResult, FloodWaitError, XhrUploader } from './xhrUploader';
import { ChunkedUploader } from './chunkedUploader';
import { DirectTelegramUploader } from './directTelegramUploader';

export type UploadEngineMode = 'auto' | 'direct' | 'cloudflare';

const STORAGE_KEY_UPLOAD_ENGINE = 'aetheroll_upload_engine_mode';
let currentEngineMode: UploadEngineMode = 'auto';

export class UploadStrategyRouter {
  /**
   * Initialize configured engine mode from persistent storage.
   */
  static async init(): Promise<UploadEngineMode> {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY_UPLOAD_ENGINE);
      if (stored === 'auto' || stored === 'direct' || stored === 'cloudflare') {
        currentEngineMode = stored;
      }
    } catch (e) {
      console.warn('[UploadStrategy] Could not load stored upload engine mode:', e);
    }
    return currentEngineMode;
  }

  static getEngineMode(): UploadEngineMode {
    return currentEngineMode;
  }

  static async setEngineMode(mode: UploadEngineMode): Promise<void> {
    currentEngineMode = mode;
    try {
      await AsyncStorage.setItem(STORAGE_KEY_UPLOAD_ENGINE, mode);
      console.log(`[UploadStrategy] ⚙️ Upload engine mode set to: "${mode}"`);
    } catch (e) {
      console.warn('[UploadStrategy] Could not save upload engine mode:', e);
    }
  }

  /**
   * Executes upload through the active strategy with automatic seamless fallback.
   */
  static async uploadItem(
    item: BackupItem,
    signal?: AbortSignal,
    onProgress?: (uploadedBytes: number, totalBytes: number, percent: number) => void
  ): Promise<UploadResult> {
    const mode = currentEngineMode;
    console.log(`[UploadStrategy] 🔀 Dispatching "${item.fileName}" using engine mode: [${mode.toUpperCase()}]`);

    if (mode === 'cloudflare') {
      return this.uploadViaCloudflare(item, signal, onProgress);
    }

    if (mode === 'direct') {
      return await DirectTelegramUploader.uploadItem(item, signal, onProgress);
    }

    // Auto Mode: Attempt Direct Telegram MTProto first, fallback to Cloudflare on connection errors
    try {
      return await DirectTelegramUploader.uploadItem(item, signal, onProgress);
    } catch (err: any) {
      if (signal?.aborted || err instanceof FloodWaitError) {
        throw err;
      }

      console.warn(
        `[UploadStrategy] ⚠️ Direct Telegram upload failed for "${item.fileName}" (${err?.message}). Seamlessly falling back to Cloudflare proxy pipeline...`
      );

      return await this.uploadViaCloudflare(item, signal, onProgress);
    }
  }

  private static async uploadViaCloudflare(
    item: BackupItem,
    signal?: AbortSignal,
    onProgress?: (uploadedBytes: number, totalBytes: number, percent: number) => void
  ): Promise<UploadResult> {
    if (item.fileSize > 15 * 1024 * 1024) {
      return await ChunkedUploader.uploadItem(item, signal, (uploaded, total, pct) => {
        onProgress?.(uploaded, total, pct);
      });
    }
    return await XhrUploader.uploadItem(item, signal, (uploaded, total, pct) => {
      onProgress?.(uploaded, total, pct);
    });
  }
}
