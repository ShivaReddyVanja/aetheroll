import type { Context } from "hono";
import { getConnectedClient } from "../telegram.ts";
import { emitGalleryEvent, emitGalleryBatch } from "./emitter.ts";
import type { GalleryOpType, GalleryEventPayload, GalleryOp } from "./types.ts";

export interface DispatchLedgerOptions {
  c: Context;
  auth: {
    sessionId?: string;
    userId?: string;
    sessionString?: string;
    telegramConfig?: any;
  };
  channelTgId: string;
  channelDbId?: string;
  mediaDbId?: string;
  refMsgId: number;
  op: GalleryOpType;
  data: GalleryEventPayload;
  db?: any;
}

export interface DispatchLedgerBatchOptions {
  c: Context;
  auth: {
    sessionId?: string;
    userId?: string;
    sessionString?: string;
    telegramConfig?: any;
  };
  channelTgId: string;
  channelDbId?: string;
  items?: Array<{ id: string; telegram_message_id: number }>;
  ops: GalleryOp[];
  db?: any;
}

/**
 * Dispatches a single WAL event payload to Telegram via warm TelegramAuthDO RPC,
 * falling back to local client with fail-safe timeouts, and records the event in D1 media_event_messages.
 */
export async function dispatchLedgerEvent(options: DispatchLedgerOptions): Promise<number | null> {
  const { c, auth, channelTgId, channelDbId, mediaDbId, refMsgId, op, data, db } = options;
  const authDo = (c.env as any)?.AUTH_DO;
  let eventMsgId: number | null = null;

  if (authDo && typeof authDo.idFromName === "function") {
    try {
      const token = auth.sessionId || auth.userId || "default";
      const doId = authDo.idFromName(token);
      const stub = authDo.get(doId);

      const headers = new Headers();
      headers.set("Content-Type", "application/json");
      if (auth.sessionId) headers.set("x-tg-session", auth.sessionId);
      if (c.req.header("cookie")) headers.set("cookie", c.req.header("cookie")!);
      if (c.req.header("authorization")) headers.set("authorization", c.req.header("authorization")!);

      const env = c.env as any;
      if (env?.TELEGRAM_API_ID) headers.set("x-tg-api-id", String(env.TELEGRAM_API_ID));
      if (env?.TELEGRAM_API_HASH) headers.set("x-tg-api-hash", String(env.TELEGRAM_API_HASH));
      if (env?.TELEGRAM_TEST_MODE) headers.set("x-tg-test-mode", String(env.TELEGRAM_TEST_MODE));
      if (env?.SESSION_ENCRYPTION_KEY) headers.set("x-tg-enc-key", String(env.SESSION_ENCRYPTION_KEY));

      const req = new Request("https://internal.do/api/ledger/emit", {
        method: "POST",
        headers,
        body: JSON.stringify({
          channelTgId,
          refMsgId,
          op,
          data,
          customKey: env?.MASTER_ENCRYPTION_KEY,
        }),
      });

      // Strict 4s timeout protection against stalled socket connections
      const timeoutPromise = new Promise<Response>((_, reject) =>
        setTimeout(() => reject(new Error("DO ledger dispatch timeout")), 4000)
      );
      const res = (await Promise.race([stub.fetch(req), timeoutPromise])) as Response;

      if (res.ok) {
        const json: any = await res.json().catch(() => ({}));
        eventMsgId = json.eventMsgId || null;
      }
    } catch (err) {
      console.warn("[LedgerDispatcher] DO emit error:", err);
    }
  } else if (auth.sessionString) {
    // Fallback for local Node.js / unit tests with strict 3s race timeout
    try {
      const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000));
      const clientPromise = (async () => {
        const client = await getConnectedClient(auth.sessionString!, auth.telegramConfig);
        let targetPeer: any = channelTgId;
        if (targetPeer !== "me" && !targetPeer.startsWith("me_")) {
          try { targetPeer = await client.getInputEntity(targetPeer); }
          catch { try { targetPeer = await client.getEntity(targetPeer); } catch {} }
        } else {
          targetPeer = "me";
        }
        return emitGalleryEvent(
          client,
          targetPeer,
          refMsgId,
          op,
          data,
          (c.env as any)?.MASTER_ENCRYPTION_KEY
        );
      })();
      eventMsgId = await Promise.race([clientPromise, timeoutPromise]);
    } catch (fallbackErr) {
      console.warn("[LedgerDispatcher] Local client fallback error:", fallbackErr);
    }
  }

  // Register in media_event_messages if eventMsgId was produced and DB info is supplied
  if (eventMsgId && db && channelDbId && mediaDbId) {
    try {
      await db.run(
        `INSERT OR IGNORE INTO media_event_messages (id, channel_id, media_item_id, media_telegram_msg_id, event_telegram_msg_id)
         VALUES (?, ?, ?, ?, ?)`,
        [crypto.randomUUID(), channelDbId, mediaDbId, refMsgId, eventMsgId]
      );
    } catch {}
  }

  return eventMsgId;
}

