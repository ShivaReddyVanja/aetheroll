import { Hono } from "hono";
import { getDb } from "../lib/db.ts";
import { resolveUserAuth } from "../lib/auth.ts";
import { D1BillingRepository, InMemoryBillingRepository } from "../lib/billing/repository.ts";

export const billingRouter = new Hono();

/**
 * GET /api/billing/me
 * Returns current authenticated user's billing consumption in Cloudflare billing units for a target date
 */
billingRouter.get("/me", async (c) => {
  const auth = await resolveUserAuth(c);
  if (!auth.authenticated || !auth.userId) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const targetDate = c.req.query("date") || new Date().toISOString().split("T")[0];
  const dbBinding = (c.env as any)?.DB;

  const repo = dbBinding ? new D1BillingRepository(getDb(dbBinding)) : new InMemoryBillingRepository();
  const userSummary = await repo.getUserSummary(auth.userId, targetDate);

  if (!userSummary) {
    return c.json({
      userId: auth.userId,
      isAdmin: !!auth.isAdmin,
      periodDate: targetDate,
      message: "No recorded billable consumption for this period",
      totalMetrics: {
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
      },
      byPurpose: {},
    });
  }

  return c.json({
    ...userSummary,
    isAdmin: !!auth.isAdmin,
  });
});

/**
 * GET /api/billing/summary
 * Returns global system-wide billing consumption across all users compared against Cloudflare Free Tier limits
 */
billingRouter.get("/summary", async (c) => {
  const auth = await resolveUserAuth(c);
  if (!auth.authenticated || !auth.userId) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  if (!auth.isAdmin) {
    return c.json({ error: "Forbidden: Admin access required" }, 403);
  }

  const targetDate = c.req.query("date") || new Date().toISOString().split("T")[0];
  const dbBinding = (c.env as any)?.DB;

  const repo = dbBinding ? new D1BillingRepository(getDb(dbBinding)) : new InMemoryBillingRepository();
  const summary = await repo.getSystemSummary(targetDate);

  return c.json(summary);
});
