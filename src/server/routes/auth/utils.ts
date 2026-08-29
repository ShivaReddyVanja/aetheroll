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

/**
 * Appends Set-Cookie headers that:
 * 1. Explicitly clear any legacy host-only & domain-scoped cookies (tg_session & aetheroll_session)
 * 2. Set the single clean active tg_session cookie
 */
export function appendCleanSingleAuthCookieHeaders(
  headers: Headers,
  sessionToken: string,
  isBuiltByShiva: boolean,
  isProd: boolean = true
) {
  const secureStr = isProd ? "; Secure" : "";
  const domainPart = isBuiltByShiva ? "; Domain=.builtbyshiva.com" : "";

  // 1. Purge host-only tg_session
  headers.append("Set-Cookie", `tg_session=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly${secureStr}; SameSite=None`);
  // 2. Purge domain-scoped tg_session (if domain is active)
  if (isBuiltByShiva) {
    headers.append("Set-Cookie", `tg_session=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly${secureStr}; SameSite=None${domainPart}`);
  }
  // 3. Purge host-only legacy aetheroll_session
  headers.append("Set-Cookie", `aetheroll_session=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly${secureStr}; SameSite=None`);
  // 4. Purge domain-scoped legacy aetheroll_session
  if (isBuiltByShiva) {
    headers.append("Set-Cookie", `aetheroll_session=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly${secureStr}; SameSite=None${domainPart}`);
  }
  // 5. Set THE SINGLE CLEAN ACTIVE COOKIE
  headers.append("Set-Cookie", `tg_session=${sessionToken}; Path=/; HttpOnly${secureStr}; SameSite=None; Max-Age=2592000${domainPart}`);
}

/**
 * Appends Set-Cookie headers that purge all session cookies on logout
 */
export function appendCleanClearAuthCookieHeaders(
  headers: Headers,
  isBuiltByShiva: boolean,
  isProd: boolean = true
) {
  const secureStr = isProd ? "; Secure" : "";
  const domainPart = isBuiltByShiva ? "; Domain=.builtbyshiva.com" : "";

  headers.append("Set-Cookie", `tg_session=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly${secureStr}; SameSite=None`);
  headers.append("Set-Cookie", `tg_session=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly${secureStr}; SameSite=None${domainPart}`);
  headers.append("Set-Cookie", `aetheroll_session=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly${secureStr}; SameSite=None`);
  headers.append("Set-Cookie", `aetheroll_session=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly${secureStr}; SameSite=None${domainPart}`);
}

export function forwardToAuthDO(c: any) {
  const id = c.env.AUTH_DO.idFromName("telegram_auth_singleton");
  const stub = c.env.AUTH_DO.get(id);

  const headers = new Headers(c.req.raw?.headers || c.req.header());
  if (c.env?.TELEGRAM_API_ID) headers.set("x-tg-api-id", String(c.env.TELEGRAM_API_ID));
  if (c.env?.TELEGRAM_API_HASH) headers.set("x-tg-api-hash", String(c.env.TELEGRAM_API_HASH));
  if (c.env?.TELEGRAM_TEST_MODE) headers.set("x-tg-test-mode", String(c.env.TELEGRAM_TEST_MODE));
  if (c.env?.SESSION_ENCRYPTION_KEY) headers.set("x-tg-enc-key", String(c.env.SESSION_ENCRYPTION_KEY));

  const method = c.req.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";

  const reqInit: RequestInit = {
    method,
    headers,
  };

  if (hasBody && c.req.raw?.body) {
    reqInit.body = c.req.raw.body;
    (reqInit as any).duplex = "half";
  }

  const req = new Request(c.req.url, reqInit);
  return stub.fetch(req);
}
