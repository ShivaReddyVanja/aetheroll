export type BillingPurpose =
  | "STREAM_MEDIA"
  | "UPLOAD_FILE"
  | "WAL_EMIT"
  | "WAL_BATCH"
  | "GALLERY_INDEX"
  | "THUMBNAIL_FETCH"
  | "MEDIA_DELETE"
  | "AUTH"
  | "GENERAL";

export interface BillingMetrics {
  doRequests: number;
  doDurationMs: number;
  doGbSeconds: number;
  doStorageReadUnits: number;
  doStorageWriteUnits: number;
  doStorageDeleteUnits: number;
  d1ReadRows: number;
  d1WriteRows: number;
  d1QueryCount: number;
  r2ClassAOps: number;
  r2ClassBOps: number;
  r2BytesTransferred: number;
}

export interface CloudflareFreeTierLimits {
  doRequests: number;           // 1,000,000 / month
  doGbSeconds: number;          // 400,000 / month
  doStorageReadUnits: number;   // 1,000,000 / month
  doStorageWriteUnits: number;  // 1,000,000 / month
  doStorageDeleteUnits: number; // 1,000,000 / month
  d1ReadRows: number;           // 5,000,000 / day
  d1WriteRows: number;          // 100,000 / day
  r2ClassAOps: number;          // 1,000,000 / month
  r2ClassBOps: number;          // 10,000,000 / month
}

export const DEFAULT_CLOUDFLARE_FREE_LIMITS: CloudflareFreeTierLimits = {
  doRequests: 1_000_000,
  doGbSeconds: 400_000,
  doStorageReadUnits: 1_000_000,
  doStorageWriteUnits: 1_000_000,
  doStorageDeleteUnits: 1_000_000,
  d1ReadRows: 5_000_000,
  d1WriteRows: 100_000,
  r2ClassAOps: 1_000_000,
  r2ClassBOps: 10_000_000,
};

export interface MetricComparisonItem {
  used: number;
  limit: number;
  percentageUsed: number;
  isExceeded: boolean;
}

export type BillingComparisonResult = {
  [K in keyof CloudflareFreeTierLimits]: MetricComparisonItem;
};

export interface UserBillingSummary {
  userId: string;
  periodDate: string;
  totalMetrics: BillingMetrics;
  byPurpose: Record<string, BillingMetrics>;
}

export interface SystemBillingSummary {
  periodDate: string;
  activeUsersCount: number;
  totalMetrics: BillingMetrics;
  comparisonVsFreeTier: BillingComparisonResult;
}

export interface BillingStorageRepository {
  saveMetrics(
    userId: string,
    purpose: BillingPurpose | string,
    periodDate: string,
    metrics: BillingMetrics
  ): Promise<void>;
  getUserSummary(userId: string, periodDate: string): Promise<UserBillingSummary | null>;
  getSystemSummary(periodDate: string): Promise<SystemBillingSummary>;
}
