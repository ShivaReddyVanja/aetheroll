# Telegram-Backed Streaming Investigation & Fix Plan

## Summary of Root Causes

### 1. MTProto Multi-DC File Migration Failure & Unbounded Socket Hang (`parallelSegmentFetcher.ts`)
* **Core Cause:** Files (documents and photos) uploaded to Telegram can be hosted on different Telegram Data Centers (DC 1, DC 2, DC 3, DC 4, or DC 5) than the user's or bot's login DC.
* **Failure Mode:**
  * Direct calls to `client.invoke(new Api.upload.GetFile(...))` fail with `FILE_MIGRATE_<dcId>` / `FileMigrateError`.
  * The error handler in `parallelSegmentFetcher.ts` did not inspect DC migration or switch MTProto senders (`client.getSender(dcId)`).
  * The retry step (`await client.invoke(req)`) lacked a race timeout, causing the GramJS MTProto socket to hang indefinitely on the wrong DC connection.
  * Result: The HTTP request to `/api/stream` never completed, resulting in an infinite loading spinner on the frontend.

### 2. Singleton Abort Controller Race Condition (`streamHandler.ts`)
* **Core Cause:** `StreamHandler` used a shared instance variable (`this.streamAbortController`) across incoming stream requests.
* **Failure Mode:**
  * HTML5 `<video>` players send an initial range probe (`bytes=0-`), close or abort it once container metadata is inspected, and fire subsequent range requests.
  * The abort event from the closed probe fired `this.streamAbortController.abort()`, which terminated the newly spawned parallel MTProto workers for the active playback request.

### 3. Missing Integrity Validation in Segment Assembly (`parallelSegmentFetcher.ts`)
* **Core Cause:** The parallel fetcher assembled 2MB segment buffers via `Buffer.concat(buffers.filter(Boolean))`.
* **Failure Mode:**
  * When any individual 512KB chunk failed or timed out, the assembly concatenated non-contiguous byte slices.
  * Browser video decoders stall and buffer indefinitely when encountering truncated or malformed MP4/WebM byte streams.

---

## Actionable Fix Plan (For Future Reference)

### Step 1: DC-Aware MTProto Chunk Fetching
* Update `mediaLocationResolver.ts` to return both `location` and `dcId` (extracted from `doc.dcId` / `photo.dcId`).
* In `parallelSegmentFetcher.ts`:
  * Initialize an MTProto sender via `client.getSender(dcId)`.
  * Dispatch requests using `client.invokeWithSender(req, sender)`.
  * Catch `FileMigrateError` / `FILE_MIGRATE_<dcId>`, update sender via `client.getSender(newDc)`, and retry.
  * Guard all invoke calls (including retries) with a strict timeout (e.g. 5000ms `Promise.race`).

### Step 2: Request-Scoped Abort Isolation
* Replace `this.streamAbortController` in `streamHandler.ts` with a per-request `AbortController`.
* Link the local abort signal directly to `request.signal` so that aborted requests do not impact other concurrent or sequential streams on the Durable Object.

### Step 3: Segment Assembly Integrity & Graceful Fallback
* Verify that all required chunk offsets in `buffers` are non-null and correctly ordered before caching and returning the segment.
* If any chunk fails all retries, cleanly fall back to `client.downloadMedia(msg.media, {})` or return a proper HTTP 502/504 error response rather than returning a corrupt partial buffer.
