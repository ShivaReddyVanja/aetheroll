import { AppState, AppStateStatus } from 'react-native';
import { BackupItem, BackupListenerPayload, BackupStats } from './types';
import { QueueStorage } from './queueStorage';
import { XhrUploader, FloodWaitError } from './xhrUploader';
import { DynamicUploadDispatcher } from './uploadDispatcher';
import { formatUploadSpeed, formatUploadDuration } from './speedAggregator';
import { RatePacer } from './ratePacer';
import { NativeBackgroundService } from './nativeBackgroundService';

type Listener = (payload: BackupListenerPayload) => void;

class BackupManagerClass {
  private queue: BackupItem[] = [];
  private isSyncing = false;
  private listeners: Set<Listener> = new Set();
  private dispatcher: DynamicUploadDispatcher;
  private currentSpeedFormatted = '0 KB/s';
  private currentSpeedBytes = 0;
  private appStateSubscription: any = null;
  private floodWaitTimer: any = null;

  constructor() {
    this.dispatcher = new DynamicUploadDispatcher(
      () => this.queue,
      {
        executor: async (item, signal, onProgress) => {
          return await XhrUploader.uploadItem(item, signal, (uploaded, total) => {
            onProgress(uploaded, total);
          });
        },
        onTaskStart: (item) => {
          this.handleTaskStart(item);
        },
        onTaskProgress: (item, uploadedBytes, percent) => {
          this.handleTaskProgress(item, uploadedBytes, percent);
        },
        onTaskComplete: (item, result, durationMs) => {
          this.handleTaskComplete(item, result, durationMs);
        },
        onTaskError: (item, error) => {
          this.handleTaskError(item, error);
        },
        onSpeedUpdate: (speedFormatted, speedBytesPerSec, activeCount) => {
          this.currentSpeedFormatted = speedFormatted;
          this.currentSpeedBytes = speedBytesPerSec;
          this.notify();
        },
        onQueueDrained: () => {
          this.isSyncing = false;
          NativeBackgroundService.stop();
          this.notify();
        },
      }
    );

    this.init();
  }

  private async init() {
    // Reconcile native service state before loading queue — prevents ghost service
    // scenario where the JS flag was reset (hot reload / OOM) while Android kept running.
    await NativeBackgroundService.syncState();

    this.queue = await QueueStorage.loadQueue();
    this.notify();

    // Listen for AppState changes to handle background/foreground
    this.appStateSubscription = AppState.addEventListener('change', this.handleAppStateChange);
  }

