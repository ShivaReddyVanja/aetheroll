/**
 * Aetheroll Configuration & Remote Worker API Single Source of Truth
 */

export const AETHEROLL_WORKER_URL = (
  process.env.NEXT_PUBLIC_REMOTE_API_URL ||
  process.env.REMOTE_API_URL ||
  ""
).replace(/\/$/, "");

/**
 * Returns the effective API base URL (either remote worker or relative for same-origin)
 */
export function getApiBaseUrl(isRemoteOnly: boolean = false): string {
  if (isRemoteOnly) return AETHEROLL_WORKER_URL;

  if (typeof window !== "undefined") {
    const backendMode = (process.env.NEXT_PUBLIC_BACKEND_MODE || "").toLowerCase();
    if (backendMode === "local" || backendMode === "dev") {
      return "";
    }
    return AETHEROLL_WORKER_URL;
  }

  return AETHEROLL_WORKER_URL;
}

/**
 * Returns the direct video streaming URL
 */
export function getMediaStreamUrl(mediaId: string): string {
  const base = getApiBaseUrl();
  return base ? `${base}/api/stream?media_id=${encodeURIComponent(mediaId)}` : `/api/stream?media_id=${encodeURIComponent(mediaId)}`;
}

/**
 * Returns the direct media thumbnail URL
 */
export function getMediaThumbnailUrl(mediaId: string): string {
  const base = getApiBaseUrl();
  return base ? `${base}/api/media/${encodeURIComponent(mediaId)}/thumbnail` : `/api/media/${encodeURIComponent(mediaId)}/thumbnail`;
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

/**
 * Unified authenticated fetch for all API endpoints with native HttpOnly credentials
 */
export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const base = getApiBaseUrl();
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  const url = path.startsWith("http") ? path : (base ? `${base}${cleanPath}` : cleanPath);

  return fetch(url, {
    ...options,
    credentials: "include",
  });
}

