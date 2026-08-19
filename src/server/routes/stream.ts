import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { Api } from "telegram";
import bigInt from "big-integer";
import { getDb } from "../lib/db";
import { decryptSession } from "../lib/crypto";
import { getConnectedClient } from "../lib/telegram";

export const streamRouter = new Hono();

// Maximum chunk size allowed by Telegram upload.GetFile is 512KB (524288 bytes)
const CHUNK_SIZE = 512 * 1024;

// Short-term in-memory cache for resolved Telegram message media objects (TTL: 10 minutes)
const mediaObjectCache = new Map<string, { media: any; peer: any; expires: number }>();

function toBigInt(val: number | string) {
  const fn: any = typeof bigInt === "function" ? bigInt : (bigInt as any).default;
  return fn(val);
}

/**
 * Downloads a precise slice of a Telegram document/photo using upload.GetFile
 */
async function fetchTelegramChunk(
  client: any,
  mediaObj: any,
  offsetBytes: number,
  limitBytes: number
): Promise<Buffer> {
  let fileLocation: any;
  let dcId: number = (client.session as any).dcId || 2;

  if (mediaObj.document || mediaObj instanceof Api.Document) {
    const doc = (mediaObj.document || mediaObj) as any;
    dcId = doc.dcId || dcId;
    fileLocation = new Api.InputDocumentFileLocation({
      id: doc.id,
      accessHash: doc.accessHash,
      fileReference: doc.fileReference,
      thumbSize: "",
    });
  } else if (mediaObj.photo || mediaObj instanceof Api.Photo) {
    const photo = (mediaObj.photo || mediaObj) as any;
    dcId = photo.dcId || dcId;
    const sizes = photo.sizes || [];
    const largestSize = sizes[sizes.length - 1];
    fileLocation = new Api.InputPhotoFileLocation({
      id: photo.id,
      accessHash: photo.accessHash,
      fileReference: photo.fileReference,
      thumbSize: largestSize?.type || "x",
    });
  } else {
    throw new Error("Unsupported media type for chunk streaming");
  }

  const req = new Api.upload.GetFile({
    location: fileLocation,
    offset: toBigInt(offsetBytes),
    limit: limitBytes,
  });

  try {
    const sender = await client.getSender(dcId);
    const result = await client.invokeWithSender(req, sender);
    return Buffer.from(result.bytes);
  } catch (err: any) {
    // Handle cross-DC migration if document lives on another DC
    if (err?.errorMessage?.startsWith("FILE_MIGRATE_")) {
      const targetDc = parseInt(err.errorMessage.replace("FILE_MIGRATE_", ""), 10);
      const newSender = await client.getSender(targetDc);
      const retryResult = await client.invokeWithSender(req, newSender);
      return Buffer.from(retryResult.bytes);
    }
    throw err;
  }
}

/**
 * GET /api/stream?media_id=...
 * High-performance HTTP 206 Range-enabled video streaming proxy
 */
