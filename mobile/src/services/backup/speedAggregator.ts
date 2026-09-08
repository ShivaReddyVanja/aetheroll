export function formatUploadFileSize(bytes: number): string {
  if (bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatUploadSpeed(bytesPerSec: number): string {
  if (bytesPerSec <= 0) return '0 KB/s';
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
}

export function formatUploadDuration(ms: number): string {
  if (ms <= 0 || !isFinite(ms)) return '0s';
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  if (mins < 60) return `${mins}m ${secs}s`;
  const hours = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  return `${hours}h ${remainingMins}m`;
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

    // Trim samples older than windowMs
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
        const oldest = validHistory[0];
        const timeDelta = Math.max(now - oldest.timestamp, 100);
        const bytesDelta = oldest.uploadedBytes;
        if (bytesDelta > 0 && timeDelta > 0) {
          totalSpeed += (bytesDelta / timeDelta) * 1000;
        }
      }
    }

    return Math.max(0, totalSpeed);
  }
}
