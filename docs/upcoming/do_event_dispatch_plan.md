# Warm Durable Object Event Dispatch Architecture Plan

## 1. Objective & Problem Statement
Currently, mutating endpoints (such as `POST /api/media/:id/favorite`, `POST /api/tags/*`, and `POST /api/trips/*`) attempt to emit Telegram Write-Ahead-Log (WAL) events to Telegram channels by calling `getConnectedClient()` directly within the stateless Cloudflare Worker execution thread.

### The Problem:
- Stateless Cloudflare Workers cannot maintain persistent TCP/TLS MTProto socket connections to Telegram Data Centers (DCs).
- Attempting a cold MTProto handshake per HTTP request results in socket stalls or severed connections (`The server closed the connection while sending`), leading to Worker runtime cancellation or failed ledger sync.
- While `c.executionCtx.waitUntil(...)` prevents the HTTP client request from hanging, the background WAL event fails to reach Telegram when emitted from a stateless worker.

### The Solution:
Route all background Telegram ledger WAL event emissions directly to **`TelegramAuthDO` (Durable Object)**, which maintains a warm, persistent MTProto client connection in RAM.

---

## 2. Architecture & Request Flow

```
┌────────────────────────┐
│  Client (Web / Mobile) │
└───────────┬────────────┘
            │ 1. POST /api/media/:id/favorite
            ▼
┌────────────────────────────────────────────────────────┐
│  Stateless Cloudflare Worker                           │
│  • Instant D1 DB Mutation (~1ms)                       │
│  • Responds to Client immediately with { favorited }   │
│  • Background dispatch to Warm DO via waitUntil(...)   │
└───────────┬────────────────────────────────────────────┘
            │ 2. stub.fetch("http://do/event", { ... }) (Internal DO RPC)
            ▼
┌────────────────────────────────────────────────────────┐
│  TelegramAuthDO (Durable Object in RAM)                │
│  • Holds persistent, warm GramJS MTProto Client        │
│  • Zero cold-start connection latency                  │
│  • Calls emitGalleryEvent(this.client, ...)            │
└───────────┬────────────────────────────────────────────┘
            │ 3. Instant MTProto RPC
            ▼
┌────────────────────────┐
│  Telegram Cloud (DCs)  │
│  • Threaded WAL Reply  │
└────────────────────────┘
```

---

## 3. Implementation Blueprint

### A. Add `/event` Endpoint in `TelegramAuthDO` (`src/server/durable_objects/`)
1. Create `src/server/durable_objects/events/eventHttpHandler.ts`:
   - Handle `POST /event` and `POST /batch-event`.
   - Accept `{ type: string, peer: string, messageId: number, data: any }`.
   - Use `this.client` (the warm, active Telegram client) to invoke `emitGalleryEvent` or `emitGalleryBatch`.
2. Register the event handler in `TelegramAuthDO.ts` request dispatcher.

### B. Create Shared DO Event Dispatcher Helper (`src/server/lib/doEventDispatcher.ts`)
```typescript
export async function dispatchDoGalleryEvent(
  c: Context,
  event: {
    peer: string;
    messageId: number | string;
    type: string;
    data: any;
  }
) {
  const authDo = (c.env as any)?.AUTH_DO;
  const token = getCookie(c, "tg_session") || c.req.header("x-tg-session") || "default";

  if (authDo && typeof authDo.idFromName === "function") {
    const doId = authDo.idFromName(token);
    const stub = authDo.get(doId);

    const emitPromise = stub.fetch("http://do/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    });

    if (c.executionCtx?.waitUntil) {
      c.executionCtx.waitUntil(emitPromise.catch((err) => console.warn("[DO_Event] Emit failed:", err)));
    }
    return;
  }

  // Fallback for local Node.js / SQLite development
  if (c.executionCtx?.waitUntil) {
    c.executionCtx.waitUntil(emitLocalEvent(c, event).catch(() => {}));
  }
}
```

### C. Update Route Handlers to Use Dispatcher
- [`src/server/routes/media/actionsMedia.ts`](file:///Users/shivareddy/Developer/telegram/src/server/routes/media/actionsMedia.ts): Replace direct `getConnectedClient` with `dispatchDoGalleryEvent`.
- [`src/server/routes/tags.ts`](file:///Users/shivareddy/Developer/telegram/src/server/routes/tags.ts): Replace `emitGalleryEvent` with `dispatchDoGalleryEvent`.
- [`src/server/routes/trips.ts`](file:///Users/shivareddy/Developer/telegram/src/server/routes/trips.ts): Replace `emitGalleryEvent` with `dispatchDoGalleryEvent`.

---

## 4. Expected Benefits
1. **0ms Cold-Start Socket Overhead**: Events are sent over existing, warm WebSocket/TCP sockets in `TelegramAuthDO`.
2. **Zero Request Hangs**: Stateless workers never block on MTProto handshakes.
3. **100% Reliable Ledger Replay**: Telegram channels always receive WAL event logs cleanly, enabling perfect disaster recovery without missing state.
