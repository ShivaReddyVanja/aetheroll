import type { Context } from "hono";

// Memory store for in-flight QR login sessions before completion (local fallback)
export const activeLoginSessions = new Map<string, { client: any; tokenBuffer: Buffer; expires: number }>();

export function cleanupExpiredLoginSessions() {
  const now = Date.now() / 1000;
  for (const [id, session] of activeLoginSessions.entries()) {
    if (session.expires < now) {
      try {
        session.client.disconnect();
      } catch {}
      activeLoginSessions.delete(id);
    }
  }
}

export function getAuthCookieOptions(c: Context) {
  const host = c.req.header("host") || "";
  const origin = c.req.header("origin") || "";
  const isProd = process.env.NODE_ENV === "production" || host.includes("builtbyshiva.com") || host.includes("workers.dev");
  const isBuiltByShiva = host.includes("builtbyshiva.com") || origin.includes("builtbyshiva.com");

  return {
    path: "/",
    httpOnly: true,
    secure: isProd,
    sameSite: "None" as const,
    domain: isBuiltByShiva ? ".builtbyshiva.com" : undefined,
    maxAge: 30 * 24 * 60 * 60,
  };
}

export function forwardToAuthDO(c: any) {
  const id = c.env.AUTH_DO.idFromName("telegram_auth_singleton");
  const stub = c.env.AUTH_DO.get(id);

  const headers = new Headers(c.req.raw?.headers || c.req.header());
  if (c.env?.TELEGRAM_API_ID) headers.set("x-tg-api-id", String(c.env.TELEGRAM_API_ID));
  if (c.env?.TELEGRAM_API_HASH) headers.set("x-tg-api-hash", String(c.env.TELEGRAM_API_HASH));
  if (c.env?.TELEGRAM_TEST_MODE) headers.set("x-tg-test-mode", String(c.env.TELEGRAM_TEST_MODE));
  if (c.env?.SESSION_ENCRYPTION_KEY) headers.set("x-tg-enc-key", String(c.env.SESSION_ENCRYPTION_KEY));

  const req = new Request(c.req.url, {
    method: c.req.method,
    headers,
  });
  return stub.fetch(req);
}
