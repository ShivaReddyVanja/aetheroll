import type {
  BillingMetrics,
  BillingPurpose,
  BillingStorageRepository,
  UserBillingSummary,
  SystemBillingSummary,
} from "./types";
import { DEFAULT_CLOUDFLARE_FREE_LIMITS } from "./types";
import { createEmptyMetrics, addMetrics, compareAgainstLimits } from "./calculator";

/**
 * In-memory storage repository for unit tests and local dev mock environments.
 */
export class InMemoryBillingRepository implements BillingStorageRepository {
  // Key: `${userId}:${periodDate}:${purpose}` -> BillingMetrics
  private store = new Map<string, BillingMetrics>();

  async saveMetrics(
    userId: string,
    purpose: BillingPurpose | string,
    periodDate: string,
    metrics: BillingMetrics
  ): Promise<void> {
    const key = `${userId}:${periodDate}:${purpose}`;
    const existing = this.store.get(key) || createEmptyMetrics();
    this.store.set(key, addMetrics({ ...existing }, { ...metrics }));
  }

  async getUserSummary(userId: string, periodDate: string): Promise<UserBillingSummary | null> {
    const totalMetrics = createEmptyMetrics();
    const byPurpose: Record<string, BillingMetrics> = {};
    let found = false;

    for (const [key, metrics] of this.store.entries()) {
      const [uId, date, purpose] = key.split(":");
      if (uId === userId && date === periodDate) {
        found = true;
        byPurpose[purpose] = addMetrics(byPurpose[purpose] || createEmptyMetrics(), { ...metrics });
        addMetrics(totalMetrics, { ...metrics });
      }
    }

    if (!found) return null;

    return {
      userId,
      periodDate,
      totalMetrics,
      byPurpose,
    };
  }

  async getSystemSummary(periodDate: string): Promise<SystemBillingSummary> {
    const totalMetrics = createEmptyMetrics();
    const activeUsers = new Set<string>();

    for (const [key, metrics] of this.store.entries()) {
      const [uId, date] = key.split(":");
      if (date === periodDate) {
        activeUsers.add(uId);
        addMetrics(totalMetrics, metrics);
      }
    }

    const comparisonVsFreeTier = compareAgainstLimits(totalMetrics, DEFAULT_CLOUDFLARE_FREE_LIMITS);

    return {
      periodDate,
      activeUsersCount: activeUsers.size,
      totalMetrics,
      comparisonVsFreeTier,
    };
  }

  clear() {
    this.store.clear();
  }
}

/**
 * Cloudflare D1 Storage Repository for production persistence.
 * Uses `skipBilling: true` to prevent metric queries from triggering recursive billing logs.
 */
export class D1BillingRepository implements BillingStorageRepository {
  private db: any;

  constructor(db: any) {
    this.db = db;
  }

  async saveMetrics(
    userId: string,
    purpose: BillingPurpose | string,
    periodDate: string,
    metrics: BillingMetrics
  ): Promise<void> {
    if (!this.db) return;

    const id = crypto.randomUUID();
    const sql = `
      INSERT INTO user_billing_metrics (
        id, user_id, purpose, period_date,
        do_requests, do_duration_ms, do_gb_seconds,
        do_storage_read_units, do_storage_write_units, do_storage_delete_units,
        d1_read_rows, d1_write_rows, d1_query_count,
        r2_class_a_ops, r2_class_b_ops, r2_bytes_transferred,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, purpose, period_date) DO UPDATE SET
        do_requests = do_requests + excluded.do_requests,
        do_duration_ms = do_duration_ms + excluded.do_duration_ms,
        do_gb_seconds = do_gb_seconds + excluded.do_gb_seconds,
        do_storage_read_units = do_storage_read_units + excluded.do_storage_read_units,
        do_storage_write_units = do_storage_write_units + excluded.do_storage_write_units,
        do_storage_delete_units = do_storage_delete_units + excluded.do_storage_delete_units,
        d1_read_rows = d1_read_rows + excluded.d1_read_rows,
        d1_write_rows = d1_write_rows + excluded.d1_write_rows,
        d1_query_count = d1_query_count + excluded.d1_query_count,
        r2_class_a_ops = r2_class_a_ops + excluded.r2_class_a_ops,
        r2_class_b_ops = r2_class_b_ops + excluded.r2_class_b_ops,
        r2_bytes_transferred = r2_bytes_transferred + excluded.r2_bytes_transferred,
        updated_at = CURRENT_TIMESTAMP
    `;

    const params = [
      id,
      userId || "anonymous",
      purpose,
      periodDate,
      metrics.doRequests,
      metrics.doDurationMs,
      metrics.doGbSeconds,
      metrics.doStorageReadUnits,
      metrics.doStorageWriteUnits,
      metrics.doStorageDeleteUnits,
      metrics.d1ReadRows,
      metrics.d1WriteRows,
      metrics.d1QueryCount,
      metrics.r2ClassAOps,
      metrics.r2ClassBOps,
      metrics.r2BytesTransferred,
    ];

    try {
      // Execute with skipBilling flag if support exists on DB wrapper
      if (typeof this.db.run === "function") {
        await this.db.run(sql, params, { skipBilling: true });
      }
    } catch (err) {
      console.error("[D1BillingRepository Error]: Failed to save metrics:", err);
    }
  }

