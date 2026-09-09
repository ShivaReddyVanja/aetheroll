export const MAX_CONCURRENT_MICRO_FILES = 8;
export const MAX_CONCURRENT_SMALL_FILES = 5;
export const MAX_CONCURRENT_MEDIUM_FILES = 3;
export const MAX_CONCURRENT_LARGE_FILES = 1;

export const MICRO_FILE_THRESHOLD = 500 * 1024; // 500 KB
export const SMALL_FILE_THRESHOLD = 3 * 1024 * 1024; // 3 MB
export const LARGE_FILE_THRESHOLD = 15 * 1024 * 1024; // 15 MB

export function getAdaptiveConcurrency(fileSize: number): number {
  if (fileSize > LARGE_FILE_THRESHOLD) return MAX_CONCURRENT_LARGE_FILES;
  if (fileSize > SMALL_FILE_THRESHOLD) return MAX_CONCURRENT_MEDIUM_FILES;
  if (fileSize > MICRO_FILE_THRESHOLD) return MAX_CONCURRENT_SMALL_FILES;
  return MAX_CONCURRENT_MICRO_FILES;
}

export interface UploadPoolItem {
  id: string;
  size: number;
  [key: string]: any;
}

export type TaskStatus = "pending" | "processing" | "uploading" | "done" | "error" | "cancelled";

export interface TaskResult<TItem = any> {
  id: string;
  item: TItem;
  status: TaskStatus;
  result?: any;
  error?: string;
  durationMs?: number;
}

export function formatUploadFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatUploadSpeed(bytesPerSec: number): string {
  if (bytesPerSec <= 0) return "0 KB/s";
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
}

