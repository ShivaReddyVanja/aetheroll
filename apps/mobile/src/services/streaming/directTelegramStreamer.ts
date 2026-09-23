import { Buffer } from 'buffer';
import { Api, helpers } from 'telegram';
import { MobileTelegramClient } from '../telegram/telegramClient';
import { NativeStreamServer } from './nativeStreamServer';
import { getStoredActiveChannel } from '../secureStorage';

export interface DirectStreamSourceInfo {
  streamUrl: string;
  totalBytes: number;
  mimeType: string;
}

interface MediaLocationEntry {
  fileLocation: any;
  dcId: number;
  totalSize: number;
  mimeType: string;
  expires: number;
}

export class DirectTelegramStreamer {
  private static locationCache = new Map<string, MediaLocationEntry>();
  private static activeMediaMap = new Map<string, any>();
  private static isServerStarted = false;

  /**
   * Initializes the native loopback HTTP stream server.
   */
  static async initServer(): Promise<string> {
    if (this.isServerStarted) {
      return await NativeStreamServer.getServerUrl();
    }

    const serverUrl = await NativeStreamServer.start(async (mediaId, start, end, chunkSize) => {
      return await this.fetchStreamChunk(mediaId, start, end, chunkSize);
    });

    this.isServerStarted = !!serverUrl;
    return serverUrl;
  }

  /**
   * Resolves the channel peer entity in Telegram MTProto.
   */
  private static async resolveChannelPeer(client: any, channelIdStr?: string): Promise<any> {
    const activeChannel = await getStoredActiveChannel();
    const resolvedChannelId = channelIdStr || activeChannel?.telegram_channel_id;

    if (!resolvedChannelId || resolvedChannelId === 'me' || resolvedChannelId === 'saved_messages') {
      return 'me';
    }

    const cleanId = String(resolvedChannelId).replace(/^-100/, '').replace(/^-/, '');
    const isSavedMessages =
      cleanId === 'me' ||
      cleanId === '0' ||
      activeChannel?.name?.toLowerCase().includes('saved messages');

    if (isSavedMessages) {
      return 'me';
    }

    try {
      return await client.getInputEntity(resolvedChannelId);
    } catch {
      try {
        const dialogs = await client.getDialogs({ limit: 100 });
        for (const dialog of dialogs) {
          const entity = dialog.entity;
          if (entity && String(entity.id) === cleanId) {
            return entity;
          }
        }
      } catch {}
      return resolvedChannelId;
    }
  }

  /**
   * Resolves file location and metadata for a Telegram message media.
   */
  private static async resolveFileLocation(
    client: any,
    item: { id: string; telegram_message_id?: number; telegramMessageId?: number; channelId?: string; size_bytes?: number; fileSizeBytes?: number; mime_type?: string; mimeType?: string }
  ): Promise<MediaLocationEntry> {
    const now = Date.now();
    const cached = this.locationCache.get(item.id);
    if (cached && cached.expires > now) {
      return cached;
    }

    const msgId = item.telegram_message_id || item.telegramMessageId;
    if (!msgId) {
      throw new Error(`Media item ${item.id} has no telegram_message_id`);
    }

    const peer = await this.resolveChannelPeer(client, item.channelId);
    const messages = await client.getMessages(peer, { ids: [msgId] });
    const msg = messages?.[0];

    if (!msg || !msg.media) {
      throw new Error(`Message #${msgId} or its media was not found`);
    }

    const doc = msg.media.document || (msg.media.className === 'MessageMediaDocument' ? msg.media.document : null);
    const photo = msg.media.photo || (msg.media.className === 'MessageMediaPhoto' ? msg.media.photo : null);

    let fileLocation: any = null;
    let dcId = 2;
    let totalSize = item.size_bytes || item.fileSizeBytes || 0;
    let mimeType = item.mime_type || item.mimeType || 'video/mp4';

    if (doc && doc.id && doc.accessHash && doc.fileReference) {
      fileLocation = new Api.InputDocumentFileLocation({
        id: doc.id,
        accessHash: doc.accessHash,
        fileReference: doc.fileReference,
        thumbSize: '',
      });
      dcId = doc.dcId || 2;
      totalSize = totalSize || Number(doc.size) || 0;
      mimeType = doc.mimeType || mimeType;
    } else if (photo && photo.id && photo.accessHash && photo.fileReference) {
      const sizes = photo.sizes || [];
      const largest = sizes[sizes.length - 1];
      fileLocation = new Api.InputPhotoFileLocation({
        id: photo.id,
        accessHash: photo.accessHash,
        fileReference: photo.fileReference,
        thumbSize: largest?.type || 'x',
      });
      dcId = photo.dcId || 2;
    }

    if (!fileLocation) {
      throw new Error(`Could not construct MTProto file location for item ${item.id}`);
    }

    const entry: MediaLocationEntry = {
      fileLocation,
      dcId,
      totalSize,
      mimeType,
      expires: now + 3600 * 1000, // 1 hour TTL
    };

    this.locationCache.set(item.id, entry);
    return entry;
  }

