# Telegram-Backed Media Gallery (Google Photos Clone)

A self-hosted, Google Photos-style web gallery that uses an unlimited, private Telegram channel as its core media storage engine, paired with Cloudflare R2 for zero-egress, high-performance edge caching.

---

## 🏗 System Architecture

```
┌────────────────────────────────────────────────────────┐
│                   Custom Frontend                      │
│      (Masonry Grid / Infinite Scroll / BlurHash)        │
└──────────────┬──────────────────────────┬──────────────┘
               │                          │
        1. Query Index           2. Request Media Streams
               │                          │
               ▼                          ▼
┌────────────────────────┐      ┌────────────────────────┐
│     Index Database     │      │   Cloudflare Worker    │
│  (Cloudflare D1/SQLite)│      │    + R2 Storage (10GB) │
└───────────┬────────────┘      └───────────┬────────────┘
            │                               │
            │                     3. Cache Miss (Proxy)
            │                               │
            │                               ▼
            │                   ┌────────────────────────┐
            │                   │   Telegram Sync Engine │
            │                   │   (MTProto Client)     │
            │                   └───────────┬────────────┘
            │                               │
            │                      4. Fetch Media Chunks
            │                               │
            ▼                               ▼
┌────────────────────────────────────────────────────────┐
│                 Private Channel Storage                │
│                    (Telegram Cloud)                    │
└────────────────────────────────────────────────────────┘
```

---

## ⚙️ Core Data Flows

### 1. Authentication & Session Initialization
* **QR Code Challenge:** The frontend requests a QR code token from the backend MTProto engine.
* **Telegram Grant:** A whitelisted user scans the QR code using their official Telegram app (Settings -> Devices).
* **Session Persistence:** An MTProto session string (`StringSession`) is generated and stored securely to authenticate subsequent API operations.

### 2. Gallery Read Path
* **Instant Metadata Load:** The frontend fetches gallery structure, date groupings, and low-resolution **BlurHash** strings from the Index Database.
* **Cache Hit (Cloudflare R2):** High-resolution image/video requests are routed to Cloudflare R2 over standard HTTP. On hit, the media streams instantly over Cloudflare's CDN, and the item's `last_accessed_at` timestamp is updated in the database.
* **Cache Miss (Telegram Fallback):** If media is not cached in R2, the backend proxy fetches the raw file chunks from Telegram via MTProto, pipes the stream to the client browser, and asynchronously caches the object into R2.

### 3. Media Ingestion & Upload Path
* **Upload Trigger:** Users drop photos or videos into the web interface.
* **MTProto Transfer:** The backend engine splits files into binary chunks and posts them directly to the designated private Telegram channel.
* **Metadata Indexing:** A channel listener catches the newly posted media, extracts dimensions/file sizes, generates a BlurHash preview, and records the entry in the Index Database.

### 4. Sliding LRU Cache Eviction
* **Threshold Monitoring:** Before writing new objects to R2, the engine checks total storage against a strict ceiling (e.g., 9 GB to preserve a safety buffer under the 10 GB Cloudflare R2 free tier).
* **Least Recently Used (LRU) Purge:** If the capacity threshold is breached, the engine queries the database for objects with the oldest `last_accessed_at` timestamps, deletes them from R2, and resets their cached state in the database. The media remains permanently accessible in the Telegram channel.

---

## 🗄 Index Database Schema

```sql
CREATE TABLE media_items (
    id TEXT PRIMARY KEY,
    telegram_message_id INTEGER NOT NULL,
    file_type TEXT CHECK(file_type IN ('photo', 'video')) NOT NULL,
    file_size_bytes INTEGER NOT NULL,
    blur_hash TEXT NOT NULL,
    r2_key TEXT DEFAULT NULL,
    last_accessed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP NOT NULL
);

CREATE INDEX idx_last_accessed ON media_items(last_accessed_at ASC);
CREATE INDEX idx_created_at ON media_items(created_at DESC);
```

---

## 🚀 Key Features

* **Infinite Masonry Grid:** Virtualized scrolling renders high-density image grids using BlurHash placeholders for zero layout shifts.
* **Zero Egress Fees:** Cloudflare R2 serves media directly over standard CDN connections without incurring bandwidth costs.
* **Unlimited Cloud Vault:** Leverages Telegram's cloud infrastructure as a resilient, permanent storage backend.
* **Video Streaming:** Supports HTTP `Range` requests for video scrubbing and immediate playback.
* **Multi-User Sync:** Multi-device synchronization across allowed channel members.

---

## 🛡 Security & Access Constraints

* **Whitelist Guard:** Access strictly limited to authorized Telegram User IDs.
* **Private Channel Isolation:** Direct web access to the private channel is shielded behind authenticated session workers; standard direct URL hotlinking is prevented.
