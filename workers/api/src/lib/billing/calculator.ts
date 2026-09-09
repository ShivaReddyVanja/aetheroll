import type {
  BillingMetrics,
  CloudflareFreeTierLimits,
  BillingComparisonResult,
  MetricComparisonItem,
} from "./types";
import { DEFAULT_CLOUDFLARE_FREE_LIMITS } from "./types";

/**
 * Calculates Durable Object GB-Seconds from active execution duration (ms) and RAM allocation (MB).
 * Cloudflare standard DO memory allocation is 128 MB (0.125 GB).
 */
export function calculateGbSeconds(durationMs: number, ramMb: number = 128): number {
  if (durationMs <= 0) return 0;
  const seconds = durationMs / 1000;
  const gb = ramMb / 1024;
  return Number((seconds * gb).toFixed(6));
}

/**
 * Compares actual accumulated metrics against Cloudflare Free Tier limits.
 */
export function compareAgainstLimits(
  metrics: BillingMetrics,
  limits: CloudflareFreeTierLimits = DEFAULT_CLOUDFLARE_FREE_LIMITS
): BillingComparisonResult {
  const compare = (used: number, limit: number): MetricComparisonItem => {
    const percentage = limit > 0 ? Number(((used / limit) * 100).toFixed(2)) : 0;
    return {
      used,
      limit,
      percentageUsed: percentage,
      isExceeded: used > limit,
    };
  };

  return {
    doRequests: compare(metrics.doRequests, limits.doRequests),
    doGbSeconds: compare(metrics.doGbSeconds, limits.doGbSeconds),
    doStorageReadUnits: compare(metrics.doStorageReadUnits, limits.doStorageReadUnits),
    doStorageWriteUnits: compare(metrics.doStorageWriteUnits, limits.doStorageWriteUnits),
    doStorageDeleteUnits: compare(metrics.doStorageDeleteUnits, limits.doStorageDeleteUnits),
    d1ReadRows: compare(metrics.d1ReadRows, limits.d1ReadRows),
    d1WriteRows: compare(metrics.d1WriteRows, limits.d1WriteRows),
    r2ClassAOps: compare(metrics.r2ClassAOps, limits.r2ClassAOps),
    r2ClassBOps: compare(metrics.r2ClassBOps, limits.r2ClassBOps),
  };
}

export function createEmptyMetrics(): BillingMetrics {
  return {
    doRequests: 0,
    doDurationMs: 0,
    doGbSeconds: 0,
    doStorageReadUnits: 0,
    doStorageWriteUnits: 0,
    doStorageDeleteUnits: 0,
    d1ReadRows: 0,
    d1WriteRows: 0,
    d1QueryCount: 0,
    r2ClassAOps: 0,
    r2ClassBOps: 0,
    r2BytesTransferred: 0,
  };
}

export function addMetrics(target: BillingMetrics, source: BillingMetrics): BillingMetrics {
  target.doRequests += source.doRequests || 0;
  target.doDurationMs += source.doDurationMs || 0;
  target.doGbSeconds = Number((target.doGbSeconds + (source.doGbSeconds || 0)).toFixed(6));
  target.doStorageReadUnits += source.doStorageReadUnits || 0;
  target.doStorageWriteUnits += source.doStorageWriteUnits || 0;
  target.doStorageDeleteUnits += source.doStorageDeleteUnits || 0;
  target.d1ReadRows += source.d1ReadRows || 0;
  target.d1WriteRows += source.d1WriteRows || 0;
  target.d1QueryCount += source.d1QueryCount || 0;
  target.r2ClassAOps += source.r2ClassAOps || 0;
  target.r2ClassBOps += source.r2ClassBOps || 0;
  target.r2BytesTransferred += source.r2BytesTransferred || 0;
  return target;
}
