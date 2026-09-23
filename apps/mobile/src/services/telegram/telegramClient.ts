import { Platform } from 'react-native';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { apiFetch, getSessionToken } from '../api';

interface ClientSessionCredentials {
  sessionString: string;
  apiId?: number | string;
  apiHash?: string;
}

class MobileTelegramClientManager {
  private client: TelegramClient | null = null;
  private currentSessionString: string | null = null;
  private connectingPromise: Promise<TelegramClient> | null = null;

  /**
   * Fetches the ephemeral zero-knowledge decrypted session from Cloudflare API
   * via GET /api/auth/client-session using the active sessionId.clientSecret token.
   */
  public async fetchClientSession(): Promise<ClientSessionCredentials> {
    const token = getSessionToken();
    if (!token) {
      throw new Error('No active auth token found');
    }

    console.log('[MobileTelegramClient] 🔑 Fetching ephemeral client session lease...');
    const res = await apiFetch('/api/auth/client-session');
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Failed to fetch client session: HTTP ${res.status} - ${errText}`);
    }

    const data = await res.json();
    if (!data.sessionString) {
      throw new Error('Server returned invalid session credentials (missing sessionString)');
    }

    return {
      sessionString: data.sessionString,
      apiId: data.apiId,
      apiHash: data.apiHash,
    };
  }

  /**
   * Obtains a connected TelegramClient singleton.
   * If not connected or credentials rotated, establishes an MTProto connection.
   */
  public async getConnectedClient(): Promise<TelegramClient> {
    if (this.client && this.client.connected) {
      return this.client;
    }

    if (this.connectingPromise) {
      return this.connectingPromise;
    }

    this.connectingPromise = (async () => {
      try {
        const credentials = await this.fetchClientSession();
        const apiId = Number(credentials.apiId) || 2040;
        const apiHash = credentials.apiHash || 'b18441a1ff607e10a989891a5462e627';

        if (this.client && this.currentSessionString !== credentials.sessionString) {
          try {
            await this.client.disconnect();
          } catch {}
          this.client = null;
        }

        if (!this.client) {
          const stringSession = new StringSession(credentials.sessionString);
          this.client = new TelegramClient(stringSession, apiId, apiHash, {
            connectionRetries: 5,
            useWSS: true,
            autoReconnect: true,
            floodSleepThreshold: 60,
            deviceModel: Platform.OS === 'android' ? 'Android Device' : 'iOS Device',
            systemVersion: String(Platform.Version || '14.0'),
            appVersion: '1.0.0',
          });
          this.currentSessionString = credentials.sessionString;
        }

        if (!this.client.connected) {
          console.log('[MobileTelegramClient] 🚀 Connecting to Telegram MTProto DCs...');
          await this.client.connect();
          console.log('[MobileTelegramClient] ✅ Successfully connected to Telegram MTProto');
        }

        return this.client;
      } finally {
        this.connectingPromise = null;
      }
    })();

    return this.connectingPromise;
  }

  /**
   * Safely disconnects the client and clears cached session from RAM.
   */
  public async disconnect(): Promise<void> {
    if (this.client) {
      try {
        await this.client.disconnect();
      } catch {}
      this.client = null;
    }
    this.currentSessionString = null;
    this.connectingPromise = null;
  }
}

export const MobileTelegramClient = new MobileTelegramClientManager();
