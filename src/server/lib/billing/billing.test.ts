import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  calculateGbSeconds,
  BillingCollector,
  InMemoryBillingRepository,
  compareAgainstLimits,
  DEFAULT_CLOUDFLARE_FREE_LIMITS,
  type BillingMetrics,
} from "./index.ts";

describe("Billing Package - Unit Tests", () => {
  describe("calculateGbSeconds", () => {
    it("should correctly calculate GB-seconds for standard 128MB DO allocation", () => {
      // 1000ms @ 128MB (0.125 GB) = 0.125 GB-s
      const gbSec1 = calculateGbSeconds(1000, 128);
      assert.equal(gbSec1, 0.125);

      // 8000ms @ 128MB = 1.0 GB-s
      const gbSec2 = calculateGbSeconds(8000, 128);
      assert.equal(gbSec2, 1.0);

      // 0ms = 0 GB-s
      assert.equal(calculateGbSeconds(0, 128), 0);
    });

    it("should allow custom RAM allocations", () => {
      // 1000ms @ 256MB (0.25 GB) = 0.25 GB-s
      assert.equal(calculateGbSeconds(1000, 256), 0.25);
    });
  });

  describe("BillingCollector", () => {
    it("should accumulate DO, D1, and R2 metrics correctly", () => {
      const collector = new BillingCollector();

      collector.addDoInvocation(2000); // 2000ms = 0.25 GB-s
      collector.addDoInvocation(4000); // 4000ms = 0.50 GB-s

      collector.addD1Query(15, 2); // 15 read rows, 2 write rows
      collector.addD1Query(50, 0); // 50 read rows, 0 write rows

      collector.addR2Operation("class_a", 1024); // 1 Class A op
      collector.addR2Operation("class_b", 4096); // 1 Class B op

      const metrics = collector.getMetrics();

      assert.equal(metrics.doRequests, 2);
      assert.equal(metrics.doDurationMs, 6000);
      assert.equal(metrics.doGbSeconds, 0.75);

      assert.equal(metrics.d1QueryCount, 2);
      assert.equal(metrics.d1ReadRows, 65);
      assert.equal(metrics.d1WriteRows, 2);

      assert.equal(metrics.r2ClassAOps, 1);
      assert.equal(metrics.r2ClassBOps, 1);
      assert.equal(metrics.r2BytesTransferred, 5120);
    });

    it("should reset metrics on reset()", () => {
      const collector = new BillingCollector();
      collector.addDoInvocation(1000);
      collector.addD1Query(10, 5);
      collector.reset();

      const metrics = collector.getMetrics();
      assert.equal(metrics.doRequests, 0);
      assert.equal(metrics.d1ReadRows, 0);
      assert.equal(metrics.d1WriteRows, 0);
    });

    it("should produce correct doGbSeconds in summary from collector flush end-to-end", async () => {
      const repo = new InMemoryBillingRepository();
      const collector = new BillingCollector(128);
      collector.addDoInvocation(4000);
      collector.addDoInvocation(2000);
      await collector.flush("user_123", "STREAM_MEDIA", repo, "2026-08-30");

      const summary = await repo.getUserSummary("user_123", "2026-08-30");
      const expectedGbSeconds = calculateGbSeconds(6000, 128);
      assert.ok(summary);
      assert.equal(summary.totalMetrics.doGbSeconds, expectedGbSeconds);
    });
  });

  describe("InMemoryBillingRepository", () => {
    it("should persist and aggregate metrics per user, purpose, and date", async () => {
      const repo = new InMemoryBillingRepository();
      const today = "2026-08-30";

      const m1: BillingMetrics = {
        doRequests: 5,
        doDurationMs: 4000,
        doGbSeconds: 0.5,
        doStorageReadUnits: 0,
        doStorageWriteUnits: 0,
        doStorageDeleteUnits: 0,
        d1ReadRows: 100,
        d1WriteRows: 10,
        d1QueryCount: 3,
        r2ClassAOps: 1,
        r2ClassBOps: 2,
        r2BytesTransferred: 2048,
      };

      const m2: BillingMetrics = {
        doRequests: 3,
        doDurationMs: 2000,
        doGbSeconds: 0.25,
        doStorageReadUnits: 0,
        doStorageWriteUnits: 0,
        doStorageDeleteUnits: 0,
        d1ReadRows: 50,
        d1WriteRows: 5,
        d1QueryCount: 2,
        r2ClassAOps: 0,
        r2ClassBOps: 1,
        r2BytesTransferred: 1024,
      };

      await repo.saveMetrics("user_123", "STREAM_MEDIA", today, m1);
      await repo.saveMetrics("user_123", "STREAM_MEDIA", today, m2);

      const userSummary = await repo.getUserSummary("user_123", today);
      assert.ok(userSummary);
      assert.equal(userSummary.userId, "user_123");
      assert.equal(userSummary.totalMetrics.doRequests, 8);
      assert.equal(userSummary.totalMetrics.doGbSeconds, 0.75);
      assert.equal(userSummary.totalMetrics.d1ReadRows, 150);
      assert.equal(userSummary.totalMetrics.d1WriteRows, 15);

      // Verify itemization by purpose
      assert.equal(userSummary.byPurpose["STREAM_MEDIA"].doRequests, 8);
    });

    it("should aggregate system-wide summary across multiple users", async () => {
      const repo = new InMemoryBillingRepository();
      const date = "2026-08-30";

      await repo.saveMetrics("user_A", "UPLOAD_FILE", date, {
        doRequests: 10,
        doDurationMs: 8000,
        doGbSeconds: 1.0,
        doStorageReadUnits: 0,
        doStorageWriteUnits: 0,
        doStorageDeleteUnits: 0,
        d1ReadRows: 200,
        d1WriteRows: 50,
        d1QueryCount: 5,
        r2ClassAOps: 2,
        r2ClassBOps: 0,
        r2BytesTransferred: 10240,
      });

      await repo.saveMetrics("user_B", "STREAM_MEDIA", date, {
        doRequests: 20,
        doDurationMs: 16000,
        doGbSeconds: 2.0,
        doStorageReadUnits: 0,
        doStorageWriteUnits: 0,
        doStorageDeleteUnits: 0,
        d1ReadRows: 500,
        d1WriteRows: 10,
        d1QueryCount: 12,
        r2ClassAOps: 0,
        r2ClassBOps: 5,
        r2BytesTransferred: 20480,
      });

      const systemSummary = await repo.getSystemSummary(date);
      assert.equal(systemSummary.activeUsersCount, 2);
      assert.equal(systemSummary.totalMetrics.doRequests, 30);
      assert.equal(systemSummary.totalMetrics.doGbSeconds, 3.0);
      assert.equal(systemSummary.totalMetrics.d1ReadRows, 700);
      assert.equal(systemSummary.totalMetrics.d1WriteRows, 60);
    });
  });

  describe("compareAgainstLimits", () => {
    it("should accurately compare usage against Cloudflare free limits", () => {
      const metrics: BillingMetrics = {
        doRequests: 500_000, // 50% of 1M
        doDurationMs: 1_600_000_000,
        doGbSeconds: 200_000, // 50% of 400k
        doStorageReadUnits: 100_000, // 10% of 1M
        doStorageWriteUnits: 250_000, // 25% of 1M
        doStorageDeleteUnits: 0,
        d1ReadRows: 2_500_000, // 50% of 5M daily free tier
        d1WriteRows: 10_000, // 10% of 100k daily free tier
        d1QueryCount: 1000,
        r2ClassAOps: 100_000, // 10% of 1M
        r2ClassBOps: 1_000_000, // 10% of 1M
        r2BytesTransferred: 1048576,
      };

      const comparison = compareAgainstLimits(metrics, DEFAULT_CLOUDFLARE_FREE_LIMITS);

      assert.equal(comparison.doRequests.percentageUsed, 50.0);
      assert.equal(comparison.doGbSeconds.percentageUsed, 50.0);
      assert.equal(comparison.d1ReadRows.percentageUsed, 50.0);
      assert.equal(comparison.d1WriteRows.percentageUsed, 10.0);

      assert.equal(comparison.doRequests.isExceeded, false);
      assert.equal(comparison.d1ReadRows.isExceeded, false);
    });

    it("should flag when usage exceeds free tier limits", () => {
      const metrics: BillingMetrics = {
        doRequests: 1_500_000, // 150% of 1M free limit
        doDurationMs: 0,
        doGbSeconds: 0,
        doStorageReadUnits: 0,
        doStorageWriteUnits: 0,
        doStorageDeleteUnits: 0,
        d1ReadRows: 0,
        d1WriteRows: 200_000, // 200% of 100k free limit
        d1QueryCount: 0,
        r2ClassAOps: 0,
        r2ClassBOps: 0,
        r2BytesTransferred: 0,
      };

      const comparison = compareAgainstLimits(metrics, DEFAULT_CLOUDFLARE_FREE_LIMITS);

      assert.equal(comparison.doRequests.percentageUsed, 150.0);
      assert.equal(comparison.doRequests.isExceeded, true);
      assert.equal(comparison.d1WriteRows.percentageUsed, 200.0);
      assert.equal(comparison.d1WriteRows.isExceeded, true);
    });
  });
});
