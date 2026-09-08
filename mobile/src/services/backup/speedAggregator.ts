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
  private smoothedSpeed = 0;

  constructor(windowMs = 6000) {
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

    // Keep samples within windowMs + 1000ms buffer so we always have a baseline
    const cutoff = now - (this.windowMs + 1000);
    worker.history = worker.history.filter((h) => h.timestamp >= cutoff);
  }

  removeWorker(workerId: string): void {
    this.workers.delete(workerId);
    if (this.workers.size === 0) {
      this.smoothedSpeed = 0;
    }
  }

  reset(): void {
    this.workers.clear();
    this.smoothedSpeed = 0;
  }

  getCurrentSpeedBytesPerSec(now = Date.now()): number {
    let instantSpeed = 0;
    const cutoff = now - this.windowMs;

    for (const [, worker] of this.workers.entries()) {
      const validHistory = worker.history.filter((h) => h.timestamp >= cutoff);
      if (validHistory.length >= 2) {
        const oldest = validHistory[0];
        const newest = validHistory[validHistory.length - 1];
        const timeDelta = newest.timestamp - oldest.timestamp;
        const bytesDelta = newest.uploadedBytes - oldest.uploadedBytes;
        if (timeDelta > 0 && bytesDelta >= 0) {
          instantSpeed += (bytesDelta / timeDelta) * 1000;
        }
      } else if (worker.history.length >= 2) {
        // Fallback to latest available samples if within 8s
        const oldest = worker.history[0];
        const newest = worker.history[worker.history.length - 1];
        const timeDelta = newest.timestamp - oldest.timestamp;
        const bytesDelta = newest.uploadedBytes - oldest.uploadedBytes;
        if (timeDelta > 0 && bytesDelta >= 0 && now - newest.timestamp < 8000) {
          instantSpeed += (bytesDelta / timeDelta) * 1000;
        }
      }
    }

    if (instantSpeed > 0) {
      this.smoothedSpeed = this.smoothedSpeed > 0
        ? this.smoothedSpeed * 0.7 + instantSpeed * 0.3
        : instantSpeed;
    } else if (this.workers.size > 0 && this.smoothedSpeed > 0) {
      // Active worker with momentary ACK delay: smooth decay rather than dropping to 0
      this.smoothedSpeed = this.smoothedSpeed * 0.85;
      if (this.smoothedSpeed < 1024) this.smoothedSpeed = 0;
    } else {
      this.smoothedSpeed = 0;
    }

    return Math.max(0, Math.round(this.smoothedSpeed));
  }
}
