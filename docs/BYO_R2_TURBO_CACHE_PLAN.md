# ⚡ BYOS (Bring Your Own Storage) — Per-User R2 Turbo Cache Architecture

## 1. Executive Summary

This architecture implements a **"Bring Your Own Storage" (BYOS)** edge acceleration layer. 
* **Permanent Cloud Vault:** Telegram (unlimited storage, zero cost).
* **Per-User Edge Cache:** User's personal Cloudflare R2 bucket (10 GB free tier + 0 egress fees per account).
* **Result:** **10ms ultra-low latency video streaming and 0ms timeline scrubbing** with **$0 infrastructure costs** for the app maintainer.

---

## 2. Architecture & Data Flow

```
┌────────────────────────────────────────────────────────────────────────┐
│                          User Web Browser                              │
│                                                                        │
│   1. Video Play Request (Range: bytes=0-1048576)                       │
│        │                                                               │
│        ▼                                                               │
│   ┌──────────────────────────────────────────────────────────────┐     │
│   │               Cloudflare Worker / App Edge                   │     │
│   └──────────────────────┬──────────────────────────────┬────────┘     │
│                          │                              │              │
│                 Cache HIT (10ms)               Cache MISS              │
│                          │                              │              │
│                          ▼                              ▼              │
│             ┌─────────────────────────┐    ┌─────────────────────────┐ │
│             │  User's Personal R2     │    │ Telegram MTProto Engine │ │
│             │  (Global Edge CDN)      │    │ (Stream + BG Cache to R2│ │
│             └─────────────────────────┘    └─────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Why This Is a Superpower

### 3.1 Cost Multiplier (Free Tier Aggregation)
* Cloudflare R2 offers **10 GB of storage + unlimited egress (bandwidth)** for free on every Cloudflare account.
* **Single shared bucket:** 100 users quickly exceed 10 GB → High storage bills.
* **BYOS Per-User buckets:** 100 users = **100 × 10 GB = 1 Terabyte (1,000 GB)** of high-speed edge cache at **$0 total cost**.

### 3.2 Performance Benchmarks

| Metric | Direct from Telegram (Cache Miss) | User's Personal R2 (Cache Hit) |
|---|---|---|
| **Response Latency (TTFB)** | ~250ms – 450ms | **10ms – 25ms** |
| **Seek / Scrub Lag** | ~300ms pause | **0ms (Instantaneous)** |
| **Throughput Speed** | ~5 – 15 MB/s | **50 – 100+ MB/s (Fiber/5G Line Speed)** |
| **Edge Proximity** | Central Telegram DC | Nearest Cloudflare Edge PoP (330+ Cities) |

---

## 4. Playback Strategy: "Parallel Stream & Background Cache"

To prevent any delay on first play:
1. **Instant First Chunk:** When the user clicks play, chunk `0–512KB` is piped directly from Telegram to the `<video>` element within ~200ms.
2. **Asynchronous Background Cache:** The worker kicks off a background streaming pipe that uploads the full video into the user's R2 bucket (`user_cache/{media_id}.mp4`).
3. **Subsequent Reads & Seeking:** As soon as the file is cached in R2, all future seeks, rewinds, and re-watches hit the user's R2 bucket directly at edge speeds.

---

## 5. Database Schema Extensions (Cloudflare D1)

### 5.1 `user_storage_configs`
Stores encrypted S3/R2 API credentials for users who activate Turbo Mode.

```sql
CREATE TABLE user_storage_configs (
    user_id                  TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    r2_account_id            TEXT NOT NULL,
    r2_bucket_name           TEXT NOT NULL,
    r2_access_key_id         TEXT NOT NULL,
    r2_secret_access_key     TEXT NOT NULL,      -- Encrypted with AES-256-GCM
    r2_custom_domain         TEXT,               -- Optional public domain (e.g. cdn.user.com)
    max_cache_bytes          INTEGER DEFAULT 9663676416, -- 9 GB safety ceiling (under 10GB free tier)
    current_cache_bytes      INTEGER DEFAULT 0,
    is_active                BOOLEAN DEFAULT 1,
    created_at               TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at               TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

### 5.2 `user_media_cache`
Tracks cached objects per user for LRU eviction.

```sql
CREATE TABLE user_media_cache (
    id              TEXT PRIMARY KEY,            -- UUID
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    media_item_id   TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
    r2_object_key   TEXT NOT NULL,               -- e.g. "videos/7a8e8abe.mp4"
    file_size_bytes INTEGER NOT NULL,
    last_hit_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, media_item_id)
);

CREATE INDEX idx_user_cache_lru ON user_media_cache(user_id, last_hit_at ASC);
```

---

## 6. Sliding LRU Cache Eviction (9 GB Safety Buffer)

To keep every user strictly within Cloudflare's **10 GB free tier**:
1. Before writing a new video to a user's R2, check `current_cache_bytes + new_file_size`.
2. If total exceeds `9 GB` (9,663,676,416 bytes):
   ```sql
   SELECT * FROM user_media_cache 
   WHERE user_id = ? 
   ORDER BY last_hit_at ASC 
   LIMIT 5;
   ```
3. Delete the oldest objects from the user's R2 bucket.
4. Decrement `current_cache_bytes` in D1.
5. The media remains permanently accessible in Telegram cloud.

---

## 7. User Experience (UX) Flow

### Standard User (Zero Setup)
* Uses default Telegram MTProto streaming.
* Zero configuration required.

### Power User ("⚡ Turbo Mode" in Settings)
1. User navigates to **Settings → Storage & Speed**.
2. Sees a 1-click tutorial: *"How to create a free Cloudflare R2 bucket in 2 minutes"*.
3. Pastes:
   - `Account ID`
   - `Bucket Name`
   - `Access Key ID` & `Secret Access Key`
4. Clicks **"Test Connection & Enable Turbo"**.
5. Once enabled, a **"⚡ Turbo Mode Active"** badge appears in the top navigation bar. All video scrubbing and photo loads are instantly edge-cached.

---

## 8. Implementation Roadmap

- [ ] **Phase 1:** Add `user_storage_configs` and `user_media_cache` D1 tables.
- [ ] **Phase 2:** Implement `@aws-sdk/client-s3` dynamic R2 client factory (cached per user).
- [ ] **Phase 3:** Update `/api/stream` to check user R2 bucket first (Cache Hit: R2 S3 `GetObject` Range, Cache Miss: Telegram + Background PutObject).
- [ ] **Phase 4:** Build the **"Storage & Turbo Mode"** settings modal with live connection testing.
- [ ] **Phase 5:** Implement automated LRU eviction worker when user cache reaches 9 GB.
