# Warm Durable Object WAL Event Dispatch Architecture Plan

## 1. Executive Summary & Incident Analysis

### The Incident
When mutating media metadata in the web UI (e.g. adding person tags, assigning trip tags, setting events/locations, or toggling favorites), Cloudflare Workers logs occasionally reported a fatal request cancellation:
```json
{
  "outcome": "exception",
  "exceptions": [
    {
      "name": "Error",
      "message": "The Workers runtime canceled this request because it detected that your Worker's code had hung and would never generate a response."
    }
  ],
  "logs": [
    "<-- POST /api/trips/8436c43c-bb90-4620-9cf2-de5b0d02097a/media",
    "[2026-08-24T10:40:04.631] [INFO] - [The server closed the connection while sending]"
  ]
}
```

### Root Cause
1. **Stateless Worker Isolation**:
   HTTP route handlers (`/api/trips/:id/media`, `/api/tags/media-*`, `/api/media/:id/favorite`) execute inside standard stateless Cloudflare Worker isolates.
2. **Cold / Unmanaged TCP Sockets**:
   These endpoints invoked `getConnectedClient(auth.sessionString, ...)` directly inside the stateless isolate to send a Telegram message.
3. **Socket Teardown by Telegram & Worker Hang**:
   Stateless isolates cannot maintain active TCP socket lifecycles or handle MTProto DC transport keep-alives. Telegram abruptly severed the connection (`The server closed the connection while sending`). GramJS then entered an internal reconnection/retry loop, indefinitely awaiting socket I/O that could not resolve. Cloudflare runtime detected the stalled thread and aborted the request.
4. **Contrast with Core Media Engine**:
   Video streaming, chunk uploads, thumbnails, and batch media deletions already route through **`TelegramAuthDO`** (Durable Object), which maintains a persistent, warm MTProto client instance in RAM (`getOrConnectUserClient`).

---

## 2. Target Architecture & End-to-End Flow

```
┌────────────────────────────────────────────────────────┐
│                   Frontend Client                      │
└───────────────────────────┬────────────────────────────┘
                            │ 1. POST /api/tags/media-person
                            ▼
┌────────────────────────────────────────────────────────┐
│               Stateless Cloudflare Worker              │
│  • Instant D1 DB update (~2ms)                         │
│  • Returns 200 OK to UI immediately (<20ms)            │
│  • Dispatches background task via ctx.waitUntil(...)   │
└───────────────────────────┬────────────────────────────┘
                            │ 2. Internal DO RPC (stub.fetch)
                            │    POST /api/ledger/emit
                            ▼
┌────────────────────────────────────────────────────────┐
│          TelegramAuthDO (Durable Object in RAM)        │
│  • Warm MTProto connection pool                        │
│  • Zero cold-start TCP handshake                       │
│  • Emits AES-GCM encrypted WAL event / batch manifest  │
│  • Returns { success: true, eventMsgId: 12345 }        │
└───────────────────────────┬────────────────────────────┘
                            │ 3. Asynchronous Callback / DB Record
                            ▼
┌────────────────────────────────────────────────────────┐
│               D1 Database (media_event_messages)       │
│  • Records (channel_id, media_item_id, eventMsgId)     │
│  • Guarantees future clean cascading batch deletion    │
└────────────────────────────────────────────────────────┘
```

---

## 3. Implementation Plan

### Phase 1: Extend `TelegramAuthDO` (`src/server/durable_objects/TelegramAuthDO.ts`)

Add dedicated endpoints in `TelegramAuthDO.fetch()` to handle single WAL events and batch manifests using the warm MTProto connection:

1. **`POST /api/ledger/emit`**
   - **Payload**: `{ channelTgId: string, refMsgId: number, op: GalleryOpType, data: any, customKey?: string }`
   - **Logic**:
     - Extract user client via `clientSessionManager.getOrConnectUserClient(request, effectiveEnv)`.
     - Resolve `targetPeer`.
     - Call `emitGalleryEvent(client, targetPeer, refMsgId, op, data, customKey)`.
     - Return `{ success: !!eventMsgId, eventMsgId }`.

