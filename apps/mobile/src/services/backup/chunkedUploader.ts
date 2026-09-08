import { getApiBaseUrl, getSessionToken } from '../api';
import { BackupItem } from './types';
import { RatePacer } from './ratePacer';
import { FloodWaitError, UploadResult } from './xhrUploader';
import { NativeBackgroundService } from './nativeBackgroundService';

export const CHUNK_SIZE_BYTES = 4 * 1024 * 1024; // 4 MB chunk parts for fast mobile ingestion

interface UploadChunkOptions {
  url: string;
  headers: Record<string, string>;
  uploadId: string;
  chunkIndex: number;
  totalChunks: number;
  offset: number;
  tempChunkUri: string;
  length: number;
  fileSize: number;
  signal?: AbortSignal;
  onProgress?: (uploadedBytes: number, totalBytes: number, percent: number) => void;
}

/**
 * Upload an individual 4 MB chunk using XMLHttpRequest.
 * Hooks into xhr.upload.onprogress to deliver continuous byte-level progress events,
 * keeping the speed aggregator and ETA steady and accurate without chunk-boundary jumps.
 */
function uploadChunkXhr(options: UploadChunkOptions): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (options.signal?.aborted) {
      return reject(new Error('Upload cancelled'));
    }

    const xhr = new XMLHttpRequest();
    let isSettled = false;

    const safeResolve = () => {
      if (!isSettled) {
        isSettled = true;
        resolve();
      }
    };

    const safeReject = (err: any) => {
      if (!isSettled) {
        isSettled = true;
        reject(err);
      }
    };

    const onAbort = () => {
      try {
        xhr.abort();
      } catch {}
      safeReject(new Error('Upload cancelled'));
    };

    if (options.signal) {
      options.signal.addEventListener('abort', onAbort, { once: true });
    }

    // Stream real-time byte progress for smooth UI updates & steady ETA
    if (xhr.upload && options.onProgress) {
      xhr.upload.onprogress = (event: ProgressEvent) => {
        if (options.signal?.aborted) return;
        const chunkLoaded = event.lengthComputable
          ? Math.min(event.loaded, options.length)
          : Math.min(event.loaded || 0, options.length);
        const currentBytes = options.offset + chunkLoaded;
        const percent = Math.min(99, Math.round((currentBytes / options.fileSize) * 100));
        options.onProgress!(currentBytes, options.fileSize, percent);
      };
    }

    xhr.onload = () => {
      if (options.signal) {
        options.signal.removeEventListener('abort', onAbort);
      }

      const status = xhr.status;
      const responseText = xhr.responseText || '';

      if (status === 429) {
        let waitSeconds = 15;
        const match = responseText.match(/(\d+)/);
        if (match && match[1]) {
          waitSeconds = parseInt(match[1], 10);
        }
        console.warn(
          `[ChunkedUploader] ⚠️ 429 FloodWait on chunk ${options.chunkIndex + 1}/${options.totalChunks}: wait ${waitSeconds}s`
        );
        RatePacer.applyFloodWaitPenalty(waitSeconds);
        return safeReject(new FloodWaitError(waitSeconds));
      }

      if (status >= 200 && status < 300) {
        // Complete this chunk's byte contribution
        const currentBytes = options.offset + options.length;
        const percent = Math.min(99, Math.round((currentBytes / options.fileSize) * 100));
        options.onProgress?.(currentBytes, options.fileSize, percent);
        return safeResolve();
      }

      let msg = `Chunk ${options.chunkIndex + 1}/${options.totalChunks} failed with HTTP ${status}`;
      try {
        const errJson = JSON.parse(responseText);
        if (errJson?.error) msg = errJson.error;
      } catch {}
      console.error(
        `[ChunkedUploader] ❌ Chunk ${options.chunkIndex + 1}/${options.totalChunks} failed: HTTP ${status} - ${msg}`
      );
      safeReject(new Error(msg));
    };

    xhr.onerror = (e) => {
      if (options.signal) {
        options.signal.removeEventListener('abort', onAbort);
      }
      console.error(
        `[ChunkedUploader] ❌ Network error during chunk ${options.chunkIndex + 1}/${options.totalChunks}:`,
        e
      );
      safeReject(new Error(`Network error during chunk ${options.chunkIndex + 1} upload`));
    };

    xhr.ontimeout = () => {
      if (options.signal) {
        options.signal.removeEventListener('abort', onAbort);
      }
      console.error(
        `[ChunkedUploader] ⏰ Chunk ${options.chunkIndex + 1}/${options.totalChunks} timed out after ${xhr.timeout}ms`
      );
      safeReject(new Error(`Chunk ${options.chunkIndex + 1} upload timed out`));
    };

    // 90s timeout per 4 MB chunk (plenty of time even on slow mobile data)
    xhr.timeout = 90000;

    try {
      xhr.open('POST', options.url, true);

      for (const [key, val] of Object.entries(options.headers)) {
        xhr.setRequestHeader(key, val);
      }

      const formData = new FormData();
      formData.append('upload_id', options.uploadId);
      formData.append('chunk_index', String(options.chunkIndex));
      formData.append('offset', String(options.offset));
      formData.append('chunk', {
        uri: options.tempChunkUri,
        name: `part_${options.chunkIndex}.bin`,
        type: 'application/octet-stream',
      } as any);

      xhr.send(formData);
    } catch (err: any) {
      console.error(
        `[ChunkedUploader] 💥 Exception during send for chunk ${options.chunkIndex + 1}:`,
        err
      );
      safeReject(err);
    }
  });
}

