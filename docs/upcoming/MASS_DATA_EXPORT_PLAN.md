# Mass Data Export Architecture Specification (Zero-Cloud-Cost Strategy)
## Decoupled Direct MTProto Streaming, Zero-Egress Manifest Engine & Offline Disaster Recovery

> **Document Status**: UPCOMING ARCHITECTURAL SPECIFICATION — IMPORTANT  
> **Target Environment**: Cloudflare Workers, Cloudflare D1 Database, Telegram MTProto, React Native Android App, Web Stream API, Standalone CLI Downloader.  
> **Related Specifications**: [`AUTH_AND_SECURITY_ARCHITECTURE.md`](../AUTH_AND_SECURITY_ARCHITECTURE.md), [`CACHING_AND_DATA_FETCHING_ARCHITECTURE.md`](../CACHING_AND_DATA_FETCHING_ARCHITECTURE.md), [`METRICS_CAPACITY_AND_COST_ARCHITECTURE.md`](../METRICS_CAPACITY_AND_COST_ARCHITECTURE.md).

---

## 1. Executive Summary & Problem Statement

As Aetheroll users accumulate high-resolution photos and 4K video vaults over time, individual user library sizes inevitably reach **500 GB to 2 TB+**. Eventually, users will request a complete mass data export ("Google Takeout style") of their entire media gallery, EXIF metadata, albums, tags, and face recognition bounding boxes.

### The Problem with Traditional Cloud Data Export
In standard cloud architectures (e.g., AWS S3, Google Cloud Storage, or standard serverless backends):
1. **Exorbitant Egress Bandwidth Fees**: Transferring 1 TB of media off cloud storage costs **~$80 to $120+ per export** on AWS S3 or GCP.
2. **Serverless Wall-Clock & CPU Execution Limits**: Cloudflare Workers have a 128 MB RAM limit and strict CPU execution time limits (30s wall time). Streaming multi-gigabyte zip files or compressing multi-terabyte libraries on serverless edge nodes is computationally impossible and causes instant worker crashes.
3. **Staging Storage Overhead**: Buffering large temporary ZIP archives in object storage (R2 / S3) incurs massive temporary storage costs and double-read operations.
4. **Telegram Rate Limits (`FLOOD_WAIT`)**: If server-side workers open hundreds of concurrent MTProto streams to fetch media on behalf of a user export, Telegram's API rate-pacer flags the server IP, triggering cascading `FLOOD_WAIT` blocks.

### The Solution: Decoupled Zero-Cost Client Export Engine
Aetheroll solves the mass data export problem at **~$0.0001 total cloud cost** with **$0 cloud egress fees** by decoupling metadata generation from heavy binary data transfer:

* **Phase 1: Zero-Cost Manifest Generation (API Worker)**: The API Worker queries Cloudflare D1 to produce a compact JSON manifest (`manifest.json` + `media_catalog.json`) containing all EXIF data, tags, albums, and Telegram file pointers (`channel_id`, `telegram_message_id`, `file_type`, `file_size_bytes`, `sha256`). Size: **< 20 MB** for 100,000 items. Cloud compute cost: **~$0.0001**.
* **Phase 2: Direct-to-Client Media Transfer (Zero Cloud Egress)**: The client application (Native Mobile App, Web Browser, or Desktop CLI Tool) connects **directly to Telegram's MTProto servers** using the user's MTProto session. Binary media flows directly from Telegram Cloud to the user's local disk, completely bypassing Cloudflare Workers and R2.

---

