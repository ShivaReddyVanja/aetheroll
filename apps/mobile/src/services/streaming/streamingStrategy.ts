import AsyncStorage from '@react-native-async-storage/async-storage';
import { getMediaStreamUrl, getSessionToken } from '../api';
import { DirectTelegramStreamer } from './directTelegramStreamer';

export type StreamingEngineMode = 'cloudflare' | 'direct' | 'auto';

const STORAGE_KEY_STREAMING_ENGINE = 'aetheroll_streaming_engine_mode';
let currentStreamingMode: StreamingEngineMode = 'direct';
let isInitialized = false;
let initPromise: Promise<StreamingEngineMode> | null = null;

export interface VideoStreamSource {
  uri: string;
  headers?: Record<string, string>;
  isDirect?: boolean;
}

export class StreamingStrategyRouter {
  /**
   * Guarantees stored streaming engine mode is loaded before routing.
   * Single-flighted promise ensures all concurrent callers await the same initial load.
   */
  static async ensureInitialized(): Promise<StreamingEngineMode> {
    return this.init();
  }

  /**
   * Initialize configured streaming engine mode from persistent storage.
   */
  static async init(): Promise<StreamingEngineMode> {
    if (isInitialized) return currentStreamingMode;
    if (!initPromise) {
      initPromise = (async () => {
        try {
          const stored = await AsyncStorage.getItem(STORAGE_KEY_STREAMING_ENGINE);
          if (stored === 'cloudflare' || stored === 'direct' || stored === 'auto') {
            currentStreamingMode = stored;
          }
        } catch (e) {
          console.warn('[StreamingStrategy] Could not load stored streaming engine mode:', e);
        } finally {
          isInitialized = true;
        }
        return currentStreamingMode;
      })();
    }
    return initPromise;
  }

  static getEngineMode(): StreamingEngineMode {
    return currentStreamingMode;
  }

  static async setEngineMode(mode: StreamingEngineMode): Promise<void> {
    currentStreamingMode = mode;
    isInitialized = true;
    initPromise = Promise.resolve(mode);
    try {
      await AsyncStorage.setItem(STORAGE_KEY_STREAMING_ENGINE, mode);
      console.log(`[StreamingStrategy] ⚙️ Video streaming engine set to: "${mode}"`);
    } catch (e) {
      console.warn('[StreamingStrategy] Could not save streaming engine mode:', e);
    }
  }

  /**
   * Builds the Cloudflare Turbo Edge streaming source URL.
   */
  static getCloudflareStreamSource(itemId: string): VideoStreamSource {
    const token = getSessionToken();
    const headers: Record<string, string> = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
      headers['x-tg-session'] = token;
    }
    const streamUrl = getMediaStreamUrl(itemId);
    const authedStreamUrl = token ? `${streamUrl}&session_token=${encodeURIComponent(token)}` : streamUrl;

    return {
      uri: authedStreamUrl,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      isDirect: false,
    };
  }

  /**
   * Resolves the video streaming source synchronously (fallback or local uri).
   */
  static resolveVideoSource(item: { id: string; localUri?: string; telegram_message_id?: number }): VideoStreamSource {
    if (item.localUri) {
      return {
        uri: item.localUri,
        isDirect: true,
      };
    }

    return this.getCloudflareStreamSource(item.id);
  }

  /**
   * Resolves the video streaming source asynchronously with in-flight Direct MTProto localhost streaming and Auto fallback.
   */
  static async resolveVideoSourceAsync(
    item: any
  ): Promise<VideoStreamSource> {
    await this.ensureInitialized();

    // 1. If localUri already provided
    if (item.localUri) {
      console.log(`[StreamingEngine] 💾 Using LOCAL FILE URI: ${item.localUri}`);
      return { uri: item.localUri, isDirect: true };
    }

    // Normalize telegramMessageId / channelId / sizeBytes from item or local database
    let telegramMessageId: number | undefined = item.telegramMessageId ?? item.telegram_message_id;
    let channelId: string | undefined = item.channelId ?? item.channel_id;
    let sizeBytes: number | undefined = item.fileSizeBytes ?? item.size_bytes ?? item.file_size_bytes;
    let mimeType: string | undefined = item.mimeType ?? item.mime_type;

    if (!telegramMessageId && item.id) {
      try {
        const { database } = require('../../db');
        const record = await database.get('media_items').find(item.id);
        if (record) {
          telegramMessageId = record.telegramMessageId;
          channelId = channelId || record.channelId;
          sizeBytes = sizeBytes || record.fileSizeBytes;
          mimeType = mimeType || record.mimeType;
        }
      } catch {}
    }

    const normalizedItem = {
      id: item.id,
      telegramMessageId,
      telegram_message_id: telegramMessageId,
      channelId,
      size_bytes: sizeBytes,
      mime_type: mimeType,
    };

    // 2. Direct Telegram MTProto in-flight streaming
    if (currentStreamingMode === 'direct') {
      if (!telegramMessageId) {
        console.warn(`[StreamingEngine] ⚠️ [DIRECT MODE] Media #${item.id} has no Telegram message ID — falling back to Cloudflare Edge`);
        return this.getCloudflareStreamSource(item.id);
      }
      try {
        console.log(`[StreamingEngine] 🛡️ [DIRECT MODE] Resolving Direct Telegram MTProto stream for media #${item.id} (msg #${telegramMessageId})...`);
        const directInfo = await DirectTelegramStreamer.prepareDirectStream(normalizedItem);
        console.log(`[StreamingEngine] 🛡️ [DIRECT MODE] ✅ Playing via Direct MTProto Localhost: ${directInfo.streamUrl}`);
        return {
          uri: directInfo.streamUrl,
          isDirect: true,
        };
      } catch (err) {
        console.warn('[StreamingEngine] ⚠️ [DIRECT MODE] Direct MTProto stream preparation failed:', err);
        throw err;
      }
    }

    // 3. Auto Hybrid mode (Try direct MTProto in-flight stream with Cloudflare fallback)
    if (currentStreamingMode === 'auto' && telegramMessageId) {
      try {
        console.log(`[StreamingEngine] 🔀 [AUTO MODE] Attempting Direct Telegram MTProto stream for media #${item.id} (msg #${telegramMessageId})...`);
        const directInfo = await DirectTelegramStreamer.prepareDirectStream(normalizedItem);
        console.log(`[StreamingEngine] 🔀 [AUTO MODE] ✅ Selected DIRECT Telegram MTProto Localhost: ${directInfo.streamUrl}`);
        return {
          uri: directInfo.streamUrl,
          isDirect: true,
        };
      } catch {
        console.log(`[StreamingEngine] 🔀 [AUTO MODE] ⚡ Fallback: switching to Cloudflare Turbo Edge stream for media #${item.id}`);
        const cfSource = this.getCloudflareStreamSource(item.id);
        console.log(`[StreamingEngine] ⚡ [CLOUDFLARE EDGE] Stream URL: ${cfSource.uri}`);
        return cfSource;
      }
    }

    // 4. Cloudflare Turbo Edge mode (Default)
    console.log(`[StreamingEngine] ⚡ [CLOUDFLARE MODE] Streaming media #${item.id} via Cloudflare Turbo Edge`);
    const cfSource = this.getCloudflareStreamSource(item.id);
    console.log(`[StreamingEngine] ⚡ [CLOUDFLARE MODE] Stream URL: ${cfSource.uri}`);
    return cfSource;
  }
}

// Eagerly initiate async storage load on module evaluation
StreamingStrategyRouter.init().catch(() => {});
