import bigInt from "big-integer";

export const MAX_TELEGRAM_FILE_SIZE = 2000 * 1024 * 1024; // 2,000 MB (Telegram standard upload limit)

export function toBigInt(val: number | string, radix?: number) {
  const fn: any = typeof bigInt === "function" ? bigInt : (bigInt as any).default;
  if (typeof val === "string" && val.startsWith("0x")) {
    return fn(val.slice(2), 16);
  }
  return radix ? fn(val, radix) : fn(val);
}

/**
 * Sliding-Window Rate Pacer to ensure outgoing MTProto RPC requests
 * strictly remain under a target limit (e.g. 25 req/sec) across all parallel workers.
 */
export class SlidingWindowRatePacer {
  private timestamps: number[] = [];
  private maxRequests: number;
  private windowMs: number;

  constructor(maxRequests: number = 25, windowMs: number = 1000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  async acquire(): Promise<void> {
    while (true) {
      const now = Date.now();
      // Remove timestamps older than the sliding window
      this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);

      if (this.timestamps.length < this.maxRequests) {
        this.timestamps.push(now);
        return;
      }

      // Oldest timestamp must expire before a new slot opens
      const oldest = this.timestamps[0];
      const waitTime = this.windowMs - (now - oldest) + 5; // +5ms safety jitter buffer
      if (waitTime > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }
  }
}