2. **`POST /api/ledger/batch`**
   - **Payload**: `{ channelTgId: string, ops: GalleryOp[], customKey?: string }`
   - **Logic**:
     - Extract user client.
     - Resolve `targetPeer`.
     - Call `emitGalleryBatch(client, targetPeer, channelTgId, ops, customKey)`.
     - Return `{ success: !!eventMsgId, eventMsgId }`.

---

### Phase 2: Create Centralized Dispatcher (`src/server/lib/ledger/dispatcher.ts`)

Create a unified dispatcher helper that handles `AUTH_DO` RPC, headers propagation, fail-safe timeouts, and recording into `media_event_messages`:

```typescript
export interface DispatchLedgerOptions {
  c: Context;
  auth: {
    sessionId?: string;
    userId?: string;
    sessionString?: string;
    telegramConfig?: any;
  };
  channelTgId: string;
  channelDbId: string;
  mediaDbId: string;
  refMsgId: number;
  op: GalleryOpType;
  data: GalleryEventPayload;
  db: any;
}

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

      // Strict 4s timeout protection
      const timeoutPromise = new Promise<Response>((_, reject) =>
        setTimeout(() => reject(new Error("DO ledger dispatch timeout")), 4000)
      );
      const res = await Promise.race([stub.fetch(req), timeoutPromise]);

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
        const targetPeer = await getTargetPeer(client, channelTgId);
        return emitGalleryEvent(client, targetPeer, refMsgId, op, data, (c.env as any)?.MASTER_ENCRYPTION_KEY);
      })();
      eventMsgId = await Promise.race([clientPromise, timeoutPromise]);
    } catch (fallbackErr) {
      console.warn("[LedgerDispatcher] Local client fallback error:", fallbackErr);
    }
  }

  // Register in media_event_messages
  if (eventMsgId && db) {
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
```

---

### Phase 3: Update Route Handlers & Add Non-Blocking Execution

Replace direct `getConnectedClient()` calls in the following files with `dispatchLedgerEvent` / `dispatchLedgerBatch`, wrapped in `c.executionCtx.waitUntil(...)`:

1. **`src/server/routes/media/actionsMedia.ts`** (`POST /:id/favorite`)
   - Update DB and return JSON immediately.
   - Dispatch `dispatchLedgerEvent(..., op: "FAVORITE")` in `c.executionCtx.waitUntil(...)`.

2. **`src/server/routes/tags.ts`**
   - `POST /media-person` (`TAG_PEOPLE`)
   - `POST /media-tag` (`ADD_TAG`)
   - `POST /media-event` (`SET_EVENT`)
   - `POST /media-geo` (`SET_LOCATION`)
   - For `< 5` items: Dispatch individual threaded `dispatchLedgerEvent`.
   - For `≥ 5` items: Dispatch manifest via `dispatchLedgerBatch`.

3. **`src/server/routes/trips.ts`** (`POST /:id/media`)
   - `POST /api/trips/:id/media` (`SET_TRIP`)
   - Apply D1 changes instantly and dispatch WAL emission in background via `dispatchLedgerEvent` / `dispatchLedgerBatch`.

---

## 4. Verification & Testing Checklist

- [ ] **Unit Tests**: Add tests in `tests/integration/ledger_dispatch.test.ts` to verify DO forwarding and fallback behavior.
- [ ] **Worker Hang Simulation**: Verify that when a socket closes or DC fails to respond, `Promise.race` triggers within 4 seconds and does not block the worker thread.
- [ ] **D1 Event Message Tracking**: Confirm that `media_event_messages` gets populated with `event_telegram_msg_id` when triggered via `TelegramAuthDO`.
- [ ] **Batch Deletion Compatibility**: Verify that deleting photos in the UI cleanly pulls `media_event_messages` created by the new DO dispatcher and deletes all linked Telegram messages.
- [ ] **Production Build Check**: Run `npm test` and `npm run build` to ensure 0 TypeScript or bundling issues.
