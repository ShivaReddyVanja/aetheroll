import type { BillingMetrics, BillingPurpose, BillingStorageRepository } from "./types";
import { calculateGbSeconds, createEmptyMetrics } from "./calculator";
import { D1BillingRepository } from "./repository";
import { getDb } from "../db";

/**
 * Thread-safe / Request-scoped metrics collector that accumulates usage for a single request lifetime.
 */
export class BillingCollector {
  private metrics: BillingMetrics;
  private ramMb: number;

  constructor(ramMb: number = 128) {
    this.ramMb = ramMb;
    this.metrics = createEmptyMetrics();
  }

  addDoInvocation(durationMs: number) {
    this.metrics.doRequests += 1;
    this.metrics.doDurationMs += Math.max(0, durationMs);
    this.metrics.doGbSeconds = calculateGbSeconds(this.metrics.doDurationMs, this.ramMb);
  }

  addDoStorageOps(readUnits: number = 0, writeUnits: number = 0, deleteUnits: number = 0) {
    this.metrics.doStorageReadUnits += Math.max(0, readUnits);
    this.metrics.doStorageWriteUnits += Math.max(0, writeUnits);
    this.metrics.doStorageDeleteUnits += Math.max(0, deleteUnits);
  }

  addD1Query(readRows: number = 0, writeRows: number = 0) {
    this.metrics.d1QueryCount += 1;
    this.metrics.d1ReadRows += Math.max(0, readRows);
    this.metrics.d1WriteRows += Math.max(0, writeRows);
  }

  addR2Operation(type: "class_a" | "class_b", bytesTransferred: number = 0) {
    if (type === "class_a") {
      this.metrics.r2ClassAOps += 1;
    } else {
      this.metrics.r2ClassBOps += 1;
    }
    this.metrics.r2BytesTransferred += Math.max(0, bytesTransferred);
  }

  getMetrics(): BillingMetrics {
    return { ...this.metrics };
  }

  reset() {
    this.metrics = createEmptyMetrics();
  }

  async flush(
    userId: string,
    purpose: BillingPurpose | string,
    storageRepo: BillingStorageRepository,
    periodDate?: string
  ): Promise<void> {
    const metricsToFlush = this.getMetrics();
    const date = periodDate || new Date().toISOString().split("T")[0];

    // Only flush if there is non-zero recorded usage
    const hasUsage =
      metricsToFlush.doRequests > 0 ||
      metricsToFlush.d1QueryCount > 0 ||
      metricsToFlush.r2ClassAOps > 0 ||
      metricsToFlush.r2ClassBOps > 0;

    if (hasUsage) {
      await storageRepo.saveMetrics(userId || "anonymous", purpose, date, metricsToFlush);
      this.reset();
    }
  }
}

/**
 * Reusable helper to flush wall-clock duration & DO invocations for any request or stream session.
 */
export async function flushSessionBilling(options: {
  startTime: number;
  userId?: string | null;
  purpose: BillingPurpose | string;
  dbBinding?: any;
  collector?: BillingCollector;
}): Promise<void> {
  const durationMs = Math.round(performance.now() - options.startTime);
  if (durationMs <= 0 || !options.dbBinding) return;

  try {
    const collector = options.collector || new BillingCollector();
    collector.addDoInvocation(durationMs);
    const repo = new D1BillingRepository(getDb(options.dbBinding));
    await collector.flush(options.userId || "anonymous", options.purpose, repo);
  } catch (err) {
    console.error(`[SessionBilling] Failed to flush ${options.purpose} metrics:`, err);
  }
}
