import { TelegramClient } from "telegram";
import { CustomFile } from "telegram/client/uploads.js";
import crypto from "crypto";
import { encryptPayload } from "./crypto.ts";
import type {
  GalleryOpType,
  GalleryEventPayload,
  GalleryOp,
} from "./types.ts";
import {
  EVENT_TAG_PREFIX,
  BATCH_TAG_PREFIX,
} from "./types.ts";

/**
 * Emits an AES-GCM encrypted inline event payload threaded to a media item in Telegram
 */
export async function emitGalleryEvent(
  client: TelegramClient,
  targetPeer: any,
  refMsgId: number,
  op: GalleryOpType,
  data: GalleryEventPayload,
  customKey?: string
): Promise<number | null> {
  try {
    const ts = Math.floor(Date.now() / 1000);
    const { iv, ct } = await encryptPayload({ op, data, ts }, customKey);

    const envelope = {
      _t: "GP_EVENT",
      v: 1,
      ref: refMsgId,
      iv,
      ct,
    };

    const messageText = `${EVENT_TAG_PREFIX}\n${JSON.stringify(envelope)}`;

    const sent = await client.sendMessage(targetPeer, {
      message: messageText,
      replyTo: refMsgId,
    });

    return sent.id;
  } catch (err) {
    console.error(`[EventLedger] Failed to emit event ${op} for msg ${refMsgId}:`, err);
    return null;
  }
}

/**
 * Emits an AES-GCM encrypted batch document manifest to a Telegram channel
 */
export async function emitGalleryBatch(
  client: TelegramClient,
  targetPeer: any,
  channelId: string,
  ops: GalleryOp[],
  customKey?: string
): Promise<number | null> {
  try {
    if (!ops || ops.length === 0) return null;

    const ts = Math.floor(Date.now() / 1000);
    const { iv, ct } = await encryptPayload({ ts, ops }, customKey);

    const manifest = {
      _t: "GP_BATCH",
      v: 1,
      channel_id: channelId,
      iv,
      ct,
    };

    const jsonContent = JSON.stringify(manifest, null, 2);
    const jsonBuffer = Buffer.from(jsonContent, "utf-8");
    const fileName = `aetheroll_batch_${Date.now()}_${crypto.randomUUID().slice(0, 8)}.json`;

    const customFile = new CustomFile(fileName, jsonBuffer.length, "", jsonBuffer);

    const sent = await client.sendFile(targetPeer, {
      file: customFile,
      caption: BATCH_TAG_PREFIX,
      forceDocument: true,
      workers: 1,
    });

    return sent.id;
  } catch (err) {
    console.error(`[BatchLedger] Failed to emit batch manifest for channel ${channelId}:`, err);
    return null;
  }
}
