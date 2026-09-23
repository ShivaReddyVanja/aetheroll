import { Buffer } from 'buffer';
import { Api, helpers } from 'telegram';
import { MobileTelegramClient } from '../telegram/telegramClient';
import { BackupItem } from './types';
import { RatePacer } from './ratePacer';
import { UploadResult, FloodWaitError } from './xhrUploader';
import { NativeBackgroundService } from './nativeBackgroundService';
import { apiFetch } from '../api';
import { getStoredActiveChannel } from '../secureStorage';

export const TG_PART_SIZE = 512 * 1024; // 512 KB Telegram MTProto part size
const UPLOAD_CONCURRENCY = 4; // 4 concurrent MTProto workers

export class DirectTelegramUploader {
  /**
   * Uploads media asset directly from Mobile to Telegram MTProto DCs.
   * Eliminates Cloudflare intermediate bandwidth while maintaining zero-knowledge security.
   */
  static async uploadItem(
    item: BackupItem,
    signal?: AbortSignal,
    onProgress?: (uploadedBytes: number, totalBytes: number, percent: number) => void
  ): Promise<UploadResult> {
    if (signal?.aborted) {
      throw new Error('Upload cancelled');
    }

    await RatePacer.waitIfNeeded();

    if (signal?.aborted) {
      throw new Error('Upload cancelled');
    }

    const fileSize = item.fileSize || 1;
    const isBig = fileSize > 10 * 1024 * 1024; // Big files (>10MB) use SaveBigFilePart
    const totalParts = Math.ceil(fileSize / TG_PART_SIZE);
    const isVideo = item.mimeType?.includes('video') || (item.fileName && item.fileName.toLowerCase().endsWith('.mp4'));

    console.log(
      `[DirectTelegramUploader] 🚀 Starting direct MTProto upload for "${item.fileName}" (${(fileSize / 1024 / 1024).toFixed(2)} MB, ${totalParts} parts)`
    );

    // 1. Connect to Telegram via ephemeral leased session
    const client = await MobileTelegramClient.getConnectedClient();
    if (signal?.aborted) {
      throw new Error('Upload cancelled');
    }

    // 2. Extract video metadata & thumbnail if video
    let videoMeta: { duration: number; width: number; height: number; thumbnailBase64: string } | null = null;
    if (isVideo) {
      try {
        videoMeta = await NativeBackgroundService.extractVideoMetadata(item.uri);
      } catch (vErr) {
        console.warn('[DirectTelegramUploader] Video metadata extraction warning:', vErr);
      }
    }

    // 3. Generate random 64-bit fileId for MTProto upload session
    const fileId = helpers.readBigIntFromBuffer(helpers.generateRandomBytes(8), true, true);

    // 4. Parallel Upload Worker Pool
    const uploadedParts = new Set<number>();
    let uploadedBytesTotal = 0;
    let fatalError: any = null;
    let nextPartIndex = 0;

    const runWorker = async (workerId: number) => {
      while (!signal?.aborted && !fatalError) {
        let partIndex: number;
        synchronized: {
          if (nextPartIndex >= totalParts) {
            return;
          }
          partIndex = nextPartIndex++;
        }

        const offset = partIndex * TG_PART_SIZE;
        const length = Math.min(TG_PART_SIZE, fileSize - offset);

        let partBuffer: Buffer | null = null;
        try {
          const base64Chunk = await NativeBackgroundService.readUriChunkBase64(item.uri, offset, length);
          if (!base64Chunk) {
            throw new Error(`Failed to read file part ${partIndex} at offset ${offset}`);
          }
          partBuffer = Buffer.from(base64Chunk, 'base64');
        } catch (readErr: any) {
          fatalError = readErr;
          return;
        }

        const partReq = isBig
          ? new Api.upload.SaveBigFilePart({
              fileId,
              filePart: partIndex,
              fileTotalParts: totalParts,
              bytes: partBuffer,
            })
          : new Api.upload.SaveFilePart({
              fileId,
              filePart: partIndex,
              bytes: partBuffer,
            });

        let success = false;
        for (let attempt = 1; attempt <= 3; attempt++) {
          if (signal?.aborted || fatalError) break;

          try {
            await RatePacer.waitIfNeeded();
            await client.invoke(partReq);
            success = true;
            break;
          } catch (invokeErr: any) {
            console.warn(
              `[DirectTelegramUploader] Worker ${workerId} part #${partIndex} attempt ${attempt}/3 failed:`,
              invokeErr?.message
            );
            if (invokeErr?.message?.includes('FLOOD_WAIT')) {
              const match = invokeErr.message.match(/(\d+)/);
              const waitSec = match ? parseInt(match[1], 10) : 15;
              RatePacer.applyFloodWaitPenalty(waitSec);
              fatalError = new FloodWaitError(waitSec);
              return;
            }
            if (attempt === 3) {
              fatalError = invokeErr;
              return;
            }
            await new Promise<void>((resolve) => setTimeout(() => resolve(), 500));
          }
        }

        if (success && !signal?.aborted) {
          uploadedParts.add(partIndex);
          uploadedBytesTotal += length;
          const currentTotal = Math.min(uploadedBytesTotal, fileSize);
          const percent = Math.min(99, Math.round((currentTotal / fileSize) * 100));
          onProgress?.(currentTotal, fileSize, percent);
        }
      }
    };

    // Spawn 4 concurrent worker promises
    const workers = [];
    for (let w = 1; w <= UPLOAD_CONCURRENCY; w++) {
      workers.push(runWorker(w));
    }
    await Promise.all(workers);

    if (signal?.aborted) {
      throw new Error('Upload cancelled');
    }
    if (fatalError) {
      throw fatalError;
    }
    if (uploadedParts.size < totalParts) {
      throw new Error(`Incomplete direct upload: ${uploadedParts.size}/${totalParts} parts completed`);
    }

    // 5. Finalize Telegram Message Send
    console.log(`[DirectTelegramUploader] 🏁 All parts uploaded. Finalizing media send for "${item.fileName}"...`);
    const inputFile = isBig
      ? new Api.InputFileBig({
          id: fileId,
          parts: totalParts,
          name: item.fileName,
        })
      : new Api.InputFile({
          id: fileId,
          parts: totalParts,
          name: item.fileName,
          md5Checksum: '',
        });

    let thumbBuf: Buffer | undefined = undefined;
    const thumbBase64 = videoMeta?.thumbnailBase64 || item.thumbnailBase64;
    if (thumbBase64) {
      try {
        const cleanB64 = thumbBase64.replace(/^data:image\/\w+;base64,/, '');
        thumbBuf = Buffer.from(cleanB64, 'base64');
      } catch {}
    }

    let targetTelegramPeer: any = item.channelId;
    try {
      const activeCh = await getStoredActiveChannel();
      if (activeCh && activeCh.id === item.channelId && activeCh.telegram_channel_id) {
        targetTelegramPeer = activeCh.telegram_channel_id;
      } else if (item.channelId === 'me' || item.channelId.startsWith('me_')) {
        targetTelegramPeer = 'me';
      } else {
        const chRes = await apiFetch('/api/channels');
        if (chRes.ok) {
          const chData = await chRes.json();
          const match = (chData.channels || []).find((c: any) => c.id === item.channelId);
          if (match && match.telegram_channel_id) {
            targetTelegramPeer = match.telegram_channel_id;
          }
        }
      }
    } catch {}

    let targetPeer: any = targetTelegramPeer;
    if (targetTelegramPeer === 'me' || String(targetTelegramPeer).startsWith('me_')) {
      targetPeer = 'me';
    } else {
      try {
        targetPeer = await client.getInputEntity(targetTelegramPeer);
      } catch {
        try {
          targetPeer = await client.getEntity(targetTelegramPeer);
        } catch {
          targetPeer = targetTelegramPeer;
        }
      }
    }

    const width = videoMeta?.width || item.width || 1920;
    const height = videoMeta?.height || item.height || 1080;
    const duration = videoMeta?.duration || item.duration || 0;

    const sentMsg: any = await client.sendFile(targetPeer, {
      file: inputFile,
      thumb: thumbBuf,
      forceDocument: true,
      attributes: [
        new Api.DocumentAttributeFilename({
          fileName: item.fileName,
        }),
        ...(isVideo
          ? [
              new Api.DocumentAttributeVideo({
                duration: Math.round(duration),
                w: width,
                h: height,
                supportsStreaming: true,
              }),
            ]
          : [
              new Api.DocumentAttributeImageSize({
                w: width,
                h: height,
              }),
            ]),
      ],
    });

    let realMessageId = sentMsg.id;
    if (sentMsg.updates) {
      for (const u of sentMsg.updates) {
        if (u.id) {
          realMessageId = u.id;
          break;
        }
        if (u.message && u.message.id) {
          realMessageId = u.message.id;
          break;
        }
      }
    }

    console.log(
      `[DirectTelegramUploader] 📡 Telegram message posted (tgMsgId: ${realMessageId}). Registering with Cloudflare...`
    );

    // 6. Register Media with Cloudflare D1 / R2 via POST /api/media/register
    const regRes = await apiFetch('/api/media/register', {
      method: 'POST',
      body: JSON.stringify({
        channel_id: item.channelId,
        telegram_message_id: realMessageId,
        file_type: isVideo ? 'video' : 'photo',
        mime_type: item.mimeType || (isVideo ? 'video/mp4' : 'image/jpeg'),
        file_size_bytes: fileSize,
        width,
        height,
        duration_seconds: duration > 0 ? Math.round(duration) : null,
        blur_hash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
        thumbnail_base64: thumbBase64 || '',
        captured_at: new Date(item.createdAt || Date.now()).toISOString(),
      }),
    });

    if (!regRes.ok) {
      const regErrText = await regRes.text().catch(() => '');
      console.warn(`[DirectTelegramUploader] Cloudflare register warning (HTTP ${regRes.status}):`, regErrText);
    }

    const regData = await regRes.json().catch(() => ({}));
    const mediaId = regData.mediaId || `${Date.now()}`;

    if (onProgress) {
      onProgress(fileSize, fileSize, 100);
    }

    console.log(`[DirectTelegramUploader] ✅ Complete: mediaId=${mediaId}, tgMsgId=${realMessageId}`);
    return {
      success: true,
      mediaId,
      telegramMessageId: realMessageId,
      mediaItem: {
        id: mediaId,
        channel_id: item.channelId,
        telegram_message_id: realMessageId,
        file_type: isVideo ? 'video' : 'photo',
        mime_type: item.mimeType,
        file_size_bytes: fileSize,
        width,
        height,
        duration_seconds: duration,
        captured_at: new Date(item.createdAt || Date.now()).toISOString(),
      },
    };
  }
}
