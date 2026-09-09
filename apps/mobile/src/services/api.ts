// Base API Configuration and Helper Service for Aetheroll Mobile
import {
  saveSecureSession,
  getSecureSession,
  clearSecureSession,
  saveUserData,
  getUserData,
  saveStoredApiBaseUrl,
  getStoredApiBaseUrl,
} from './secureStorage';
import { DEFAULT_API_URL } from '../config';

let sessionToken: string | null = null;
// Default remote backend API URL (injected during release build or overridden in Settings)
let apiBaseUrl: string = DEFAULT_API_URL;

export async function setSessionToken(token: string | null) {
  console.log('[API] setSessionToken called, token:', token ? `${token.slice(0, 10)}...` : 'null');
  sessionToken = token;
  if (token) {
    await saveSecureSession(token);
  } else {
    await clearSecureSession();
  }
}

export function getSessionToken(): string | null {
  return sessionToken;
}

export async function setApiBaseUrl(url: string) {
  const cleanUrl = url.replace(/\/$/, '');
  console.log('[API] setApiBaseUrl called with:', cleanUrl);
  apiBaseUrl = cleanUrl;
  await saveStoredApiBaseUrl(cleanUrl);
}

export function getApiBaseUrl(): string {
  return apiBaseUrl;
}

/**
 * Initialize stored credentials from Android KeyStore on app launch
 */
export async function initializeAuth(): Promise<{ token: string | null; user: any | null }> {
  console.log('[API] initializeAuth starting...');
  try {
    const storedUrl = await getStoredApiBaseUrl();
    if (storedUrl) {
      console.log('[API] Loaded stored API URL:', storedUrl);
      apiBaseUrl = storedUrl;
    }

    const storedToken = await getSecureSession();
    if (storedToken) {
      console.log('[API] initializeAuth loaded token:', `${storedToken.slice(0, 10)}...`);
      sessionToken = storedToken;
    } else {
      console.log('[API] initializeAuth found NO stored token');
    }

    const cachedUser = await getUserData();
    console.log('[API] initializeAuth loaded cachedUser:', cachedUser?.displayName || (cachedUser ? 'User' : 'null'));
    return { token: storedToken, user: cachedUser };
  } catch (err) {
    console.warn('[API] Initialize auth error:', err);
    return { token: null, user: null };
  }
}

/**
 * Authenticate session with backend /api/auth/me
 */
export async function verifyCurrentSession(): Promise<{ authenticated: boolean; user?: any }> {
  console.log('[API] verifyCurrentSession starting, current sessionToken:', sessionToken ? `${sessionToken.slice(0, 10)}...` : 'NONE');
  if (!sessionToken) {
    const stored = await getSecureSession();
    if (stored) {
      console.log('[API] verifyCurrentSession restored token from storage');
      sessionToken = stored;
    } else {
      console.log('[API] verifyCurrentSession found NO token anywhere');
      return { authenticated: false };
    }
  }

  try {
    console.log('[API] Calling GET /api/auth/me ...');
    const res = await apiFetch('/api/auth/me');
    console.log('[API] /api/auth/me status:', res.status);
    if (res.ok) {
      const data: any = await res.json();
      console.log('[API] /api/auth/me data:', data);
      if (data && data.authenticated && data.user) {
        await saveUserData(data.user);
        return { authenticated: true, user: data.user };
      }
    } else {
      const errText = await res.text().catch(() => '');
      console.warn('[API] /api/auth/me response not OK:', res.status, errText);
    }
  } catch (err) {
    console.warn('[API] Session verification network error (keeping local session):', err);
  }

  // Fallback: If we have a session token and cached user, keep the user logged in
  const cachedUser = await getUserData();
  if (sessionToken) {
    console.log('[API] Keeping user authenticated with cached session token and user data');
    return {
      authenticated: true,
      user: cachedUser || { displayName: 'Telegram User' },
    };
  }

  return { authenticated: false };
}

/**
 * Perform logout
 */
export async function performLogout(): Promise<void> {
  console.log('[API] performLogout starting...');
  try {
    if (sessionToken) {
      await apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    }
  } finally {
    await setSessionToken(null);
    await saveUserData(null);
  }
}

export async function apiFetch(endpoint: string, options: RequestInit = {}): Promise<Response> {
  const url = endpoint.startsWith('http') ? endpoint : `${apiBaseUrl}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
  
  const headers = new Headers(options.headers || {});
  if (!(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  
  if (sessionToken) {
    headers.set('Authorization', `Bearer ${sessionToken}`);
    headers.set('x-tg-session', sessionToken);
  }

  console.log(`[API FETCH] ${options.method || 'GET'} ${url} (hasToken: ${!!sessionToken})`);

  return fetch(url, {
    ...options,
    headers,
  });
}

export function getMediaStreamUrl(mediaId: string): string {
  const base = `${apiBaseUrl}/api/stream?media_id=${mediaId}`;
  return sessionToken ? `${base}&session_token=${encodeURIComponent(sessionToken)}` : base;
}

export function getMediaThumbnailUrl(mediaId: string): string {
  const base = `${apiBaseUrl}/api/media/${encodeURIComponent(mediaId)}/thumbnail`;
  return sessionToken ? `${base}?session_token=${encodeURIComponent(sessionToken)}` : base;
}