## 2. System Architecture & Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            1. EXPORT MANIFEST                               │
│  Client Requests Export  ──>  Cloudflare Worker API (D1 Database)           │
│                               └─> Generates signed manifest.json (<20 MB)   │
│                                   (Includes DB schema + file pointers)       │
│                                   Cloud Egress: $0 | Compute Cost: ~$0.0001 │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      2. DIRECT BINARY DOWNLOAD                              │
│                                                                             │
│   ┌──────────────────────────┐  ┌──────────────────────┐  ┌──────────────┐   │
│   │  Native Android App      │  │  Desktop CLI Tool    │  │ Web Browser  │   │
│   │  (Background Exporter)   │  │  (aetheroll-export)  │  │ (Stream API) │   │
│   └────────────┬─────────────┘  └──────────┬───────────┘  └──────┬───────┘   │
└────────────────┼───────────────────────────┼─────────────────────┼──────────┘
                 │ Direct MTProto TCP        │ Direct TCP          │ HTTPS
                 ▼                           ▼                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    TELEGRAM CLOUD INFRASTRUCTURE                            │
│                                                                             │
│   • Permanent Unlimited Storage (Private Channels / Saved Messages)         │
│   • Streams 4K Videos & Original Photos directly to User's Local Disk       │
│   • Zero Cloudflare Worker CPU / Memory / Egress Charges                    │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Detailed Component Specifications

### 3.1 API Worker Manifest Generator (`workers/api/src/routes/export/`)

#### Endpoint: `GET /api/v1/user/export/manifest`
* **Authentication**: Requires valid HTTP-only session cookie or Bearer Export Token.
* **Database Aggregation**: Executes a batched query on Cloudflare D1 across:
  * `channels` & `user_channels`
  * `media_items` (filtering active items, excluding soft-deleted)
  * `people` & `media_person_tags` (bounding boxes & face identifiers)
  * `locations` & `tags`
  * `trips` & `albums`
* **Output Payload (`manifest.json`)**:
  ```json
  {
    "version": "1.0",
    "exported_at": "2026-09-13T00:00:00Z",
    "user": {
      "id": "usr_981273",
      "telegram_user_id": 123456789,
      "display_name": "Jane Doe"
    },
    "summary": {
      "total_media_count": 45120,
      "total_size_bytes": 648291048190
    },
    "media_catalog": [
      {
        "id": "med_01H123...",
        "channel_id": "-1001982736451",
        "telegram_message_id": 4092,
        "file_name": "20250815_143000.jpg",
        "file_type": "photo",
        "mime_type": "image/jpeg",
        "file_size_bytes": 14298102,
        "width": 4032,
        "height": 3024,
        "captured_at": "2025-08-15T14:30:00Z",
        "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        "exif": {
          "camera_make": "Apple",
          "camera_model": "iPhone 15 Pro",
          "focal_length": 6.86,
          "iso": 80
        },
        "tags": ["vacation", "beach"],
        "people": [{"person_id": "p_01", "name": "Alice", "bbox": [0.2, 0.3, 0.4, 0.4]}]
      }
    ]
  }
  ```

---

### 3.2 Client Export Downloader Engines

#### Engine A: Native Android App Direct Exporter (`apps/mobile/src/services/export/`)
* **Background Worker Service**: Android `WorkManager` task handles long-running background media downloads.
* **GramJS MTProto Pipeline**: Uses the app's native MTProto connection pool to fetch chunks directly from Telegram DC servers to `/sdcard/Pictures/Aetheroll_Export/`.
* **Rate-Paced Concurrency Control**: Limits concurrent downloads to 3 files, enforcing a token bucket rate (<= 20 req/s) to prevent Telegram `FLOOD_WAIT` events.
* **Auto-Resume & Progress Recovery**: Writes a local `.export_state.json` file tracking completed checksums; gracefully resumes if Wi-Fi disconnects.

#### Engine B: Standalone Desktop CLI Exporter (`scripts/export-cli/`)
* **High-Speed Parallel Downloader**: A lightweight Node/Go CLI tool (`aetheroll-export`) for power users exporting 500 GB+ on high-speed fiber internet.
* **Usage**:
  ```bash
  npx aetheroll-export --token <EXPORT_TOKEN> --output ~/Pictures/Aetheroll_Export/
  ```
