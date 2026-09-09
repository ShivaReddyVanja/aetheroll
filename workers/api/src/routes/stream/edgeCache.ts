import { Api } from "telegram";
import bigInt from "big-integer";

// Maximum chunk size allowed by Telegram upload.GetFile is 512KB (524288 bytes)
export const CHUNK_SIZE = 512 * 1024;

// Short-term in-memory cache for resolved Telegram message media objects (TTL: 10 minutes)
export const mediaObjectCache = new Map<string, { media: any; peer: any; expires: number }>();

export function toBigInt(val: number | string) {
  const fn: any = typeof bigInt === "function" ? bigInt : (bigInt as any).default;
  return fn(val);
}

export function getInputFileLocation(mediaObj: any): { location: any; dcId?: number } | null {
  if (!mediaObj) return null;

  const doc =
    mediaObj.document ||
    (mediaObj instanceof Api.Document ? mediaObj : null) ||
    (mediaObj.className === "MessageMediaDocument" ? mediaObj.document : null);
  if (doc && doc.id && doc.accessHash && doc.fileReference) {
    return {
      dcId: doc.dcId,
      location: new Api.InputDocumentFileLocation({
        id: doc.id,
        accessHash: doc.accessHash,
        fileReference: doc.fileReference,
        thumbSize: "",
      }),
    };
  }

  const photo =
    mediaObj.photo ||
    (mediaObj instanceof Api.Photo ? mediaObj : null) ||
    (mediaObj.className === "MessageMediaPhoto" ? mediaObj.photo : null);
  if (photo && photo.id && photo.accessHash && photo.fileReference) {
    const sizes = photo.sizes || [];
    const largest = sizes[sizes.length - 1];
    return {
      dcId: photo.dcId,
      location: new Api.InputPhotoFileLocation({
        id: photo.id,
        accessHash: photo.accessHash,
        fileReference: photo.fileReference,
        thumbSize: largest?.type || "x",
      }),
    };
  }

  return null;
}

/**
 * Downloads a precise slice of a Telegram document/photo using direct Api.upload.GetFile RPC
 */
export async function fetchTelegramChunk(
  client: any,
  mediaObj: any,
  offsetBytes: number,
  limitBytes: number
): Promise<Buffer> {
  try {
    const fileInfo = getInputFileLocation(mediaObj);
    if (fileInfo && fileInfo.location) {
      const req = new Api.upload.GetFile({
        location: fileInfo.location,
        offset: toBigInt(offsetBytes),
        limit: limitBytes,
      });

      const invokePromise = (async () => {
        try {
          const res: any = await client.invoke(req);
          if (res && res.bytes) return Buffer.from(res.bytes);
        } catch (invokeErr: any) {
          console.warn("[Stream] Direct GetFile invoke error:", invokeErr?.errorMessage || invokeErr?.message);
        }
        return null;
      })();

      const chunk = await Promise.race([
        invokePromise,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 3500)),
      ]);

      if (chunk && chunk.length > 0) {
        return chunk;
      }
    }
  } catch (err: any) {
    console.warn("[Stream] Direct GetFile invoke warning:", err?.message || err);
  }

  // Fallback to client.downloadMedia for cross-DC migration or small media
  try {
    const dlPromise = client.downloadMedia(mediaObj, {});
    const fullBuffer = await Promise.race([
      dlPromise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 3500)),
    ]);
    if (fullBuffer && fullBuffer.length > 0) {
      const buf = Buffer.from(fullBuffer);
      return buf.subarray(offsetBytes, offsetBytes + limitBytes);
    }
  } catch (dlErr) {
    console.warn("[Stream] downloadMedia fallback error:", dlErr);
  }

  return Buffer.alloc(0);
}
