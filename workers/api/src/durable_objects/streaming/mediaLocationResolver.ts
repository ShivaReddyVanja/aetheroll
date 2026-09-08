import { Api } from "telegram";
import type { MediaLocationCacheEntry } from "../common/types";

export class MediaLocationResolver {
  mediaLocationCache: Map<string, MediaLocationCacheEntry>;

  constructor() {
    this.mediaLocationCache = new Map();
  }

  async resolveMediaLocation(client: any, item: any): Promise<any> {
    const now = Date.now();
    const cached = this.mediaLocationCache.get(item.id);
    if (cached && cached.expires > now) {
      return cached.fileLocation;
    }

    let targetPeer: any = item.telegram_channel_id;
    if (item.telegram_channel_id !== "me" && !item.telegram_channel_id.startsWith("me_")) {
      try {
        targetPeer = await client.getInputEntity(item.telegram_channel_id);
      } catch {
        try {
          targetPeer = await client.getEntity(item.telegram_channel_id);
        } catch {}
      }
    } else {
      targetPeer = "me";
    }

    const msgId = Number(item.telegram_message_id);
    const messages = await client.getMessages(targetPeer, { ids: [msgId] });
    const msg = messages[0];
    if (!msg || !msg.media) return null;

    const doc = msg.media.document || (msg.media.className === "MessageMediaDocument" ? msg.media.document : null);
    const photo = msg.media.photo || (msg.media.className === "MessageMediaPhoto" ? msg.media.photo : null);

    let fileLocation: any = null;
    if (doc && doc.id && doc.accessHash && doc.fileReference) {
      fileLocation = new Api.InputDocumentFileLocation({
        id: doc.id,
        accessHash: doc.accessHash,
        fileReference: doc.fileReference,
        thumbSize: "",
      });
    } else if (photo && photo.id && photo.accessHash && photo.fileReference) {
      const sizes = photo.sizes || [];
      const largest = sizes[sizes.length - 1];
      fileLocation = new Api.InputPhotoFileLocation({
        id: photo.id,
        accessHash: photo.accessHash,
        fileReference: photo.fileReference,
        thumbSize: largest?.type || "x",
      });
    }

    if (fileLocation) {
      this.mediaLocationCache.set(item.id, {
        fileLocation,
        expires: now + 60 * 60 * 1000, // 1 hour TTL
      });
    }

    return fileLocation;
  }

  deleteLocation(mediaId: string) {
    this.mediaLocationCache.delete(mediaId);
  }

  clear() {
    this.mediaLocationCache.clear();
  }
}
