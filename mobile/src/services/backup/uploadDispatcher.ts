import { BackupItem } from './types';
import { RollingSpeedAggregator, formatUploadSpeed } from './speedAggregator';

export const MAX_CONCURRENT_MICRO = 4;
export const MAX_CONCURRENT_SMALL = 3;
export const MAX_CONCURRENT_MEDIUM = 2;
export const MAX_CONCURRENT_LARGE = 1;

export const MICRO_THRESHOLD = 500 * 1024; // 500 KB
export const SMALL_THRESHOLD = 3 * 1024 * 1024; // 3 MB
export const LARGE_THRESHOLD = 15 * 1024 * 1024; // 15 MB

export function getMobileAdaptiveConcurrency(fileSize: number): number {
  if (fileSize > LARGE_THRESHOLD) return MAX_CONCURRENT_LARGE;
  if (fileSize > SMALL_THRESHOLD) return MAX_CONCURRENT_MEDIUM;
  if (fileSize > MICRO_THRESHOLD) return MAX_CONCURRENT_SMALL;
  return MAX_CONCURRENT_MICRO;
}

export interface DispatcherCallbacks {
  executor: (
    item: BackupItem,
    signal: AbortSignal,
    onProgress: (uploadedBytes: number, totalBytes: number) => void
  ) => Promise<any>;
  onTaskStart?: (item: BackupItem) => void | Promise<void>;
  onTaskProgress?: (item: BackupItem, uploadedBytes: number, percent: number) => void;
  onTaskComplete?: (item: BackupItem, result: any, durationMs: number) => void | Promise<void>;
  onTaskError?: (item: BackupItem, error: Error) => void | Promise<void>;
  onSpeedUpdate?: (speedFormatted: string, speedBytesPerSec: number, activeCount: number) => void;
  onQueueDrained?: () => void;
}

export class DynamicUploadDispatcher {
  private itemsProvider: () => BackupItem[];
  private callbacks: DispatcherCallbacks;
  private activeControllers = new Map<string, AbortController>();
  private activeWorkers = new Set<string>();
  private speedAggregator = new RollingSpeedAggregator(2000);
  private speedTimer: any = null;
  private isRunning = false;
  private isPaused = false;

  constructor(itemsProvider: () => BackupItem[], callbacks: DispatcherCallbacks) {
    this.itemsProvider = itemsProvider;
    this.callbacks = callbacks;
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.isPaused = false;

    if (!this.speedTimer) {
      this.speedTimer = setInterval(() => {
        if (this.activeWorkers.size === 0) {
          this.callbacks.onSpeedUpdate?.('0 KB/s', 0, 0);
        } else {
          const speed = this.speedAggregator.getCurrentSpeedBytesPerSec();
          this.callbacks.onSpeedUpdate?.(formatUploadSpeed(speed), speed, this.activeWorkers.size);
        }
      }, 300);
    }

    this.schedule();
  }

  public pause(): void {
    this.isPaused = true;
    this.isRunning = false;

    // Abort active in-flight controllers safely
    for (const [, controller] of this.activeControllers.entries()) {
      controller.abort();
    }
    this.activeControllers.clear();
    this.activeWorkers.clear();
    this.speedAggregator.reset();

    if (this.speedTimer) {
      clearInterval(this.speedTimer);
      this.speedTimer = null;
    }
    this.callbacks.onSpeedUpdate?.('0 KB/s', 0, 0);
  }

  public abortTask(id: string): void {
    const controller = this.activeControllers.get(id);
    if (controller) {
      controller.abort();
      this.activeControllers.delete(id);
      this.activeWorkers.delete(id);
      this.speedAggregator.removeWorker(id);
    }
    this.schedule();
  }

  public getActiveCount(): number {
    return this.activeWorkers.size;
  }

  public schedule(): void {
    if (!this.isRunning || this.isPaused) return;

    const allItems = this.itemsProvider();
    const pendingItems = allItems.filter(
      (item) => (item.status === 'pending' || item.status === 'paused') && !this.activeWorkers.has(item.id)
    );

    if (pendingItems.length === 0 && this.activeWorkers.size === 0) {
      this.isRunning = false;
      if (this.speedTimer) {
        clearInterval(this.speedTimer);
        this.speedTimer = null;
      }
      this.callbacks.onSpeedUpdate?.('0 KB/s', 0, 0);
      this.callbacks.onQueueDrained?.();
      return;
    }

    for (const nextItem of pendingItems) {
      if (this.isPaused || !this.isRunning) break;

      const isLarge = nextItem.fileSize > LARGE_THRESHOLD;

      if (isLarge) {
        // Exclusive worker lock: wait until all active workers drain before starting large file
        if (this.activeWorkers.size > 0) {
          return;
        }
        this.spawnWorker(nextItem);
        return; // Run solo
      } else {
        const targetConcurrency = getMobileAdaptiveConcurrency(nextItem.fileSize);
        if (this.activeWorkers.size >= targetConcurrency) {
          return;
        }
        this.spawnWorker(nextItem);
      }
    }
  }

  private async spawnWorker(item: BackupItem): Promise<void> {
    const id = item.id;
    this.activeWorkers.add(id);
    const controller = new AbortController();
    this.activeControllers.set(id, controller);

    const startTime = Date.now();
    this.callbacks.onTaskStart?.(item);

    try {
      const onProgressCallback = (uploadedBytes: number, totalBytes: number) => {
        if (controller.signal.aborted || this.isPaused) return;
        this.speedAggregator.recordProgress(id, uploadedBytes);
        const total = totalBytes > 0 ? totalBytes : item.fileSize || 1;
        const percent = Math.min(100, Math.round((uploadedBytes / total) * 100));
        this.callbacks.onTaskProgress?.(item, uploadedBytes, percent);
      };

      let lastErr: any = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        if (controller.signal.aborted || this.isPaused) break;

        try {
          const result = await this.callbacks.executor(item, controller.signal, onProgressCallback);

          if (!controller.signal.aborted && !this.isPaused) {
            const durationMs = Date.now() - startTime;
            // Await so QueueStorage disk write completes before finally frees the slot
            await this.callbacks.onTaskComplete?.(item, result, durationMs);
            lastErr = null;
          }
          break;
        } catch (err: any) {
          lastErr = err;
          if (controller.signal.aborted || this.isPaused || err.name === 'FloodWaitError') {
            break;
          }
          if (attempt < 3) {
            console.warn(
              `[UploadDispatcher] Attempt ${attempt}/3 for ${item.fileName} failed (${err?.message || err}). Retrying in 1.5s...`
            );
            await new Promise<void>((resolve) => setTimeout(() => resolve(), 1500));
          }
        }
      }

      if (lastErr && !controller.signal.aborted && !this.isPaused) {
        // Await so QueueStorage disk write completes before finally frees the slot
        await this.callbacks.onTaskError?.(item, lastErr);
      }
    } finally {
      this.activeWorkers.delete(id);
      this.activeControllers.delete(id);
      this.speedAggregator.removeWorker(id);

      // Trigger next round of sliding window scheduling
      if (this.isRunning && !this.isPaused) {
        setTimeout(() => {
          if (this.isRunning && !this.isPaused) {
            this.schedule();
          }
        }, 50);
      }
    }
  }
}
