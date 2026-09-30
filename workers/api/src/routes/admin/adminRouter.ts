import { Hono } from "hono";
import { getDb } from "../../lib/db";
import { resolveUserAuth } from "../../lib/auth";
import { AdminService } from "../../services/adminService";
import { CampaignService } from "../../services/campaignService";

export const adminRouter = new Hono();

/**
 * Middleware: Verify Admin Access via Admin Secret Header or Session Auth
 */
adminRouter.use("*", async (c, next) => {
  const envObj = (c.env as any) || {};
  const adminSecret = envObj.ADMIN_SECRET || process.env.ADMIN_SECRET;
  const reqSecret = c.req.header("x-admin-secret");

  // 1. Check direct Admin Secret Header
  if (adminSecret && reqSecret === adminSecret) {
    return next();
  }

  // 2. Fallback to User Session Auth
  const auth = await resolveUserAuth(c);
  if (auth.authenticated && auth.isAdmin) {
    return next();
  }

  return c.json({ error: "Unauthorized: Administrator privileges required." }, 403);
});

/**
 * GET /api/admin/users
 * List all users with pagination and search
 */
adminRouter.get("/users", async (c) => {
  const db = getDb((c.env as any)?.DB);
  const limit = parseInt(c.req.query("limit") || "20", 10);
  const offset = parseInt(c.req.query("offset") || "0", 10);
  const search = c.req.query("search");

  const result = await AdminService.listUsers(db, { limit, offset, search });
  return c.json(result);
});

/**
 * GET /api/admin/users/:identifier
 * Inspect single user details and metrics
 */
adminRouter.get("/users/:identifier", async (c) => {
  const db = getDb((c.env as any)?.DB);
  const identifier = c.req.param("identifier");
  const user = await AdminService.getUserDetails(db, identifier);

  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  return c.json(user);
});

/**
 * POST /api/admin/codes/generate
 * Generate custom or random Pro activation code
 */
adminRouter.post("/codes/generate", async (c) => {
  const db = getDb((c.env as any)?.DB);
  const body = await c.req.json().catch(() => ({}));
  const { code, durationDays, maxUses, note, tier, expiresAt } = body;

  try {
    const result = await AdminService.generateActivationCode(db, {
      code,
      durationDays,
      maxUses,
      note,
      tier,
      expiresAt,
    });
    return c.json(result);
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

/**
 * POST /api/admin/tier/assign
 * Directly grant Pro membership to a user
 */
adminRouter.post("/tier/assign", async (c) => {
  const db = getDb((c.env as any)?.DB);
  const body = await c.req.json().catch(() => ({}));
  const { targetUser, durationDays, tier, grantedBy } = body;

  if (!targetUser) {
    return c.json({ error: "targetUser (Telegram ID or User UUID) is required" }, 400);
  }

  try {
    const result = await AdminService.assignUserTier(db, {
      targetUser,
      durationDays,
      tier,
      grantedBy: grantedBy || "admin_rest_api",
    });
    return c.json(result);
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

/**
 * POST /api/admin/tier/hold
 * Suspend user's Pro membership
 */
adminRouter.post("/tier/hold", async (c) => {
  const db = getDb((c.env as any)?.DB);
  const body = await c.req.json().catch(() => ({}));
  const { targetUser, reason } = body;

  if (!targetUser) {
    return c.json({ error: "targetUser is required" }, 400);
  }

  try {
    const result = await AdminService.holdUserTier(db, {
      targetUser,
      reason,
    });
    return c.json(result);
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

/**
 * POST /api/admin/tier/resume
 * Resume suspended Pro membership
 */
adminRouter.post("/tier/resume", async (c) => {
  const db = getDb((c.env as any)?.DB);
  const body = await c.req.json().catch(() => ({}));
  const { targetUser } = body;

  if (!targetUser) {
    return c.json({ error: "targetUser is required" }, 400);
  }

  try {
    const result = await AdminService.resumeUserTier(db, targetUser);
    return c.json(result);
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

/**
 * POST /api/admin/tier/revoke
 * Revoke Pro membership and reset user to Free
 */
adminRouter.post("/tier/revoke", async (c) => {
  const db = getDb((c.env as any)?.DB);
  const body = await c.req.json().catch(() => ({}));
  const { targetUser } = body;

  if (!targetUser) {
    return c.json({ error: "targetUser is required" }, 400);
  }

  try {
    const result = await AdminService.revokeUserTier(db, targetUser);
    return c.json(result);
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

/**
 * GET /api/admin/campaigns
 * List all signup/onboarding campaigns
 */
adminRouter.get("/campaigns", async (c) => {
  const db = getDb((c.env as any)?.DB);
  const campaigns = await CampaignService.listCampaigns(db);
  return c.json({ campaigns });
});

/**
 * POST /api/admin/campaigns
 * Create a new signup campaign (e.g. First 100 users, Next 50 users)
 */
adminRouter.post("/campaigns", async (c) => {
  const db = getDb((c.env as any)?.DB);
  const body = await c.req.json().catch(() => ({}));

  try {
    const campaign = await CampaignService.createCampaign(db, body);
    return c.json({ success: true, campaign }, 201);
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

/**
 * GET /api/admin/campaigns/:id
 * Get single campaign details
 */
adminRouter.get("/campaigns/:id", async (c) => {
  const db = getDb((c.env as any)?.DB);
  const id = c.req.param("id");
  const campaign = await CampaignService.getCampaign(db, id);

  if (!campaign) {
    return c.json({ error: "Campaign not found" }, 404);
  }

  return c.json(campaign);
});

/**
 * PATCH /api/admin/campaigns/:id
 * Update campaign properties (pause/resume, adjust max quota, dates, priority)
 */
adminRouter.patch("/campaigns/:id", async (c) => {
  const db = getDb((c.env as any)?.DB);
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));

  try {
    const campaign = await CampaignService.updateCampaign(db, id, body);
    return c.json({ success: true, campaign });
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

/**
 * DELETE /api/admin/campaigns/:id
 * Delete/archive a campaign
 */
adminRouter.delete("/campaigns/:id", async (c) => {
  const db = getDb((c.env as any)?.DB);
  const id = c.req.param("id");

  const deleted = await CampaignService.deleteCampaign(db, id);
  if (!deleted) {
    return c.json({ error: "Campaign not found" }, 404);
  }

  return c.json({ success: true, message: `Campaign '${id}' deleted` });
});

