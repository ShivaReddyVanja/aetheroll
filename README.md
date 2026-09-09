# Aetheroll

<p align="center">
  <img src="apps/web/public/logo.svg" alt="Aetheroll Logo" width="72" height="72" />
</p>

<p align="center">
  <strong>Zero-knowledge, unmetered 4K media gallery powered by Telegram Cloud and Cloudflare Serverless Edge.</strong>
</p>

<p align="center">
  <a href="https://github.com/ShivaReddyVanja/aetheroll/releases/latest/download/aetheroll-mobile-latest.apk"><img src="https://img.shields.io/badge/Android-APK%20Download-success?style=flat-square&logo=android" alt="Download APK" /></a>
  <a href="https://github.com/ShivaReddyVanja/aetheroll/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-AGPL%20v3-blue.svg?style=flat-square" alt="License: AGPL v3" /></a>
  <img src="https://img.shields.io/badge/Next.js-15-black?style=flat-square&logo=next.js" alt="Next.js 15" />
  <img src="https://img.shields.io/badge/React%20Native-0.87-blue?style=flat-square&logo=react" alt="React Native" />
  <img src="https://img.shields.io/badge/Cloudflare-Workers-orange?style=flat-square&logo=cloudflare" alt="Cloudflare Workers" />
</p>

---

## Overview

Aetheroll is a privacy-first cloud gallery designed as a high-performance alternative to Google Photos and Apple iCloud. It provides unlimited cloud media storage with zero recurring storage fees by leveraging private Telegram channels as an infinite vault, backed by Cloudflare Workers, Durable Objects, D1 SQL Database, and R2 Object Cache for edge video streaming.

---

## Key Features

* **Unlimited Cloud Vault**: Store photos and videos without compression via Telegram's storage backend (up to 2 GB per file, 4 GB with Telegram Premium).
* **Zero-Knowledge Dual-Key Envelope Encryption**: MTProto sessions are encrypted using keys split between the server (`SESSION_ENCRYPTION_KEY`) and volatile client cookies (`clientSecret`). In the event of a database leak, sessions cannot be decrypted without the client-side secret.
* **10-Worker MTProto 4K Range Streaming**: Splits multi-gigabyte video files into parallel segments via Cloudflare Durable Objects, providing sub-5ms seek times and continuous HTTP `Range` playback.
* **Native Android Application**: Includes background camera roll sync, offline metadata indexing with WatermelonDB, and KeyStore-backed credential storage.
* **Append-Only Write-Ahead Log (WAL)**: Metadata mutations (tags, favorites, trip groupings) are committed to Telegram threads as structured records (`[GP_EVENT:v1]`), enabling complete disaster recovery state replay if the local database is lost.
* **Token-Bucket Rate Pacer**: Enforces strict Telegram API throughput limits (<= 25 req/s) with automated exponential backoff on `FLOOD_WAIT` events.
* **Zero Egress Fees**: Serves cached media through Cloudflare R2 and Edge CDN caches with no bandwidth charges.

---

## System Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                        CLIENT APPLICATIONS                             │
│                                                                        │
│   ┌──────────────────────────────┐    ┌────────────────────────────┐   │
│   │    Web App (Next.js 15)      │    │  Android App (React Native)│   │
│   │  • Responsive Masonry Grid   │    │  • Background Auto-Backup  │   │
│   │  • BlurHash Instant Canvas   │    │  • Offline WatermelonDB    │   │
│   │  • Hardware GPU Frame Grab   │    │  • Android KeyStore Vault  │   │
│   └──────────────┬───────────────┘    └─────────────┬──────────────┘   │
└──────────────────┼──────────────────────────────────┼──────────────────┘
                   │                                  │
                   │  HTTPS / WSS (Range Requests)    │
                   ▼                                  ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   CLOUDFLARE SERVERLESS EDGE RUNTIME                   │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                     API Router (Hono / Workers)                  │  │
│  └──────────────┬───────────────────────────────────┬───────────────┘  │
│                 │                                   │                  │
│                 ▼                                   ▼                  │
│  ┌─────────────────────────────┐     ┌──────────────────────────────┐  │
│  │   Cloudflare D1 Database    │     │      Cloudflare R2 Bucket    │  │
│  │  • User index & Auth tokens │     │  • Zero-egress stream cache  │  │
│  │  • Media metadata & GPS     │     │  • Generated thumbnails      │  │
│  └─────────────────────────────┘     └──────────────────────────────┘  │
│                 │                                   ▲                  │
│                 ▼                                   │                  │
│  ┌──────────────────────────────────────────────────┴───────────────┐  │
│  │            TelegramAuthDO (Cloudflare Durable Objects)           │  │
│  │  • Stateful persistent MTProto connection pool                   │  │
│  │  • 10-Worker parallel chunk stream fetcher                       │  │
│  │  • WebSocket chunked upload pipeline                             │  │
│  │  • Rate-paced token bucket (FLOOD_WAIT protection)               │  │
│  └──────────────────────────────┬───────────────────────────────────┘  │
└─────────────────────────────────┼──────────────────────────────────────┘
                                  │
                                  │ MTProto 2.0 (Binary Encrypted TCP)
                                  ▼