export function formatUploadDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${mins}m ${secs}s`;
}

interface WorkerProgressSample {
  lastUploadedBytes: number;
  lastTimestamp: number;
  history: Array<{ timestamp: number; uploadedBytes: number }>;
}

export class RollingSpeedAggregator {
  private workers = new Map<string, WorkerProgressSample>();
  private windowMs: number;

  constructor(windowMs = 2000) {
    this.windowMs = windowMs;
  }

  recordProgress(workerId: string, currentUploadedBytes: number, now = Date.now()): void {
    let worker = this.workers.get(workerId);
    if (!worker) {
      worker = {
        lastUploadedBytes: currentUploadedBytes,
        lastTimestamp: now,
        history: [{ timestamp: now, uploadedBytes: currentUploadedBytes }],
      };
      this.workers.set(workerId, worker);
    } else {
      worker.lastUploadedBytes = currentUploadedBytes;
      worker.lastTimestamp = now;
      worker.history.push({ timestamp: now, uploadedBytes: currentUploadedBytes });
    }

    // Trim history older than windowMs
    const cutoff = now - this.windowMs;
    worker.history = worker.history.filter((h) => h.timestamp >= cutoff);
  }

  removeWorker(workerId: string): void {
    this.workers.delete(workerId);
  }

  reset(): void {
    this.workers.clear();
  }

  getCurrentSpeedBytesPerSec(now = Date.now()): number {
    let totalSpeed = 0;
    const cutoff = now - this.windowMs;

    for (const [, worker] of this.workers.entries()) {
      const validHistory = worker.history.filter((h) => h.timestamp >= cutoff);
      if (validHistory.length >= 2) {
        const oldest = validHistory[0];
        const newest = validHistory[validHistory.length - 1];
        const timeDelta = newest.timestamp - oldest.timestamp;
        const bytesDelta = newest.uploadedBytes - oldest.uploadedBytes;
        if (timeDelta > 0 && bytesDelta >= 0) {
          totalSpeed += (bytesDelta / timeDelta) * 1000;
        }
      } else if (validHistory.length === 1 && now - validHistory[0].timestamp < 1000) {
        // Fallback for initial sample if single point
        const oldest = validHistory[0];
        const timeDelta = Math.max(now - oldest.timestamp, 100);
        const bytesDelta = oldest.uploadedBytes;
        if (bytesDelta > 0 && timeDelta > 0) {
          totalSpeed += (bytesDelta / timeDelta) * 1000;
        }
      }
    }

    return totalSpeed;
  }
}

export interface DynamicUploadDispatcherOptions<TItem extends UploadPoolItem> {
  items: TItem[];
  executor: (
    item: TItem,
    signal: AbortSignal,
    onProgress: (uploadedBytes: number) => void
  ) => Promise<any>;
  onTaskStart?: (item: TItem) => void;
  onTaskProgress?: (item: TItem, uploadedBytes: number, percent: number) => void;
  onTaskComplete?: (item: TItem, result: any, durationMs: number) => void;
  onTaskError?: (item: TItem, error: Error) => void;
  onSpeedUpdate?: (speedFormatted: string, speedBytesPerSec: number) => void;
  largeFileThreshold?: number;
}

export class DynamicUploadDispatcher<TItem extends UploadPoolItem = UploadPoolItem> {
  private items: TItem[];
  private executor: (
    item: TItem,
    signal: AbortSignal,
    onProgress: (uploadedBytes: number) => void
  ) => Promise<any>;
  private onTaskStart?: (item: TItem) => void;
  private onTaskProgress?: (item: TItem, uploadedBytes: number, percent: number) => void;
  private onTaskComplete?: (item: TItem, result: any, durationMs: number) => void;
  private onTaskError?: (item: TItem, error: Error) => void;
  private onSpeedUpdate?: (speedFormatted: string, speedBytesPerSec: number) => void;

  private largeFileThreshold: number;

  private activeControllers = new Map<string, AbortController>();
  private activeWorkers = new Set<string>();
  private results = new Map<string, TaskResult<TItem>>();
  private speedAggregator = new RollingSpeedAggregator();
  private speedTimer: any = null;

  private queueIndex = 0;
  private isAborted = false;
  private resolveAll?: (results: TaskResult<TItem>[]) => void;

  constructor(options: DynamicUploadDispatcherOptions<TItem>) {
    this.items = options.items;
    this.executor = options.executor;
    this.onTaskStart = options.onTaskStart;
    this.onTaskProgress = options.onTaskProgress;
    this.onTaskComplete = options.onTaskComplete;
    this.onTaskError = options.onTaskError;
    this.onSpeedUpdate = options.onSpeedUpdate;

    this.largeFileThreshold = options.largeFileThreshold ?? LARGE_FILE_THRESHOLD;

    for (const item of this.items) {
      this.results.set(item.id, {
        id: item.id,
        item,
        status: "pending",
      });
    }
  }

  public abortTask(id: string): void {
    const controller = this.activeControllers.get(id);
    if (controller) {
      controller.abort();
      this.activeControllers.delete(id);
    }
  }

  public abortAll(): void {
    this.isAborted = true;
    for (const [, controller] of this.activeControllers.entries()) {
      controller.abort();
    }
    this.activeControllers.clear();
    this.speedAggregator.reset();
    if (this.speedTimer) {
      clearInterval(this.speedTimer);
      this.speedTimer = null;
    }
  }

  public start(): Promise<TaskResult<TItem>[]> {
    return new Promise((resolve) => {
      this.resolveAll = resolve;
      this.isAborted = false;
      this.queueIndex = 0;

      if (this.items.length === 0) {
        resolve([]);
        return;
      }

      if (this.onSpeedUpdate) {
        this.speedTimer = setInterval(() => {
          if (this.activeWorkers.size === 0) {
            this.onSpeedUpdate?.("0 KB/s", 0);
          } else {
            const speed = this.speedAggregator.getCurrentSpeedBytesPerSec();
            this.onSpeedUpdate?.(formatUploadSpeed(speed), speed);
          }
        }, 300);
      }

      this.schedule();
    });
  }

  private schedule(): void {
    if (this.isAborted) {
      this.finishIfDone();
      return;
    }

    while (this.queueIndex < this.items.length) {
      const nextItem = this.items[this.queueIndex];
      const isLarge = nextItem.size > this.largeFileThreshold;

      if (isLarge) {
        // If next file is large, we MUST wait for all current active workers to finish
        if (this.activeWorkers.size > 0) {
          // Wait for drain before starting large file
          return;
        }
        // No active workers, start the large file exclusively
        const itemToRun = this.items[this.queueIndex++];
        this.spawnWorker(itemToRun);
        return; // Don't spawn any more while large file is running
      } else {
        // Dynamic adaptive concurrency based on file size tier
        const targetConcurrency = getAdaptiveConcurrency(nextItem.size);
        if (this.activeWorkers.size >= targetConcurrency) {
          return;
        }
        const itemToRun = this.items[this.queueIndex++];
        this.spawnWorker(itemToRun);
      }
    }

    this.finishIfDone();
  }

  private async spawnWorker(item: TItem): Promise<void> {
    const id = item.id;
    this.activeWorkers.add(id);
    const controller = new AbortController();
    this.activeControllers.set(id, controller);

    const startTime = Date.now();
    this.onTaskStart?.(item);

    try {
      const onProgressCallback = (uploadedBytes: number) => {
        if (controller.signal.aborted) return;
        this.speedAggregator.recordProgress(id, uploadedBytes);
        const percent = item.size > 0 ? Math.min(Math.round((uploadedBytes / item.size) * 100), 100) : 100;
        this.onTaskProgress?.(item, uploadedBytes, percent);
      };

      const result = await this.executor(item, controller.signal, onProgressCallback);

      const durationMs = Date.now() - startTime;
      this.results.set(id, {
        id,
        item,
        status: "done",
        result,
        durationMs,
      });
      this.onTaskComplete?.(item, result, durationMs);
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      const isAbort = controller.signal.aborted || err.message === "Aborted" || err.message === "Task cancelled";
      const status: TaskStatus = isAbort ? "error" : "error";

      this.results.set(id, {
        id,
        item,
        status,
        error: err.message || "Upload failed",
        durationMs,
      });
      this.onTaskError?.(item, err);
    } finally {
      this.activeWorkers.delete(id);
      this.activeControllers.delete(id);
      this.speedAggregator.removeWorker(id);

      // Trigger next round of scheduling
      this.schedule();
    }
  }

  private finishIfDone(): void {
    if (this.activeWorkers.size === 0 && (this.queueIndex >= this.items.length || this.isAborted)) {
      if (this.speedTimer) {
        clearInterval(this.speedTimer);
        this.speedTimer = null;
      }
      this.onSpeedUpdate?.("0 KB/s", 0);

      if (this.resolveAll) {
        const finalResults = this.items.map((item) => this.results.get(item.id)!);
        this.resolveAll(finalResults);
        this.resolveAll = undefined;
      }
    }
  }
}