  async getUserSummary(userId: string, periodDate: string): Promise<UserBillingSummary | null> {
    if (!this.db || typeof this.db.all !== "function") return null;

    const sql = `
      SELECT purpose,
             SUM(do_requests) as do_requests,
             SUM(do_duration_ms) as do_duration_ms,
             SUM(do_gb_seconds) as do_gb_seconds,
             SUM(do_storage_read_units) as do_storage_read_units,
             SUM(do_storage_write_units) as do_storage_write_units,
             SUM(do_storage_delete_units) as do_storage_delete_units,
             SUM(d1_read_rows) as d1_read_rows,
             SUM(d1_write_rows) as d1_write_rows,
             SUM(d1_query_count) as d1_query_count,
             SUM(r2_class_a_ops) as r2_class_a_ops,
             SUM(r2_class_b_ops) as r2_class_b_ops,
             SUM(r2_bytes_transferred) as r2_bytes_transferred
      FROM user_billing_metrics
      WHERE user_id = ? AND period_date = ?
      GROUP BY purpose
    `;

    try {
      const rows = await this.db.all(sql, [userId, periodDate], { skipBilling: true });
      if (!rows || rows.length === 0) return null;

      const totalMetrics = createEmptyMetrics();
      const byPurpose: Record<string, BillingMetrics> = {};

      for (const row of rows) {
        const item: BillingMetrics = {
          doRequests: Number(row.do_requests || 0),
          doDurationMs: Number(row.do_duration_ms || 0),
          doGbSeconds: Number(row.do_gb_seconds || 0),
          doStorageReadUnits: Number(row.do_storage_read_units || 0),
          doStorageWriteUnits: Number(row.do_storage_write_units || 0),
          doStorageDeleteUnits: Number(row.do_storage_delete_units || 0),
          d1ReadRows: Number(row.d1_read_rows || 0),
          d1WriteRows: Number(row.d1_write_rows || 0),
          d1QueryCount: Number(row.d1_query_count || 0),
          r2ClassAOps: Number(row.r2_class_a_ops || 0),
          r2ClassBOps: Number(row.r2_class_b_ops || 0),
          r2BytesTransferred: Number(row.r2_bytes_transferred || 0),
        };
        byPurpose[row.purpose] = item;
        addMetrics(totalMetrics, item);
      }

      return { userId, periodDate, totalMetrics, byPurpose };
    } catch (err) {
      console.error("[D1BillingRepository Error]: Failed to get user summary:", err);
      return null;
    }
  }

  async getSystemSummary(periodDate: string): Promise<SystemBillingSummary> {
    const totalMetrics = createEmptyMetrics();
    let activeUsersCount = 0;

    if (this.db && typeof this.db.all === "function") {
      const sql = `
        SELECT COUNT(DISTINCT user_id) as active_users,
               SUM(do_requests) as do_requests,
               SUM(do_duration_ms) as do_duration_ms,
               SUM(do_gb_seconds) as do_gb_seconds,
               SUM(do_storage_read_units) as do_storage_read_units,
               SUM(do_storage_write_units) as do_storage_write_units,
               SUM(do_storage_delete_units) as do_storage_delete_units,
               SUM(d1_read_rows) as d1_read_rows,
               SUM(d1_write_rows) as d1_write_rows,
               SUM(d1_query_count) as d1_query_count,
               SUM(r2_class_a_ops) as r2_class_a_ops,
               SUM(r2_class_b_ops) as r2_class_b_ops,
               SUM(r2_bytes_transferred) as r2_bytes_transferred
        FROM user_billing_metrics
        WHERE period_date = ?
      `;

      try {
        const rows = await this.db.all(sql, [periodDate], { skipBilling: true });
        if (rows && rows[0]) {
          const row = rows[0];
          activeUsersCount = Number(row.active_users || 0);
          totalMetrics.doRequests = Number(row.do_requests || 0);
          totalMetrics.doDurationMs = Number(row.do_duration_ms || 0);
          totalMetrics.doGbSeconds = Number(row.do_gb_seconds || 0);
          totalMetrics.doStorageReadUnits = Number(row.do_storage_read_units || 0);
          totalMetrics.doStorageWriteUnits = Number(row.do_storage_write_units || 0);
          totalMetrics.doStorageDeleteUnits = Number(row.do_storage_delete_units || 0);
          totalMetrics.d1ReadRows = Number(row.d1_read_rows || 0);
          totalMetrics.d1WriteRows = Number(row.d1_write_rows || 0);
          totalMetrics.d1QueryCount = Number(row.d1_query_count || 0);
          totalMetrics.r2ClassAOps = Number(row.r2_class_a_ops || 0);
          totalMetrics.r2ClassBOps = Number(row.r2_class_b_ops || 0);
          totalMetrics.r2BytesTransferred = Number(row.r2_bytes_transferred || 0);
        }
      } catch (err) {
        console.error("[D1BillingRepository Error]: Failed to get system summary:", err);
      }
    }

    const comparisonVsFreeTier = compareAgainstLimits(totalMetrics, DEFAULT_CLOUDFLARE_FREE_LIMITS);

    return {
      periodDate,
      activeUsersCount,
      totalMetrics,
      comparisonVsFreeTier,
    };
  }
}
