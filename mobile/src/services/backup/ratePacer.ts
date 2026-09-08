/**
 * Adaptive Rate Limit Pacer for Telegram uploads
 * Telegram limits media posting frequency to prevent FLOOD_WAIT errors.
 */
export class RatePacer {
  private static defaultDelayMs = 3000; // 3 seconds between uploads
  private static lastUploadTimestamp = 0;
  private static extraBackoffMs = 0;

  static async waitIfNeeded(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastUploadTimestamp;
    const targetDelay = this.defaultDelayMs + this.extraBackoffMs;

    if (elapsed < targetDelay) {
      const waitMs = targetDelay - elapsed;
      await new Promise<void>((resolve) => setTimeout(() => resolve(), waitMs));
    }

    // Gradually decay backoff penalty
    if (this.extraBackoffMs > 0) {
      this.extraBackoffMs = Math.max(0, this.extraBackoffMs - 1000);
    }

    this.lastUploadTimestamp = Date.now();
  }

  static applyFloodWaitPenalty(seconds: number): void {
    console.warn(`[RatePacer] Applying Telegram FLOOD_WAIT penalty of ${seconds}s`);
    this.extraBackoffMs = Math.max(this.extraBackoffMs, seconds * 1000);
  }

  static reset(): void {
    this.lastUploadTimestamp = 0;
    this.extraBackoffMs = 0;
  }
}
