import { NativeModules, NativeEventEmitter, Platform } from 'react-native';

const { LocalStreamServerModule } = NativeModules;

export interface ServerStatus {
  running: boolean;
  port: number;
  serverUrl: string;
}

export interface StreamChunkRequestEvent {
  requestId: string;
  mediaId: string;
  start: number;
  end: number;
  chunkSize: number;
}

type ChunkFetcher = (
  mediaId: string,
  start: number,
  end: number,
  chunkSize: number
) => Promise<string>; // Returns Base64-encoded chunk string

export class NativeStreamServer {
  private static emitter: NativeEventEmitter | null = null;
  private static isInitialized = false;
  private static chunkFetcher: ChunkFetcher | null = null;
  private static serverUrl: string | null = null;

  /**
   * Initializes the native stream server and subscribes to chunk request events.
   */
  static async start(fetcher: ChunkFetcher, preferredPort = 8998): Promise<string> {
    this.chunkFetcher = fetcher;

    if (Platform.OS !== 'android') {
      return '';
    }

    if (!LocalStreamServerModule) {
      console.warn('[NativeStreamServer] LocalStreamServerModule not linked');
      return '';
    }

    if (!this.isInitialized) {
      this.emitter = new NativeEventEmitter(LocalStreamServerModule);
      this.emitter.addListener(
        'onStreamChunkRequested',
        async (event: StreamChunkRequestEvent) => {
          await this.handleChunkRequest(event);
        }
      );
      this.isInitialized = true;
    }

    try {
      const res: ServerStatus = await LocalStreamServerModule.startServer(preferredPort);
      this.serverUrl = res.serverUrl;
      console.log(`[NativeStreamServer] 🚀 Local MTProto stream server active at: ${this.serverUrl}`);
      return res.serverUrl;
    } catch (e) {
      console.warn('[NativeStreamServer] Failed to start local stream server:', e);
      return '';
    }
  }

  static async getServerUrl(): Promise<string> {
    if (this.serverUrl) return this.serverUrl;
    if (Platform.OS !== 'android' || !LocalStreamServerModule) return '';
    try {
      const res: ServerStatus = await LocalStreamServerModule.getServerUrl();
      this.serverUrl = res.serverUrl;
      return res.serverUrl;
    } catch {
      return '';
    }
  }

  static async registerMedia(mediaId: string, totalSizeBytes: number, mimeType = 'video/mp4'): Promise<void> {
    if (Platform.OS !== 'android' || !LocalStreamServerModule) return;
    try {
      await LocalStreamServerModule.registerMedia(mediaId, totalSizeBytes, mimeType);
    } catch (e) {
      console.warn(`[NativeStreamServer] Failed to register media ${mediaId}:`, e);
    }
  }

  static async clearStreamCache(): Promise<boolean> {
    if (Platform.OS !== 'android' || !LocalStreamServerModule) return false;
    try {
      return await LocalStreamServerModule.clearStreamCache();
    } catch {
      return false;
    }
  }

  static async getStreamCacheSizeBytes(): Promise<number> {
    if (Platform.OS !== 'android' || !LocalStreamServerModule) return 0;
    try {
      return await LocalStreamServerModule.getStreamCacheSizeBytes();
    } catch {
      return 0;
    }
  }

  static async stop(): Promise<void> {
    if (Platform.OS !== 'android' || !LocalStreamServerModule) return;
    try {
      await LocalStreamServerModule.stopServer();
      this.serverUrl = null;
    } catch {}
  }

  private static async handleChunkRequest(event: StreamChunkRequestEvent): Promise<void> {
    const { requestId, mediaId, start, end, chunkSize } = event;
    if (!this.chunkFetcher) {
      LocalStreamServerModule?.respondStreamError(requestId, 'No chunk fetcher registered');
      return;
    }

    try {
      const base64Chunk = await this.chunkFetcher(mediaId, start, end, chunkSize);
      await LocalStreamServerModule?.respondStreamChunk(requestId, base64Chunk);
    } catch (err: any) {
      console.warn(`[NativeStreamServer] Error serving chunk for ${mediaId} [${start}-${end}]:`, err?.message || err);
      LocalStreamServerModule?.respondStreamError(requestId, err?.message || 'Chunk fetch failed');
    }
  }
}
