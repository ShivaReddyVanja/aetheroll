/**
 * Adaptive Rate Limit Pacer for Telegram uploads
 * Telegram limits media posting frequency to prevent FLOOD_WAIT errors.
 */
export class RatePacer {
  private static defaultDelayMs = 250; // 250ms spacing under normal conditions
  private static lastUploadTimestamp = 0;
  private static extraBackoffMs = 0;
  private static floodWaitUntil = 0;

  static async waitIfNeeded(): Promise<void> {
    const now = Date.now();

    // Check if we are currently in an active FLOOD_WAIT block
    if (this.floodWaitUntil > now) {
      const waitMs = this.floodWaitUntil - now;
      await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
    }

    const elapsed = Date.now() - this.lastUploadTimestamp;
    const targetDelay = this.defaultDelayMs + this.extraBackoffMs;

    if (elapsed < targetDelay) {
      const waitMs = targetDelay - elapsed;
      await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
    }

    // Gradually decay backoff penalty
    if (this.extraBackoffMs > 0) {
      this.extraBackoffMs = Math.max(0, this.extraBackoffMs - 500);
    }

    this.lastUploadTimestamp = Date.now();
  }

  static applyFloodWaitPenalty(seconds: number): void {
    const penaltyMs = seconds * 1000;
    console.warn(`[RatePacer] Applying Telegram FLOOD_WAIT penalty of ${seconds}s`);
    this.floodWaitUntil = Date.now() + penaltyMs;
    this.extraBackoffMs = Math.max(this.extraBackoffMs, Math.min(penaltyMs, 10000));
  }

  static isThrottled(): boolean {
    return Date.now() < this.floodWaitUntil;
  }

  static getRemainingFloodWaitSeconds(): number {
    const remaining = this.floodWaitUntil - Date.now();
    return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
  }

  static reset(): void {
    this.lastUploadTimestamp = 0;
    this.extraBackoffMs = 0;
    this.floodWaitUntil = 0;
  }
}
