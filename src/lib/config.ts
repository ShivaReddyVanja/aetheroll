/**
 * Aetheroll Configuration & Remote Worker API Single Source of Truth
 */

export const AETHEROLL_WORKER_URL = (
  process.env.NEXT_PUBLIC_REMOTE_API_URL ||
  process.env.REMOTE_API_URL ||
  "https://aetheroll.shivareddyvanja.workers.dev"
).replace(/\/$/, "");

/**
 * Returns the effective API base URL (either remote worker or relative for same-origin)
 */
export function getApiBaseUrl(isRemoteOnly: boolean = false): string {
  if (isRemoteOnly) return AETHEROLL_WORKER_URL;

  if (typeof window !== "undefined") {
    const isLocalhost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
    const backendMode = (process.env.NEXT_PUBLIC_BACKEND_MODE || "").toLowerCase();
    if (backendMode === "prod" || backendMode === "remote") {
      return AETHEROLL_WORKER_URL;
    }
    return isLocalhost ? "" : AETHEROLL_WORKER_URL;
  }

  return AETHEROLL_WORKER_URL;
}

/**
 * Returns the WebSocket URL for real-time authentication
 */
export function getAuthWsUrl(): string {
  if (typeof window !== "undefined") {
    const isHttps = window.location.protocol === "https:";
    const defaultWsProtocol = isHttps ? "wss:" : "ws:";
    const remoteUrl = process.env.NEXT_PUBLIC_REMOTE_API_URL;

    if (remoteUrl && remoteUrl.startsWith("http")) {
      const parsed = new URL(remoteUrl);
      const remoteWsProto = parsed.protocol === "https:" ? "wss:" : "ws:";
      return `${remoteWsProto}//${parsed.host}/api/auth/ws`;
    }

    if (AETHEROLL_WORKER_URL && AETHEROLL_WORKER_URL.startsWith("http")) {
      const parsed = new URL(AETHEROLL_WORKER_URL);
      const remoteWsProto = parsed.protocol === "https:" ? "wss:" : "ws:";
      return `${remoteWsProto}//${parsed.host}/api/auth/ws`;
    }

    return `${defaultWsProtocol}//${window.location.host}/api/auth/ws`;
  }

  const parsed = new URL(AETHEROLL_WORKER_URL);
  const remoteWsProto = parsed.protocol === "https:" ? "wss:" : "ws:";
  return `${remoteWsProto}//${parsed.host}/api/auth/ws`;
}
