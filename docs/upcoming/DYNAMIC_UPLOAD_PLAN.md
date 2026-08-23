# Dynamic Adaptive Multi-File Upload Pipeline Plan

## 1. Objective & Problem Statement
Currently, `src/components/UploaderModal.tsx` executes uploads strictly sequentially (1 file at a time).
* For large files (e.g. 88 MB videos), 1 file at a time with 4 parallel MTProto chunks is optimal.
* For **100+ small photos (e.g. 1–5 MB each)**, sequential execution suffers from repeated TCP/WebSocket connection setups and ~150ms `SendMedia` RPC turnarounds, adding 30–50 seconds of pure waiting time.

By introducing a **Dynamic Adaptive Concurrency Pool**, the uploader will automatically process up to **3 small files concurrently**, switching dynamically to **1 file (dedicated chunking)** whenever a large file (>15 MB) is encountered.

---

## 2. Dynamic Adaptive Concurrency Architecture

### Concurrency Rules
```
┌────────────────────────────────────────────────────────────────────────┐
│  Queue Analysis & Dynamic Slot Dispatcher                              │
│                                                                        │
│  • Next item <= 15 MB  ──► Concurrency Limit = 3 Files in Parallel     │
│  • Next item > 15 MB   ──► Concurrency Limit = 1 File Dedicated Pool   │
└────────────────────────────────────────────────────────────────────────┘
```

```
[ Worker Slot 1 ] ──► Prep File #1 (50ms) ──► WS Stream File #1 (1MB) ──► Done ──► Pick File #4
[ Worker Slot 2 ] ──► Prep File #2 (50ms) ──► WS Stream File #2 (1MB) ──► Done ──► Pick File #5
[ Worker Slot 3 ] ──► Prep File #3 (50ms) ──► WS Stream File #3 (1MB) ──► Done ──► Pick File #6
                                     ▲
                                     │ All 3 workers gated by Server Rate Pacer (<= 25 rps)
```

### Safety & Memory Guarantees
1. **Server Safety**: Our server-side `SlidingWindowRatePacer` in `src/server/durable_objects/TelegramAuthDO.ts` enforces a global <= 25 requests/sec limit across all active WebSockets, preventing any DC socket throttling.
2. **RAM Safety**: Each concurrent worker only decodes and generates BlurHash for the specific file it is actively uploading. Browser RAM usage remains under 25 MB.
3. **Cancellation Safety**: `activeSockets: Map<string, WebSocket>` tracks all in-flight connections; clicking **Cancel** cleanly aborts all active workers simultaneously.

---

## 3. Implementation Steps

### Client: Uploader Modal (`src/components/UploaderModal.tsx`)

1. **Active Sockets Map & Abort Registry**:
   * Replace single `activeWsRef` with `activeSocketsRef = useRef<Map<string, WebSocket>>(new Map())`.
   * Enables cancelling either a specific in-flight task or all tasks at once.

2. **Extract Single File Upload Engine**:
   * Encapsulate single file preparation (BlurHash / EXIF) and WebSocket streaming into a standalone helper:
     `async function uploadSingleTask(taskIndex: number): Promise<void>`

3. **Dynamic Queue Dispatcher Loop**:
   * Run a concurrency-limited pool loop:
     ```ts
     const MAX_CONCURRENT_SMALL_FILES = 3;
     const LARGE_FILE_THRESHOLD = 15 * 1024 * 1024; // 15 MB
     ```
   * Dynamically adjusts active concurrency:
     * If the next task is > 15 MB, wait until all active workers finish, then run that task with dedicated single-file bandwidth.
     * If the tasks are <= 15 MB, keep 3 workers active concurrently.

4. **Live Speed & Counter Aggregation**:
   * Aggregate rolling speed across all active concurrent workers so the header speed badge (`⚡ 1.8 MB/s`) reflects total combined upload throughput.

---

## 4. Verification Plan

### Automated Tests
* Run unit tests: `npx tsx --test tests/upload_pipeline.test.ts`
* Build verification: `npm run build`

### Manual Verification
1. **100 Small Images Batch**:
   * Select 100 images from `~/Downloads/gallery_test_images/`.
   * Verify that 3 items show `Uploading...` simultaneously.
   * Verify total upload time drops by **~3x** (under 20 seconds total).
2. **Mixed Batch (Photos + 1 Large Video)**:
   * Queue 5 photos + 1 large 88 MB video.
   * Verify photos upload 3-at-a-time, and the video takes full dedicated pipeline when its turn arrives.
3. **Cancel Mid-Upload**:
   * Start uploading 100 images and click **Cancel** -> **Yes, Cancel**. Verify all active connections terminate immediately.