  /**
   * Prepares a video item for instant localhost HTTP streaming.
   * Registers media metadata with the native stream server and returns the local streaming URL.
   */
  static async prepareDirectStream(
    item: { id: string; telegram_message_id?: number; channelId?: string; size_bytes?: number; mime_type?: string }
  ): Promise<DirectStreamSourceInfo> {
    // 1. Ensure local HTTP server is running
    const serverUrl = await this.initServer();
    if (!serverUrl) {
      throw new Error('Local stream server failed to start');
    }

    // 2. Store active item reference
    this.activeMediaMap.set(item.id, item);

    // 3. Pre-resolve file location & total size
    const client = await MobileTelegramClient.getConnectedClient();
    const meta = await this.resolveFileLocation(client, item);

    // 4. Register with native server for HTTP headers
    await NativeStreamServer.registerMedia(item.id, meta.totalSize, meta.mimeType);

    const streamUrl = `${serverUrl}/stream/${encodeURIComponent(item.id)}`;
    console.log(`[DirectTelegramStreamer] ⚡ Ready for in-flight progressive streaming at: ${streamUrl}`);

    return {
      streamUrl,
      totalBytes: meta.totalSize,
      mimeType: meta.mimeType,
    };
  }

  /**
   * Fetches an aligned byte slice from Telegram Data Centers on-demand via MTProto.
   */
  static async fetchStreamChunk(
    mediaId: string,
    start: number,
    end: number,
    _chunkSize: number
  ): Promise<string> {
    const item = this.activeMediaMap.get(mediaId) || { id: mediaId, telegram_message_id: Number(mediaId) };
    const client = await MobileTelegramClient.getConnectedClient();
    const meta = await this.resolveFileLocation(client, item);

    const TG_CHUNK_SIZE = 512 * 1024; // 524,288 bytes (Telegram standard chunk limit)
    const startChunkIdx = Math.floor(start / TG_CHUNK_SIZE);
    const endChunkIdx = Math.floor(end / TG_CHUNK_SIZE);
    const sender = await client.getSender(meta.dcId);

    const chunkBuffers: Buffer[] = [];
    for (let chunkIdx = startChunkIdx; chunkIdx <= endChunkIdx; chunkIdx++) {
      const chunkOffset = chunkIdx * TG_CHUNK_SIZE; // Guaranteed to be a multiple of 512KB (offset % limit == 0)
      const result: any = await client.invokeWithSender(
        new Api.upload.GetFile({
          location: meta.fileLocation,
          offset: helpers.returnBigInt(chunkOffset),
          limit: TG_CHUNK_SIZE,
          precise: true,
        }),
        sender
      );

      if (result instanceof Api.upload.FileCdnRedirect) {
        throw new Error('CDN redirects not supported for direct MTProto stream');
      }

      const rawBytes = result.bytes;
      if (!rawBytes) {
        throw new Error('Empty chunk returned from Telegram MTProto');
      }
      chunkBuffers.push(Buffer.from(rawBytes));
    }

    const fullBuffer = Buffer.concat(chunkBuffers);
    const firstChunkStartOffset = startChunkIdx * TG_CHUNK_SIZE;
    const sliceStart = start - firstChunkStartOffset;
    const sliceEnd = Math.min(fullBuffer.length, sliceStart + (end - start + 1));
    const targetSlice = fullBuffer.subarray(sliceStart, sliceEnd);

    return Buffer.from(targetSlice).toString('base64');
  }
}