streamRouter.get("/", async (c) => {
  try {
    const mediaId = c.req.query("media_id");
    if (!mediaId) return c.text("media_id required", 400);

    const token = getCookie(c, "tg_session");
    if (!token) return c.text("Unauthorized", 401);

    const db = getDb((c.env as any)?.DB);
    const session = await db.get(
      `SELECT u.session_string FROM user_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > CURRENT_TIMESTAMP`,
      [token]
    );

    if (!session) return c.text("Unauthorized", 401);

    const item = await db.get(
      `SELECT m.*, c.telegram_channel_id FROM media_items m
       JOIN channels c ON c.id = m.channel_id
       WHERE m.id = ?`,
      [mediaId]
    );

    if (!item) return c.text("Media item not found", 404);

    const totalSize = item.file_size_bytes;
    const rangeHeader = c.req.header("range");

    // Reuse persistent MTProto client connection (0ms connection overhead!)
    const client = await getConnectedClient(decryptSession(session.session_string));

    // Check message media cache to avoid redundant Telegram getMessages RPCs
    const now = Date.now();
    let cached = mediaObjectCache.get(mediaId);
    let mediaObj: any;
    let targetPeer: any;

    if (cached && cached.expires > now) {
      mediaObj = cached.media;
      targetPeer = cached.peer;
    } else {
      targetPeer = item.telegram_channel_id;
      if (item.telegram_channel_id === "me") {
        targetPeer = "me";
      } else {
        try {
          targetPeer = await client.getInputEntity(item.telegram_channel_id);
        } catch {
          try {
            targetPeer = await client.getEntity(item.telegram_channel_id);
          } catch {}
        }
      }

      const messages = await client.getMessages(targetPeer, { ids: [item.telegram_message_id] });
      const msg = messages[0];

      if (!msg || !msg.media) {
        return c.text("Media not found in Telegram channel", 404);
      }

      mediaObj = msg.media;
      mediaObjectCache.set(mediaId, {
        media: mediaObj,
        peer: targetPeer,
        expires: now + 10 * 60 * 1000, // 10 minutes cache
      });
    }

    if (!rangeHeader) {
      // Full download (e.g. photo or full file download)
      const fullBuffer = await client.downloadMedia(mediaObj, {});
      return new Response(fullBuffer as any, {
        status: 200,
        headers: {
          "Content-Type": item.mime_type || "application/octet-stream",
          "Content-Length": totalSize.toString(),
          "Accept-Ranges": "bytes",
        },
      });
    }

    // Parse Range header: `bytes=start-end`
    const parts = rangeHeader.replace(/bytes=/, "").split("-");
    let start = parseInt(parts[0], 10);
    let requestedEnd = parts[1] ? parseInt(parts[1], 10) : undefined;

    // Telegram upload.GetFile chunk size is 512KB
    let end = requestedEnd !== undefined ? requestedEnd : Math.min(start + CHUNK_SIZE - 1, totalSize - 1);

    if (isNaN(start)) start = 0;
    if (isNaN(end) || end >= totalSize) end = totalSize - 1;
    if (start > end || start >= totalSize) {
      return new Response(null, {
        status: 416,
        headers: {
          "Content-Range": `bytes */${totalSize}`,
        },
      });
    }

    // Align start to 512KB boundary for Telegram upload.GetFile
    const alignedStart = Math.floor(start / CHUNK_SIZE) * CHUNK_SIZE;
    const limit = CHUNK_SIZE; // Must strictly be a 4KB-aligned chunk size (512KB)

    // Fetch chunk directly from Telegram DC via upload.GetFile
    let chunkBuffer: Buffer;
    try {
      chunkBuffer = await fetchTelegramChunk(client, mediaObj, alignedStart, limit);
    } catch (err: any) {
      // Clear cache and retry with fresh message if file reference expired
      mediaObjectCache.delete(mediaId);
      console.warn("[Stream] Retrying with fresh message reference...", err);
      const messages = await client.getMessages(targetPeer, { ids: [item.telegram_message_id] });
      const freshMsg = messages[0];
      if (!freshMsg?.media) throw err;
      mediaObj = freshMsg.media;
      mediaObjectCache.set(mediaId, { media: mediaObj, peer: targetPeer, expires: Date.now() + 10 * 60 * 1000 });
      chunkBuffer = await fetchTelegramChunk(client, mediaObj, alignedStart, limit);
    }

    // Slice the exact requested byte range from the aligned chunk
    const sliceStart = start - alignedStart;
    const sliceEnd = Math.min(sliceStart + (end - start + 1), chunkBuffer.length);
    const exactSlice = chunkBuffer.subarray(sliceStart, sliceEnd);
    const actualEnd = start + exactSlice.length - 1;

    return new Response(exactSlice as any, {
      status: 206,
      headers: {
        "Content-Range": `bytes ${start}-${actualEnd}/${totalSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": exactSlice.length.toString(),
        "Content-Type": item.mime_type || "video/mp4",
      },
    });
  } catch (error: any) {
    console.error("Streaming Proxy Error:", error);
    return c.text(error.message || "Streaming failed", 500);
  }
});
