import { BackupItem, BackupListenerPayload, BackupStats } from './types';
import { QueueStorage } from './queueStorage';
import { MediaUploader, FloodWaitError } from './uploader';

type Listener = (payload: BackupListenerPayload) => void;

class BackupManagerClass {
  private queue: BackupItem[] = [];
  private isSyncing = false;
  private isProcessing = false;
  private listeners: Set<Listener> = new Set();
  private currentItem?: BackupItem;

  constructor() {
    this.init();
  }

  private async init() {
    this.queue = await QueueStorage.loadQueue();
    // Reset any stuck 'uploading' items to 'pending'
    let hasChanges = false;
    this.queue = this.queue.map((it) => {
      if (it.status === 'uploading') {
        hasChanges = true;
        return { ...it, status: 'pending', progress: 0 };
      }
      return it;
    });
    if (hasChanges) {
      await QueueStorage.saveQueue(this.queue);
    }
    this.notify();
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.getPayload());
    return () => {
      this.listeners.delete(listener);
    };
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
      } else if (item.status === 'uploading' && item.progress > 0) {
        bytesUploaded += Math.floor((size * item.progress) / 100);
      }
    }

    return {
      total,
      completed,
      failed,
      pending,
      inProgress,
      bytesUploaded,
      totalBytes,
    };
  }

  private getPayload(): BackupListenerPayload {
    return {
      queue: [...this.queue],
      stats: this.getStats(),
      isSyncing: this.isSyncing,
      currentItem: this.currentItem,
    };
  }

  private notify() {
    const payload = this.getPayload();
    this.listeners.forEach((l) => l(payload));
  }

  public async addAssets(
    assets: Array<{
      uri: string;
      fileName?: string;
      fileSize?: number;
      type?: string;
    }>,
    channelId: string
  ): Promise<void> {
    if (!channelId) {
      throw new Error('Target channel ID is required for backup');
    }

    const newItems: BackupItem[] = assets.map((asset) => ({
      id: `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      uri: asset.uri,
      fileName: asset.fileName || `media_${Date.now()}.${asset.type?.includes('video') ? 'mp4' : 'jpg'}`,
      fileSize: asset.fileSize || 0,
      mimeType: asset.type || 'image/jpeg',
      status: 'pending',
      progress: 0,
      channelId,
      createdAt: Date.now(),
    }));

    this.queue = await QueueStorage.addItems(newItems);
    this.notify();

    // Auto-start sync if previously syncing
    if (this.isSyncing && !this.isProcessing) {
      this.processNext();
    }
  }

  public startSync(): void {
    if (this.isSyncing) return;
    this.isSyncing = true;
    this.notify();
    this.processNext();
  }

  public pauseSync(): void {
    this.isSyncing = false;
    if (this.currentItem && this.currentItem.status === 'uploading') {
      this.currentItem.status = 'paused';
    }
    this.notify();
  }

  public async retryFailed(): Promise<void> {
    this.queue = this.queue.map((item) => {
      if (item.status === 'failed') {
        return { ...item, status: 'pending', progress: 0, error: undefined };
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
    if (this.currentItem?.id === id) {
      this.currentItem = undefined;
    }
    this.queue = await QueueStorage.removeItem(id);
    this.notify();
  }

  private async processNext(): Promise<void> {
    if (!this.isSyncing || this.isProcessing) return;

    const nextItem = this.queue.find((i) => i.status === 'pending' || i.status === 'paused');
    if (!nextItem) {
      this.isProcessing = false;
      this.currentItem = undefined;
      this.notify();
      return;
    }

    this.isProcessing = true;
    this.currentItem = nextItem;
    nextItem.status = 'uploading';
    nextItem.progress = 5;
    this.notify();

    try {
      await MediaUploader.uploadItem(nextItem, (pct) => {
        if (this.currentItem?.id === nextItem.id) {
          nextItem.progress = pct;
          this.notify();
        }
      });

      nextItem.status = 'completed';
      nextItem.progress = 100;
      nextItem.completedAt = Date.now();
      nextItem.error = undefined;
      await QueueStorage.updateItem(nextItem.id, {
        status: 'completed',
        progress: 100,
        completedAt: nextItem.completedAt,
      });
    } catch (err: any) {
      console.warn(`[BackupManager] Failed to upload ${nextItem.fileName}:`, err);
      nextItem.status = 'failed';
      nextItem.error = err?.message || 'Upload failed';
      await QueueStorage.updateItem(nextItem.id, {
        status: 'failed',
        error: nextItem.error,
      });

      if (err instanceof FloodWaitError) {
        console.warn(`[BackupManager] Pausing backup due to FLOOD_WAIT (${err.seconds}s)`);
        await new Promise<void>((resolve) =>
          setTimeout(() => resolve(), Math.min(err.seconds * 1000, 30000))
        );
      }
    } finally {
      this.isProcessing = false;
      this.currentItem = undefined;
      this.notify();

      if (this.isSyncing) {
        // Schedule next upload
        setTimeout(() => this.processNext(), 500);
      }
    }
  }
}

export const BackupManager = new BackupManagerClass();
