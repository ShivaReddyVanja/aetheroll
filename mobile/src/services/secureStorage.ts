import * as Keychain from 'react-native-keychain';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYCHAIN_SERVICE = 'com.aetheroll.mobile.auth';
const ASYNC_STORAGE_FALLBACK_KEY = '@aetheroll_session_token';
const USER_DATA_KEY = '@aetheroll_user_data';
const SERVER_URL_KEY = '@aetheroll_server_url';
const ACTIVE_CHANNEL_KEY = '@aetheroll_active_channel';

/**
 * Store session token in hardware-backed Android KeyStore / iOS Keychain + AsyncStorage
 */
export async function saveSecureSession(token: string): Promise<void> {
  console.log('[STORAGE] saveSecureSession called, token length:', token?.length);
  // Always persist to AsyncStorage for instant, guaranteed availability across reloads
  try {
    await AsyncStorage.setItem(ASYNC_STORAGE_FALLBACK_KEY, token);
    console.log('[STORAGE] Token saved to AsyncStorage successfully');
  } catch (asyncErr) {
    console.warn('[STORAGE] AsyncStorage token save error:', asyncErr);
  }

  // Also persist to hardware-backed KeyStore
  try {
    await Keychain.setGenericPassword('aetheroll_user', token, {
      service: KEYCHAIN_SERVICE,
      accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK,
      securityLevel: Keychain.SECURITY_LEVEL.ANY,
    });
    console.log('[STORAGE] Token saved to Keychain successfully');
  } catch (err) {
    console.warn('[STORAGE] Keychain save error:', err);
  }
}

/**
 * Retrieve session token with self-healing fallback (KeyStore <-> AsyncStorage)
 */
export async function getSecureSession(): Promise<string | null> {
  console.log('[STORAGE] getSecureSession starting...');
  let token: string | null = null;

  // 1. Try Keychain
  try {
    const credentials = await Keychain.getGenericPassword({
      service: KEYCHAIN_SERVICE,
    });
    if (credentials && credentials.password && credentials.password.trim().length > 0) {
      token = credentials.password.trim();
      console.log('[STORAGE] Found token in Keychain (length:', token.length, ')');
    } else {
      console.log('[STORAGE] No token found in Keychain');
    }
  } catch (err) {
    console.warn('[STORAGE] Keychain get error:', err);
  }

  // 2. If not found in Keychain, try AsyncStorage fallback
  if (!token) {
    try {
      const fallbackToken = await AsyncStorage.getItem(ASYNC_STORAGE_FALLBACK_KEY);
      if (fallbackToken && fallbackToken.trim().length > 0) {
        token = fallbackToken.trim();
        console.log('[STORAGE] Found token in AsyncStorage fallback (length:', token.length, ')');
        // Self-heal: write back to Keychain
        Keychain.setGenericPassword('aetheroll_user', token, {
          service: KEYCHAIN_SERVICE,
          accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK,
          securityLevel: Keychain.SECURITY_LEVEL.ANY,
        }).catch(() => {});
      } else {
        console.log('[STORAGE] No token found in AsyncStorage either');
      }
    } catch (aErr) {
      console.warn('[STORAGE] AsyncStorage get error:', aErr);
    }
  } else {
    // Self-heal: ensure AsyncStorage also has it
    AsyncStorage.setItem(ASYNC_STORAGE_FALLBACK_KEY, token).catch(() => {});
  }

  console.log('[STORAGE] getSecureSession finished, returning token exists:', !!token);
  return token;
}

/**
 * Securely clear session from Android KeyStore
 */
export async function clearSecureSession(): Promise<void> {
  console.log('[STORAGE] clearSecureSession called');
  try {
    await Keychain.resetGenericPassword({ service: KEYCHAIN_SERVICE });
  } catch (err) {
    console.warn('[STORAGE] Keychain reset error:', err);
  }

  try {
    await AsyncStorage.removeItem(ASYNC_STORAGE_FALLBACK_KEY);
    await AsyncStorage.removeItem(USER_DATA_KEY);
  } catch {}
}

/**
 * Persist user profile information
 */
export async function saveUserData(user: any): Promise<void> {
  console.log('[STORAGE] saveUserData called:', JSON.stringify(user));
  try {
    if (user) {
      await AsyncStorage.setItem(USER_DATA_KEY, JSON.stringify(user));
    } else {
      await AsyncStorage.removeItem(USER_DATA_KEY);
    }
  } catch (err) {
    console.warn('[STORAGE] Save user data error:', err);
  }
}

/**
 * Get cached user profile information
 */
export async function getUserData(): Promise<any | null> {
  try {
    const raw = await AsyncStorage.getItem(USER_DATA_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    console.log('[STORAGE] getUserData returned:', parsed?.displayName || (parsed ? 'User' : 'null'));
    return parsed;
  } catch (err) {
    console.warn('[STORAGE] getUserData error:', err);
    return null;
  }
}

/**
 * Persist custom backend API base URL
 */
export async function saveStoredApiBaseUrl(url: string): Promise<void> {
  try {
    await AsyncStorage.setItem(SERVER_URL_KEY, url);
  } catch (err) {
    console.warn('Save server URL error:', err);
  }
}

/**
 * Retrieve custom backend API base URL
 */
export async function getStoredApiBaseUrl(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(SERVER_URL_KEY);
  } catch {
    return null;
  }
}

/**
 * Persist last selected Telegram channel
 */
export async function saveActiveChannel(channel: any): Promise<void> {
  try {
    if (channel) {
      await AsyncStorage.setItem(ACTIVE_CHANNEL_KEY, JSON.stringify(channel));
    }
  } catch {}
}

/**
 * Retrieve last selected Telegram channel
 */
export async function getStoredActiveChannel(): Promise<any | null> {
  try {
    const raw = await AsyncStorage.getItem(ACTIVE_CHANNEL_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