┌────────────────────────────────────────────────────────────────────────┐
│                    TELEGRAM CLOUD INFRASTRUCTURE                       │
│                                                                        │
│   • Permanent Unlimited Binary Storage (Private Channels / Saved)      │
│   • Threaded Event Ledger (Disaster Recovery State Replay)             │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Repository Structure

```
.
├── apps/
│   ├── web/                     # Next.js 15 Web Application (App Router, Tailwind CSS)
│   └── mobile/                  # React Native Android Application (CLI, WatermelonDB)
├── workers/
│   └── api/                     # Cloudflare Worker API & Durable Objects (Hono, GramJS, D1, R2)
├── packages/
│   └── types/                   # Shared TypeScript models and interfaces
├── docs/                        # Architectural specifications & deployment guides
│   ├── ENVIRONMENT_AND_DEPLOYMENT_GUIDE.md  # Configuration matrix
│   ├── AUTH_AND_SECURITY_ARCHITECTURE.md    # Dual-key encryption specification
│   ├── CACHING_AND_DATA_FETCHING_ARCHITECTURE.md # 3-tier caching pipeline
│   └── METRICS_CAPACITY_AND_COST_ARCHITECTURE.md # Resource monitoring
└── migrations/                  # Cloudflare D1 SQL schema migrations
```

---

## Quickstart & Local Development

### Prerequisites
* Node.js `v22.11.0+`
* pnpm `v10.0.0+`
* Telegram Developer Account (`api_id` and `api_hash` from [my.telegram.org](https://my.telegram.org))

### 1. Clone and Install Dependencies
```bash
git clone https://github.com/ShivaReddyVanja/aetheroll.git
cd aetheroll
pnpm install
```

### 2. Configure Backend Secrets
```bash
cd workers/api
cp .dev.vars.example .dev.vars
```

Edit `workers/api/.dev.vars`:
```ini
TELEGRAM_API_ID="YOUR_TELEGRAM_API_ID"
TELEGRAM_API_HASH="YOUR_TELEGRAM_API_HASH"

# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
SESSION_ENCRYPTION_KEY="64_CHAR_HEX_SESSION_KEY"
MASTER_ENCRYPTION_KEY="64_CHAR_HEX_MASTER_KEY"
```

### 3. Configure Web Frontend
```bash
cd apps/web
cp .env.example .env.local
```

### 4. Start Development Servers
```bash
# From repository root:
pnpm dev
```
* Web App: `http://localhost:3000`
* Worker API: `http://localhost:8787`

---

## Production Deployment

Refer to the [Environment & Deployment Guide](docs/ENVIRONMENT_AND_DEPLOYMENT_GUIDE.md) for full instructions.

### 1. Cloudflare Worker API
```bash
cd workers/api

# Set production secrets
npx wrangler secret put TELEGRAM_API_ID
npx wrangler secret put TELEGRAM_API_HASH
npx wrangler secret put SESSION_ENCRYPTION_KEY
npx wrangler secret put MASTER_ENCRYPTION_KEY

# Apply migrations and deploy
npx wrangler d1 migrations apply aetheroll-db --remote
npx wrangler deploy
```

### 2. Web Frontend (Vercel)
Deploy `apps/web` to Vercel and configure:
* `NEXT_PUBLIC_REMOTE_API_URL`: `https://your-worker-api.domain.com`
* `NEXT_PUBLIC_SITE_URL`: `https://your-website.domain.com`

### 3. Mobile App (Android APK)
The GitHub Actions workflow `.github/workflows/mobile-release.yml` compiles and signs release APKs on new releases.

---

## Testing

```bash
# Run Worker API test suite (109+ tests)
pnpm --filter @aetheroll/api test:unit

# Run Web application build verification
pnpm --filter @aetheroll/web build

# Run monorepo typecheck
pnpm turbo run build
```

---

## License

This project is licensed under the [GNU Affero General Public License v3.0 (AGPL-3.0)](LICENSE).