  private handleAppStateChange = (nextState: AppStateStatus) => {
    if (nextState === 'active') {
      // Returned to foreground: ensure queue is up to date and scheduler running if syncing
      if (this.isSyncing) {
        this.dispatcher.schedule();
      }
    }
  };

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.getPayload());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private handleTaskStart(item: BackupItem) {
    const existing = this.queue.find((i) => i.id === item.id);
    if (existing) {
      existing.status = 'uploading';
      existing.progress = existing.progress > 0 ? existing.progress : 2;
      existing.lastAttemptAt = Date.now();
      existing.attempts = (existing.attempts || 0) + 1;
      this.notify();
    }
  }

  private handleTaskProgress(item: BackupItem, uploadedBytes: number, percent: number) {
    const existing = this.queue.find((i) => i.id === item.id);
    if (existing) {
      existing.progress = percent;
      existing.uploadedBytes = uploadedBytes;
      this.notify();
    }
  }

  private async handleTaskComplete(item: BackupItem, result: any, durationMs: number) {
    const existing = this.queue.find((i) => i.id === item.id);
    if (existing) {
      existing.status = 'completed';
      existing.progress = 100;
      existing.uploadedBytes = existing.fileSize;
      existing.completedAt = Date.now();
      existing.error = undefined;
      existing.telegramMessageId = result?.telegramMessageId || result?.mediaItem?.telegram_message_id;
      existing.mediaId = result?.mediaId || result?.mediaItem?.id;

      await QueueStorage.updateItem(existing.id, {
        status: 'completed',
        progress: 100,
        uploadedBytes: existing.fileSize,
        completedAt: existing.completedAt,
        telegramMessageId: existing.telegramMessageId,
        mediaId: existing.mediaId,
        error: undefined,
      });

      this.notify();
    }
  }

  private async handleTaskError(item: BackupItem, error: any) {
    console.warn(`[BackupManager] Task failed for ${item.fileName}:`, error);
    const existing = this.queue.find((i) => i.id === item.id);
    if (existing) {
      existing.status = 'failed';
      existing.error = error?.message || 'Upload failed';

      await QueueStorage.updateItem(existing.id, {
        status: 'failed',
        error: existing.error,
        attempts: existing.attempts,
      });

      if (error instanceof FloodWaitError) {
        console.warn(`[BackupManager] Pausing uploads due to FLOOD_WAIT (${error.seconds}s)`);
        this.pauseSync();

        if (this.floodWaitTimer) clearTimeout(this.floodWaitTimer);
        this.floodWaitTimer = setTimeout(() => {
          console.log('[BackupManager] Resuming backup after FLOOD_WAIT cooldown');
          this.startSync();
        }, (error.seconds + 2) * 1000);
      }

      this.notify();
    }
  }

  private getStats(): BackupStats {
    const total = this.queue.length;
    const completed = this.queue.filter((i) => i.status === 'completed').length;
    const failed = this.queue.filter((i) => i.status === 'failed').length;
    const inProgress = this.queue.filter((i) => i.status === 'uploading').length;
    const pending = this.queue.filter((i) => i.status === 'pending' || i.status === 'paused').length;

    let bytesUploaded = 0;
    let totalBytes = 0;

    for (const item of this.queue) {
      const size = item.fileSize || 0;
      totalBytes += size;
      if (item.status === 'completed') {
        bytesUploaded += size;
      } else if (item.status === 'uploading') {
        bytesUploaded += item.uploadedBytes || Math.floor((size * item.progress) / 100);
      }
    }

    const remainingBytes = Math.max(0, totalBytes - bytesUploaded);
    let etaFormatted = '--';
    if (this.currentSpeedBytes > 0 && remainingBytes > 0) {
      const etaMs = (remainingBytes / this.currentSpeedBytes) * 1000;
      etaFormatted = formatUploadDuration(etaMs);
    } else if (pending === 0 && inProgress === 0) {
      etaFormatted = 'Done';
    }

    return {
      total,
      completed,
      failed,
      pending,
      inProgress,
      bytesUploaded,
      totalBytes,
      speedFormatted: this.currentSpeedFormatted,
      speedBytesPerSec: this.currentSpeedBytes,
      etaFormatted,
      activeWorkers: this.dispatcher.getActiveCount(),
    };
  }

  private getPayload(): BackupListenerPayload {
    const activeItems = this.queue.filter((i) => i.status === 'uploading');
    return {
      queue: [...this.queue],
      stats: this.getStats(),
      isSyncing: this.isSyncing,
      activeItems,
      currentItem: activeItems[0],
    };
  }

  private notify() {
    const payload = this.getPayload();
    this.listeners.forEach((l) => l(payload));

    // Update persistent notification if syncing
    if (this.isSyncing && payload.stats.total > 0) {
      const { completed, total, speedFormatted, etaFormatted, activeWorkers } = payload.stats;
      const title = `Aetheroll Vault (${completed}/${total})`;
      const message = activeWorkers > 0
        ? `⚡ ${speedFormatted} • ETA: ${etaFormatted} • ${activeWorkers} active`
        : 'Preparing next uploads...';

      NativeBackgroundService.updateProgress(title, message, completed, total);
    }
  }

  public async addAssets(
    assets: Array<{
      uri: string;
      fileName?: string;
      fileSize?: number;
      type?: string;
    }>,
    channelId: string
  ): Promise<number> {
    if (!channelId) {
      throw new Error('Target channel ID is required for backup');
    }

    const newItems: BackupItem[] = [];
    let skippedCount = 0;

    for (const asset of assets) {
      const alreadyCompleted = await QueueStorage.isUriCompleted(asset.uri);
      if (alreadyCompleted) {
        skippedCount++;
        continue;
      }

      newItems.push({
        id: `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        uri: asset.uri,
        fileName: asset.fileName || `media_${Date.now()}.${asset.type?.includes('video') ? 'mp4' : 'jpg'}`,
        fileSize: asset.fileSize || 0,
        mimeType: asset.type || 'image/jpeg',
        status: 'pending',
        progress: 0,
        uploadedBytes: 0,
        channelId,
        createdAt: Date.now(),
        attempts: 0,
      });
    }

    if (newItems.length > 0) {
      this.queue = await QueueStorage.addItems(newItems);
      this.notify();

      if (this.isSyncing) {
        this.dispatcher.schedule();
      }
    }

    return skippedCount;
  }

  public startSync(): void {
    if (RatePacer.isThrottled()) {
      const remainingSec = RatePacer.getRemainingFloodWaitSeconds();
      console.warn(`[BackupManager] Cannot start sync yet, waiting on FloodWait (${remainingSec}s remaining)`);
      return;
    }

    this.isSyncing = true;
    NativeBackgroundService.start('Aetheroll Cloud Vault', 'Starting background backup...');
    this.notify();
    this.dispatcher.start();
  }

  public pauseSync(): void {
    this.isSyncing = false;
    this.dispatcher.pause();
    NativeBackgroundService.stop();

    this.queue = this.queue.map((it) => {
      if (it.status === 'uploading') {
        return { ...it, status: 'paused' };
      }
      return it;
    });
    QueueStorage.saveQueue(this.queue);
    this.notify();
  }

  public async retryFailed(): Promise<void> {
    this.queue = this.queue.map((item) => {
      if (item.status === 'failed') {
        return { ...item, status: 'pending', progress: 0, uploadedBytes: 0, error: undefined };
      }
      return item;
    });
    await QueueStorage.saveQueue(this.queue);
    this.notify();
    this.startSync();
  }

  public async clearCompleted(): Promise<void> {
    this.queue = await QueueStorage.clearCompleted();
    this.notify();
  }

  public async removeItem(id: string): Promise<void> {
    this.dispatcher.abortTask(id);
    this.queue = await QueueStorage.removeItem(id);
    this.notify();
  }
}

export const BackupManager = new BackupManagerClass();