/**
 * Dispatches a batch WAL manifest to Telegram via warm TelegramAuthDO RPC,
 * falling back to local client with fail-safe timeouts.
 */
export async function dispatchLedgerBatch(options: DispatchLedgerBatchOptions): Promise<number | null> {
  const { c, auth, channelTgId, channelDbId, items, ops, db } = options;
  const authDo = (c.env as any)?.AUTH_DO;
  let eventMsgId: number | null = null;

  if (authDo && typeof authDo.idFromName === "function") {
    try {
      const token = auth.sessionId || auth.userId || "default";
      const doId = authDo.idFromName(token);
      const stub = authDo.get(doId);

      const headers = new Headers();
      headers.set("Content-Type", "application/json");
      if (auth.sessionId) headers.set("x-tg-session", auth.sessionId);
      if (c.req.header("cookie")) headers.set("cookie", c.req.header("cookie")!);
      if (c.req.header("authorization")) headers.set("authorization", c.req.header("authorization")!);

      const env = c.env as any;
      if (env?.TELEGRAM_API_ID) headers.set("x-tg-api-id", String(env.TELEGRAM_API_ID));
      if (env?.TELEGRAM_API_HASH) headers.set("x-tg-api-hash", String(env.TELEGRAM_API_HASH));
      if (env?.TELEGRAM_TEST_MODE) headers.set("x-tg-test-mode", String(env.TELEGRAM_TEST_MODE));
      if (env?.SESSION_ENCRYPTION_KEY) headers.set("x-tg-enc-key", String(env.SESSION_ENCRYPTION_KEY));

      const req = new Request("https://internal.do/api/ledger/batch", {
        method: "POST",
        headers,
        body: JSON.stringify({
          channelTgId,
          ops,
          customKey: env?.MASTER_ENCRYPTION_KEY,
        }),
      });

      const timeoutPromise = new Promise<Response>((_, reject) =>
        setTimeout(() => reject(new Error("DO ledger batch timeout")), 4000)
      );
      const res = (await Promise.race([stub.fetch(req), timeoutPromise])) as Response;

      if (res.ok) {
        const json: any = await res.json().catch(() => ({}));
        eventMsgId = json.eventMsgId || null;
      }
    } catch (err) {
      console.warn("[LedgerDispatcher] DO batch emit error:", err);
    }
  } else if (auth.sessionString) {
    try {
      const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000));
      const clientPromise = (async () => {
        const client = await getConnectedClient(auth.sessionString!, auth.telegramConfig);
        let targetPeer: any = channelTgId;
        if (targetPeer !== "me" && !targetPeer.startsWith("me_")) {
          try { targetPeer = await client.getInputEntity(targetPeer); }
          catch { try { targetPeer = await client.getEntity(targetPeer); } catch {} }
        } else {
          targetPeer = "me";
        }
        return emitGalleryBatch(
          client,
          targetPeer,
          channelTgId,
          ops,
          (c.env as any)?.MASTER_ENCRYPTION_KEY
        );
      })();
      eventMsgId = await Promise.race([clientPromise, timeoutPromise]);
    } catch (fallbackErr) {
      console.warn("[LedgerDispatcher] Local client batch fallback error:", fallbackErr);
    }
  }

  // Register in media_event_messages if eventMsgId was produced and DB info is supplied
  if (eventMsgId && db && channelDbId && items && items.length > 0) {
    for (const item of items) {
      try {
        await db.run(
          `INSERT OR IGNORE INTO media_event_messages (id, channel_id, media_item_id, media_telegram_msg_id, event_telegram_msg_id)
           VALUES (?, ?, ?, ?, ?)`,
          [crypto.randomUUID(), channelDbId, item.id, item.telegram_message_id, eventMsgId]
        );
      } catch {}
    }
  }

  return eventMsgId;
}