export class ChunkedUploader {
  /**
   * Uploads large media files (up to 2 GB) in 4 MB chunks without exceeding server memory limits.
   * Utilizes native file slicing to stream byte chunks without React Native JS memory bloat.
   * Pipelined: While chunk N is uploading over network, chunk N+1 is pre-sliced on disk.
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

    const baseUrl = getApiBaseUrl();
    const token = getSessionToken();
    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
      headers['x-tg-session'] = token;
    }

    const fileSize = item.fileSize || 1;
    let chunkSize = CHUNK_SIZE_BYTES;
    let totalChunks = Math.ceil(fileSize / chunkSize);

    console.log(
      `[ChunkedUploader] 🚀 Starting chunked upload for "${item.fileName}" (${(fileSize / 1024 / 1024).toFixed(2)} MB, ~${totalChunks} chunks of ${(chunkSize / 1024 / 1024).toFixed(1)}MB)`
    );
    console.log(`[ChunkedUploader] 📍 Base URL: ${baseUrl} | Channel ID: ${item.channelId}`);
    console.log(`[ChunkedUploader] 🔑 Auth Token Present: ${Boolean(token)}`);

    // 1. Initialize Upload Session
    const initUrl = `${baseUrl}/api/media/upload/init`;
    let uploadId: string;
    try {
      console.log(`[ChunkedUploader] 📡 Calling /init for "${item.fileName}"...`);
      const initRes = await fetch(initUrl, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          channel_id: item.channelId,
          file_name: item.fileName,
          file_size: fileSize,
          total_chunks: totalChunks,
          mime_type: item.mimeType,
        }),
        signal,
      });

      if (!initRes.ok) {
        const errText = await initRes.text().catch(() => '');
        let errMsg = `Upload init failed with HTTP ${initRes.status}`;
        try {
          const errJson = JSON.parse(errText);
          if (errJson?.error) errMsg = errJson.error;
        } catch {}
        console.error(`[ChunkedUploader] ❌ Init failed for "${item.fileName}": HTTP ${initRes.status} - ${errMsg}`);
        throw new Error(errMsg);
      }

      const initData = await initRes.json();
      uploadId = initData.upload_id;
      if (!uploadId) {
        throw new Error('Upload init did not return an upload_id');
      }
      if (initData.chunk_size && typeof initData.chunk_size === 'number') {
        chunkSize = initData.chunk_size;
        totalChunks = Math.ceil(fileSize / chunkSize);
      }
      console.log(
        `[ChunkedUploader] 🆔 Session created: uploadId=${uploadId}, totalChunks=${totalChunks} (${(chunkSize / 1024 / 1024).toFixed(1)}MB chunks)`
      );
    } catch (err: any) {
      console.error(`[ChunkedUploader] ❌ Init exception for "${item.fileName}":`, err?.message || err);
      if (signal?.aborted) throw new Error('Upload cancelled');
      throw err;
    }

    // 2. Upload Each Chunk Sequentially with Pipelined Background Pre-slicing
    const chunkUrl = `${baseUrl}/api/media/upload/chunk`;
    const activeTempFiles = new Set<string>();

    const sliceChunk = async (cIndex: number): Promise<string> => {
      const cOffset = cIndex * chunkSize;
      const cLength = Math.min(chunkSize, fileSize - cOffset);
      const uri = await NativeBackgroundService.createTempChunkFile(item.uri, cOffset, cLength);
      activeTempFiles.add(uri);
      return uri;
    };

    const deleteTempFileSafe = async (uri: string | null) => {
      if (!uri) return;
      activeTempFiles.delete(uri);
      await NativeBackgroundService.deleteTempFile(uri).catch(() => {});
    };

    let nextChunkPromise: Promise<string> | null = null;

    try {
      // Pre-slice chunk 0 immediately
      let currentChunkPromise = sliceChunk(0);

      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        if (signal?.aborted) {
          throw new Error('Upload cancelled');
        }

        const offset = chunkIndex * chunkSize;
        const length = Math.min(chunkSize, fileSize - offset);

        // Await current chunk (if chunk 0, it began pre-slicing earlier; if chunk > 0, it was pre-sliced concurrently during network transfer)
        const tempChunkUri = await currentChunkPromise;

        // Concurrently pre-slice next chunk on disk while this chunk uploads over the network
        const nextChunkIndex = chunkIndex + 1;
        if (nextChunkIndex < totalChunks && !signal?.aborted) {
          nextChunkPromise = sliceChunk(nextChunkIndex);
        } else {
          nextChunkPromise = null;
        }

        let chunkSuccess = false;
        let lastChunkErr: any = null;

        try {
          for (let attempt = 1; attempt <= 3; attempt++) {
            if (signal?.aborted) break;

            try {
              console.log(
                `[ChunkedUploader] ⏳ Chunk ${chunkIndex + 1}/${totalChunks} sending (${(length / 1024 / 1024).toFixed(2)} MB, attempt ${attempt})...`
              );

              await uploadChunkXhr({
                url: chunkUrl,
                headers,
                uploadId,
                chunkIndex,
                totalChunks,
                offset,
                tempChunkUri,
                length,
                fileSize,
                signal,
                onProgress,
              });

              console.log(
                `[ChunkedUploader] ✅ Chunk ${chunkIndex + 1}/${totalChunks} sent successfully`
              );
              chunkSuccess = true;
              break;
            } catch (err: any) {
              lastChunkErr = err;
              if (err instanceof FloodWaitError || signal?.aborted) {
                break;
              }
              if (attempt < 3) {
                console.warn(
                  `[ChunkedUploader] ⚠️ Chunk ${chunkIndex + 1}/${totalChunks} attempt ${attempt} failed: ${err?.message}. Retrying in 1s...`
                );
                await new Promise<void>((resolve) => setTimeout(() => resolve(), 1000));
              }
            }
          }
        } finally {
          // Immediately free disk space for this chunk
          await deleteTempFileSafe(tempChunkUri);
        }

        if (!chunkSuccess) {
          console.error(
            `[ChunkedUploader] ❌ Chunk ${chunkIndex + 1}/${totalChunks} permanently failed after 3 attempts`
          );
          // Fire-and-forget: tell the server to discard the partial upload session
          const abortUrl = `${baseUrl}/api/media/upload/abort`;
          fetch(abortUrl, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ upload_id: uploadId }),
          }).catch(() => {});
          throw lastChunkErr || new Error(`Failed to upload chunk ${chunkIndex + 1}/${totalChunks}`);
        }

        if (nextChunkPromise) {
          currentChunkPromise = nextChunkPromise;
        }
      }
    } finally {
      // Clean up any remaining or in-flight temp files if aborted or errored
      if (nextChunkPromise) {
        try {
          const danglingUri = await nextChunkPromise;
          await deleteTempFileSafe(danglingUri);
        } catch {}
      }
      for (const uri of Array.from(activeTempFiles)) {
        await deleteTempFileSafe(uri);
      }
      activeTempFiles.clear();
    }

    if (signal?.aborted) {
      console.warn(`[ChunkedUploader] 🛑 Upload cancelled after chunks completed`);
      const abortUrl = `${baseUrl}/api/media/upload/abort`;
      fetch(abortUrl, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ upload_id: uploadId }),
      }).catch(() => {});
      throw new Error('Upload cancelled');
    }

    // 3. Complete Upload & Finalize Telegram Message
    const completeUrl = `${baseUrl}/api/media/upload/complete`;
    try {
      let videoMeta: { duration: number; width: number; height: number; thumbnailBase64: string } | null = null;
      const isVideo = item.mimeType.includes('video') || item.fileName.toLowerCase().endsWith('.mp4') || item.fileName.toLowerCase().endsWith('.mov');
      if (isVideo) {
        try {
          videoMeta = await NativeBackgroundService.extractVideoMetadata(item.uri);
          console.log(`[ChunkedUploader] 🎬 Video metadata: duration=${videoMeta.duration}s, ${videoMeta.width}x${videoMeta.height}, hasThumb=${Boolean(videoMeta.thumbnailBase64)}`);
        } catch (vErr) {
          console.warn(`[ChunkedUploader] Could not extract video metadata:`, vErr);
        }
      }

      console.log(`[ChunkedUploader] 🏁 Calling /complete for "${item.fileName}" (uploadId: ${uploadId})...`);
      const completeRes = await fetch(completeUrl, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          upload_id: uploadId,
          channel_id: item.channelId,
          captured_at: new Date(item.createdAt || Date.now()).toISOString(),
          width: videoMeta?.width || item.width || 1920,
          height: videoMeta?.height || item.height || 1080,
          duration: videoMeta?.duration || item.duration || 0,
          thumbnail_base64: videoMeta?.thumbnailBase64 || item.thumbnailBase64 || '',
        }),
        signal,
      });

      if (!completeRes.ok) {
        const errText = await completeRes.text().catch(() => '');
        let errMsg = `Upload complete failed with HTTP ${completeRes.status}`;
        try {
          const errJson = JSON.parse(errText);
          if (errJson?.error) errMsg = errJson.error;
        } catch {}
        console.error(`[ChunkedUploader] ❌ Complete failed for "${item.fileName}": HTTP ${completeRes.status} - ${errMsg}`);
        throw new Error(errMsg);
      }

      const completeData = await completeRes.json();
      const mediaItem = completeData.mediaItem || completeData.item || completeData;
      const telegramMessageId = mediaItem?.telegram_message_id || completeData.telegramMessageId;
      const mediaId = mediaItem?.id || completeData.mediaId;

      console.log(
        `[ChunkedUploader] ✅ Chunked upload completed for "${item.fileName}": mediaId=${mediaId}, tgMsgId=${telegramMessageId}`
      );

      if (onProgress) {
        onProgress(fileSize, fileSize, 100);
      }

      return {
        success: true,
        mediaItem,
        telegramMessageId,
        mediaId,
      };
    } catch (err: any) {
      console.error(`[ChunkedUploader] ❌ Complete exception for "${item.fileName}":`, err?.message || err);
      if (signal?.aborted) throw new Error('Upload cancelled');
      throw err;
    }
  }
}
