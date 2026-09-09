# 🌌 Aetheroll — Zero-Knowledge Infinite Cloud Media Vault

<p align="center">
  <img src="apps/web/public/pinwheel.svg" alt="Aetheroll Logo" width="80" height="80" />
</p>

<p align="center">
  <strong>Unlimited, zero-knowledge, unmetered 4K photo & video cloud gallery powered by Telegram Cloud and Cloudflare Serverless Edge.</strong>
</p>

<p align="center">
  <a href="https://github.com/ShivaReddyVanja/aetheroll/releases/latest/download/aetheroll-mobile-latest.apk"><img src="https://img.shields.io/badge/Android%20App-Direct%20APK%20Download-brightgreen?style=for-the-badge&logo=android" alt="Download APK" /></a>
  <a href="https://github.com/ShivaReddyVanja/aetheroll/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-AGPL%20v3-blue.svg?style=for-the-badge" alt="License: AGPL v3" /></a>
  <img src="https://img.shields.io/badge/Stack-Next.js%2015%20%7C%20React%20Native%20%7C%20Cloudflare%20Workers-orange?style=for-the-badge" alt="Tech Stack" />
</p>

---

## 📖 Overview

**Aetheroll** is a modern, privacy-first alternative to Google Photos and Apple iCloud. It provides unlimited cloud storage with zero storage subscription fees by using your own private Telegram channels as an infinite vault, backed by Cloudflare Workers, Durable Objects, D1 Database, and R2 Object Cache for lightning-fast edge streaming.

### 🌟 Key Highlights
* **♾️ Unlimited Free Cloud Vault**: Store millions of 4K photos and multi-gigabyte videos uncompressed via Telegram's unmetered storage backend (2 GB per file, 4 GB with Telegram Premium).
* **🛡️ Zero-Knowledge Dual-Key Envelope Encryption**: MTProto sessions are encrypted using keys split between the server (`SESSION_ENCRYPTION_KEY`) and volatile client cookies (`clientSecret`). Even in a total database leak, sessions cannot be decrypted without the client key.
* **⚡ 10-Worker MTProto 4K Range Streaming**: Splits multi-gigabyte videos into parallel chunks via Cloudflare Durable Objects, delivering sub-5ms seek times and continuous HTTP `Range` playback.
* **📱 Native Android Mobile App**: Features automatic background camera roll backup, local-first offline indexing with WatermelonDB, and KeyStore-backed secure token storage.
* **📜 Append-Only Write-Ahead Log (WAL)**: Metadata modifications (tags, favorites, album groupings) are committed directly into Telegram threads as structured replies (`[GP_EVENT:v1]`), enabling complete zero-data-loss database reconstruction.
* **🚦 Global Token-Bucket Rate Pacing**: Intelligent rate-limiter ensures all Telegram API interactions strictly adhere to Telegram's limits (<= 25 req/s) with automated exponential `FLOOD_WAIT` recovery.
* **🌐 Zero Egress Costs**: Serves media through Cloudflare R2 and Edge CDN caches with $0 bandwidth fees.

---

## 🏗 System Architecture

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

## 📂 Repository Structure

This monorepo is managed with **Turborepo** and **pnpm**:

```
.
├── apps/
│   ├── web/                     # Next.js 15 Web Application (App Router, Tailwind CSS, Lucide)
│   └── mobile/                  # Native React Native Android Application (CLI, WatermelonDB)
├── workers/
│   └── api/                     # Cloudflare Worker API & Durable Objects (Hono, GramJS, D1, R2)
├── packages/
│   └── types/                   # Shared TypeScript models, contracts, and interfaces
├── docs/                        # Complete architectural specifications & deployment guides
│   ├── ENVIRONMENT_AND_DEPLOYMENT_GUIDE.md  # Comprehensive deployment & secrets matrix
│   ├── AUTH_AND_SECURITY_ARCHITECTURE.md    # Zero-knowledge dual-key encryption spec
│   ├── CACHING_AND_DATA_FETCHING_ARCHITECTURE.md # 3-tier edge caching pipeline
│   └── METRICS_CAPACITY_AND_COST_ARCHITECTURE.md # Resource monitoring & free tier cost analysis
└── migrations/                  # Cloudflare D1 SQL database schema migrations
```

---

## ⚡ Quickstart & Local Development

### Prerequisites
* **Node.js**: `v22.11.0+`
* **pnpm**: `v10.0.0+`
* **Telegram Developer Account**: Obtain `api_id` and `api_hash` from [my.telegram.org](https://my.telegram.org).

### 1. Clone & Install Dependencies
```bash
git clone https://github.com/ShivaReddyVanja/aetheroll.git
cd aetheroll
pnpm install
```

### 2. Configure Backend Secrets (`workers/api`)
```bash
cd workers/api
cp .dev.vars.example .dev.vars
```

Edit `workers/api/.dev.vars`:
```ini
TELEGRAM_API_ID="YOUR_TELEGRAM_API_ID"
TELEGRAM_API_HASH="YOUR_TELEGRAM_API_HASH"

# Generate a 256-bit encryption key with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
SESSION_ENCRYPTION_KEY="64_CHAR_HEX_SESSION_KEY"
MASTER_ENCRYPTION_KEY="64_CHAR_HEX_MASTER_KEY"
```

### 3. Configure Frontend Environment (`apps/web`)
```bash
cd apps/web
cp .env.example .env.local
```

### 4. Run Full Stack Locally
```bash
# From repository root:
pnpm dev
```
* **Web App**: `http://localhost:3000`
* **Worker API**: `http://localhost:8787`

---

## 🚀 Production Deployment

For detailed production deployment instructions, refer to the **[Environment & Deployment Guide](docs/ENVIRONMENT_AND_DEPLOYMENT_GUIDE.md)**.

### 1. Deploy Cloudflare Worker API
```bash
cd workers/api

# 1. Set required production secrets
npx wrangler secret put TELEGRAM_API_ID
npx wrangler secret put TELEGRAM_API_HASH
npx wrangler secret put SESSION_ENCRYPTION_KEY
npx wrangler secret put MASTER_ENCRYPTION_KEY

# 2. Deploy D1 migrations
npx wrangler d1 migrations apply aetheroll-db --remote

# 3. Deploy Worker
npx wrangler deploy
```

### 2. Deploy Web Frontend (Vercel)
Deploy `apps/web` to Vercel and configure the environment variables:
* `NEXT_PUBLIC_REMOTE_API_URL`: `https://your-worker-api.domain.com`
* `NEXT_PUBLIC_SITE_URL`: `https://your-website.domain.com`
* `NEXT_PUBLIC_BACKEND_MODE`: `prod`

### 3. Build & Release Mobile App (Android APK)
Trigger the automated GitHub Actions workflow [`.github/workflows/mobile-release.yml`](.github/workflows/mobile-release.yml) to compile, sign, and publish the release APK to GitHub Releases.

---

## 🧪 Testing

Run the automated test suites across all packages:

```bash
# Run Worker API unit & integration tests (109+ tests)
pnpm --filter @aetheroll/api test:unit

# Run Web application build check
pnpm --filter @aetheroll/web build

# Run TypeScript typechecks across all monorepo packages
pnpm turbo run build
```

---

## 📄 License

This project is licensed under the [GNU Affero General Public License v3.0 (AGPL-3.0)](LICENSE).