* **Directory Structure Reconstruction**: Organizes media into standard photo library folders:
  ```
  Aetheroll_Export/
  ├── manifest.json
  ├── metadata/
  │   ├── people.json
  │   ├── locations.json
  │   └── albums.json
  └── Photos/
      └── 2025/
          └── 08-August/
              ├── 20250815_143000.jpg
              └── 20250815_150000.mp4
  ```

#### Engine C: Web Browser Direct Downloader (`apps/web/src/hooks/useWebExporter.ts`)
* **FileSystem Access API**: Uses `window.showDirectoryPicker()` in modern browsers to write media directly to disk.
* **StreamSaver Pipeline**: For browsers lacking FileSystem Access API, streams file chunks directly from worker redirects/WebSocket channels into disk downloads without filling RAM.

---

### 3.3 Zero-Knowledge Decryption & Checksum Integrity

* **Envelope Decryption**: If media items are encrypted using Aetheroll's zero-knowledge dual-key scheme, the client decrypts payload chunks in memory using the user's `clientSecret` and `SESSION_ENCRYPTION_KEY` immediately before writing to local disk.
* **SHA-256 Validation**: Every downloaded file is hashed upon completion; if the computed SHA-256 mismatch occurs, the client automatically re-fetches the missing chunks.

---

### 3.4 Self-Hostable Offline Replay Package

For power users looking to migrate off Cloudflare or run their own self-hosted Aetheroll instance:
1. **SQLite Database Dump**: Exports raw D1 schema and data as a single `.sqlite` file.
2. **Telegram WAL Event Ledger Dump**: Downloads all `[GP_EVENT:v1]` append-only event messages from the user's Telegram channel threads, allowing complete offline database rebuilds using `scripts/rebuild-ledger.mjs`.

---

## 4. Cost Comparison & Resource Metrics

| Resource / Cost Item | Traditional Cloud Zip Export (S3/R2 Server-Side) | Aetheroll Decoupled Direct Export Architecture |
| :--- | :--- | :--- |
| **Cloud Egress Fee (1 TB)** | **~$90.00** (AWS S3) / $0 (R2) | **$0.00** (Direct Telegram DC -> User IP) |
| **Worker CPU Time** | Exceeds 30s limit / Crashes Worker | **~$0.0001** (Single D1 SQL query batch) |
| **Staging Storage Fee** | ~$15.00 / month (Staging ZIPs) | **$0.00** (Zero temporary cloud storage) |
| **Server Memory Footprint** | Exceeds 128 MB RAM (OOM Crash) | **< 10 MB** (JSON Stream) |
| **Telegram FLOOD_WAIT Risk** | High (Server IP gets rate-limited) | **None** (Client user IP rate-paced) |
| **Max Library Size Limit** | Hard capped at ~50 GB | **Unlimited** (Incremental client queue) |
| **Total Cloud Cost / Export** | **~$105.00 – $130.00 per user** | **~$0.0001 total per user** |

---

## 5. Verification & Test Plan

### 5.1 Automated Unit & Integration Tests
* `exportManifest.test.ts`: Verify `GET /api/v1/user/export/manifest` generates valid, schema-compliant JSON manifests for test database fixtures.
* `exportCrypto.test.ts`: Validate that zero-knowledge envelope decryption matches original unencrypted file bytes.

### 5.2 Manual & Stress Verification
1. **D1 Query Scale Benchmark**: Run manifest generation against a D1 database containing 100,000 media records. Ensure query execution time is < 500 ms and memory usage stays well under Cloudflare limits.
2. **Mobile Direct Export Test**: Execute a 50 GB export on an Android device using the mobile app background service; verify zero server CPU spikes and continuous progress during Wi-Fi reconnects.
3. **CLI Downloader Test**: Test `aetheroll-export` CLI on macOS, Linux, and Windows; verify file structure creation, SHA-256 integrity checks, and local EXIF tag preservation.
