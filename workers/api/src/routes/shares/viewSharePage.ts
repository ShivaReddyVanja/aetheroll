import { Hono } from "hono";

export const viewSharePageRoute = new Hono();

/**
 * GET /v/:shareId
 * Seamlessly redirects visitors from the API domain to the official web frontend player
 * at https://aetheroll.builtbyshiva.com/v/:shareId.
 */
viewSharePageRoute.get("/v/:shareId", (c) => {
  const shareId = c.req.param("shareId");
  if (!shareId) {
    return c.text("Share ID required", 400);
  }

  const webAppUrl = ((c.env as any)?.WEB_APP_URL || "https://aetheroll.builtbyshiva.com").replace(/\/$/, "");
  return c.redirect(`${webAppUrl}/v/${encodeURIComponent(shareId)}`, 302);
});

