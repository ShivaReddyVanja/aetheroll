# Aetheroll Environment Variables & Deployment Configuration Guide

This document outlines **all environment variables, secrets, bindings, and configurations** across the Aetheroll monorepo. It details what variables were abstracted for the public repository, where they need to be configured in production vs. local development, and how they get injected.

---

## Architecture & Security Model

```
                    ┌──────────────────────────────────────────────┐
                    │           SECURE DASHBOARDS                  │
                    │  • Vercel Project Settings                   │
                    │  • Cloudflare Dashboard (Variables & Secrets)│
                    │  • GitHub Repository Secrets                 │
                    └──────────────────────┬───────────────────────┘
                                           │ (Injects at Build / Runtime)
                     ┌─────────────────────┼─────────────────────┐
                     ▼                     ▼                     ▼
              ┌──────────────┐      ┌──────────────┐      ┌──────────────┐
              │  WEB FRONTEND│      │WORKER BACKEND│      │  MOBILE APP  │
              │  (apps/web)  │      │(workers/api) │      │(apps/mobile) │
              └──────────────┘      └──────────────┘      └──────────────┘
```

* **Public in Git (Safe)**: Non-secret configuration names, resource binding names (`DB`, `R2_BUCKET`, `AUTH_DO`), D1 database UUID (`c43a6484-be96-49c4-8558-a8da284796a1`), generic fallback URLs.
* **Never in Git (Private Dashboards / Secrets)**: `SESSION_ENCRYPTION_KEY`, `TELEGRAM_API_HASH`, `TELEGRAM_API_ID`, Android Release Keystore passwords.

---

## 1. Scope: Web Frontend (`apps/web`)

The web frontend is a Next.js 15 application deployed on **Vercel** or **Cloudflare Pages**.

### Environment Variables Summary

| Variable Name | Required? | Secret? | Production Location | Local Dev Location | Default / Example Value |
| :--- | :---: | :---: | :--- | :--- | :--- |
| `NEXT_PUBLIC_REMOTE_API_URL` | **Yes** | No | Vercel Settings → Env Vars | `.env.local` / `.env` | `https://aetheroll-api.yourdomain.com` |
| `NEXT_PUBLIC_SITE_URL` | Recommended | No | Vercel Settings → Env Vars | `.env.local` / `.env` | `https://aetheroll.app` |
| `NEXT_PUBLIC_BACKEND_MODE` | No | No | Vercel Settings → Env Vars | `.env.local` / `.env` | `prod` (or `local` for local SQLite) |
| `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` | Optional | No | Vercel Settings → Env Vars | `.env.local` / `.env` | `ggUbiG9i3iks...` |

### Where & How They Are Injected
1. **In Production (Vercel)**:
   * Go to **Vercel Dashboard → Your Project → Settings → Environment Variables**.
   * Add `NEXT_PUBLIC_REMOTE_API_URL` set to your live Cloudflare Worker API URL (e.g. `https://aetheroll-api.builtbyshiva.com` or `https://aetheroll.<subdomain>.workers.dev`).
   * Add `NEXT_PUBLIC_SITE_URL` set to your live website URL (e.g. `https://aetheroll.builtbyshiva.com`).
   * *How injection works*: Next.js replaces all `process.env.NEXT_PUBLIC_*` references in the frontend JavaScript bundle during `next build`.
2. **In Local Development**:
   * Create `apps/web/.env.local` (or root `.env`):
     ```bash
     NEXT_PUBLIC_BACKEND_MODE=prod
     NEXT_PUBLIC_REMOTE_API_URL=http://localhost:8787
     NEXT_PUBLIC_SITE_URL=http://localhost:3000
     ```

### Code Files Using These Variables:
* [`apps/web/src/lib/config.ts`](file:///Users/shivareddy/Developer/telegram/apps/web/src/lib/config.ts): Manages `AETHEROLL_WORKER_URL`, API fetch routing, and WebSocket auth URLs.
* [`apps/web/src/lib/brand.ts`](file:///Users/shivareddy/Developer/telegram/apps/web/src/lib/brand.ts): Manages `SITE_URL`, GitHub links, and APK direct download URL.
* [`apps/web/next.config.mjs`](file:///Users/shivareddy/Developer/telegram/apps/web/next.config.mjs): Next.js reverse proxy rewrites for `/api/*` requests.

---

## 2. Scope: Worker Backend (`workers/api`)

The backend is a serverless Hono application running on **Cloudflare Workers** with **Durable Objects**, **D1 SQL Database**, and **R2 Bucket Storage**.

### Variables & Secrets Summary

| Variable / Secret Name | Type | Secret? | Production Location | Local Dev Location | Description |
| :--- | :---: | :---: | :--- | :--- | :--- |
| `SESSION_ENCRYPTION_KEY` | Secret | **CRITICAL** | Cloudflare Dashboard / `wrangler secret` | `.dev.vars` | 256-bit hex key for Zero-Knowledge dual-key AES-GCM envelope encryption. |
| `MASTER_ENCRYPTION_KEY` | Secret | **CRITICAL** | Cloudflare Dashboard / `wrangler secret` | `.dev.vars` | 256-bit AES-GCM key for encrypting ledger event logs and channel sync state. |
| `TELEGRAM_API_ID` | Secret | **CRITICAL** | Cloudflare Dashboard / `wrangler secret` | `.dev.vars` | Official Telegram API ID from [my.telegram.org](https://my.telegram.org). |
| `TELEGRAM_API_HASH` | Secret | **CRITICAL** | Cloudflare Dashboard / `wrangler secret` | `.dev.vars` | Official Telegram API Hash from [my.telegram.org](https://my.telegram.org). |
| `ADMIN_TELEGRAM_USER_IDS` | Secret / Var | Optional | Cloudflare Dashboard / `wrangler secret` | `.dev.vars` | Comma-separated Telegram User IDs permitted for administrative routes. |
| `TELEGRAM_TEST_MODE` | Variable | No | `wrangler.jsonc` `vars` | `wrangler.jsonc` `vars` | Set to `"false"` for production Telegram MTProto DCs. |
| `ENABLE_TELEMETRY` | Variable | No | `wrangler.jsonc` `vars` | `wrangler.jsonc` `vars` | Set to `"true"` to enable DO streaming telemetry. |

### Cloudflare Resource Bindings (in `wrangler.jsonc`)

| Binding Name | Type | Config in `wrangler.jsonc` | Notes |
| :--- | :---: | :--- | :--- |
| `DB` | D1 Database | `database_name: "aetheroll-db"`, `database_id: "c43a6484-be96-49c4-8558-a8da284796a1"` | Stores user index & encrypted sessions. |
| `R2_BUCKET` | R2 Storage | `bucket_name: "aetheroll-media"` | Zero-egress thumbnail and stream cache. |
| `AUTH_DO` | Durable Object | `class_name: "TelegramAuthDO"` | Stateful MTProto sessions & WebSocket streams. |

### Where & How They Are Injected
1. **In Production (Cloudflare)**:
   * **Secrets**: Set via Cloudflare Dashboard under **Workers & Pages → `aetheroll` → Settings → Variables and Secrets**:
     * Add Secret `SESSION_ENCRYPTION_KEY` (Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
     * Add Secret `MASTER_ENCRYPTION_KEY` (Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
     * Add Secret `TELEGRAM_API_HASH`.
     * Add Secret `TELEGRAM_API_ID` (*Always save as Secret so `wrangler deploy` does not wipe it*).
     * Add Secret `ADMIN_TELEGRAM_USER_IDS` (e.g. `1139540899`).
   * *(Alternative via CLI)*:
     ```bash
     cd workers/api
     npx wrangler secret put SESSION_ENCRYPTION_KEY
     npx wrangler secret put MASTER_ENCRYPTION_KEY
     npx wrangler secret put TELEGRAM_API_HASH
     npx wrangler secret put TELEGRAM_API_ID
     npx wrangler secret put ADMIN_TELEGRAM_USER_IDS
     ```
   * *How injection works*: Cloudflare's runtime automatically exposes these under `c.env.<NAME>` and forwards them securely to Durable Objects.
2. **In Local Development**:
   * Create `workers/api/.dev.vars` (or root `.dev.vars`):
     ```ini
     TELEGRAM_API_ID="YOUR_TELEGRAM_API_ID"
     TELEGRAM_API_HASH="YOUR_TELEGRAM_API_HASH"
     SESSION_ENCRYPTION_KEY="64_CHAR_HEX_KEY"
     MASTER_ENCRYPTION_KEY="64_CHAR_HEX_KEY"
     ADMIN_TELEGRAM_USER_IDS="YOUR_TELEGRAM_ID"
     ```
   * *Wrangler automatically loads `.dev.vars` during `pnpm --filter @aetheroll/api dev`.*

### Code Files Using These Variables:
* [`workers/api/wrangler.jsonc`](file:///Users/shivareddy/Developer/telegram/workers/api/wrangler.jsonc): Defines worker topology, D1 database ID, R2 bindings, and Durable Object classes.
* [`workers/api/src/routes/auth/utils.ts`](file:///Users/shivareddy/Developer/telegram/workers/api/src/routes/auth/utils.ts): Dynamically scopes session cookies to the calling apex domain (`getApexDomain`).
* [`workers/api/src/durable_objects/auth/phoneAuthHandler.ts`](file:///Users/shivareddy/Developer/telegram/workers/api/src/durable_objects/auth/phoneAuthHandler.ts) & [`qrAuthHandler.ts`](file:///Users/shivareddy/Developer/telegram/workers/api/src/durable_objects/auth/qrAuthHandler.ts): Authenticates MTProto sessions and encrypts tokens.

---

## 3. Scope: Mobile Application (`apps/mobile`)

The mobile app is a React Native Android & iOS client built with Gradle and React Native New Architecture.

### Variables & Secrets Summary

| Variable / Secret Name | Scope | Secret? | Production Location | Local Dev Location | Description |
| :--- | :---: | :---: | :--- | :--- | :--- |
| `MOBILE_API_URL` | CI Build | Optional | GitHub Variables / Secrets | `apps/mobile/src/config/env.json` | Default remote API URL injected into the release APK. |
| `ANDROID_KEYSTORE_BASE64` | CI Build | **CRITICAL** | GitHub Repo Secrets | Local `release.keystore` | Base64-encoded production Android release keystore. |
| `ANDROID_KEYSTORE_PASSWORD` | CI Build | **CRITICAL** | GitHub Repo Secrets | Local `gradle.properties` | Password for the release keystore. |
| `ANDROID_KEY_ALIAS` | CI Build | **CRITICAL** | GitHub Repo Secrets | Local `gradle.properties` | Key alias in the release keystore. |
| `ANDROID_KEY_PASSWORD` | CI Build | **CRITICAL** | GitHub Repo Secrets | Local `gradle.properties` | Password for the release key alias. |

### Where & How They Are Injected
1. **In CI / CD (GitHub Actions Release Workflow)**:
   * Go to **GitHub Repository → Settings → Secrets and variables → Actions**.
   * Add Secrets:
     * `MOBILE_API_URL` (e.g. `https://aetheroll-api.builtbyshiva.com`)
     * `ANDROID_KEYSTORE_BASE64`
     * `ANDROID_KEYSTORE_PASSWORD`
     * `ANDROID_KEY_ALIAS`
     * `ANDROID_KEY_PASSWORD`
   * *How injection works*: [`.github/workflows/mobile-release.yml`](file:///Users/shivareddy/.github/workflows/mobile-release.yml) injects `MOBILE_API_URL` into `apps/mobile/src/config/env.json`, decodes the keystore onto the runner, and compiles `./gradlew assembleRelease`. It attaches both `aetheroll-mobile-<tag>.apk` and `aetheroll-mobile-latest.apk` to GitHub Releases.
2. **In-App Dynamic Setting**:
   * Users can tap the ⚙️ Settings icon on the login screen or gallery anytime to change the backend API URL without recompiling the APK.

### Code Files Using These Variables:
* [`apps/mobile/src/config/index.ts`](file:///Users/shivareddy/Developer/telegram/apps/mobile/src/config/index.ts): Mobile app configuration loader (`DEFAULT_API_URL`).
* [`apps/mobile/src/services/api.ts`](file:///Users/shivareddy/Developer/telegram/apps/mobile/src/services/api.ts): API requests and KeyStore-persisted backend URL.
* [`.github/workflows/mobile-release.yml`](file:///Users/shivareddy/Developer/telegram/.github/workflows/mobile-release.yml): Automated Android APK compilation, URL injection, and signing.

---

## Complete Variables Reference Matrix

| Variable | Scope | Required In Git? | Required In Production Dashboard? | Sensitivity Level |
| :--- | :--- | :---: | :---: | :--- |
| `NEXT_PUBLIC_REMOTE_API_URL` | Web | ❌ | ✅ Vercel | 🟢 Public URL |
| `NEXT_PUBLIC_SITE_URL` | Web | ❌ | ✅ Vercel | 🟢 Public URL |
| `SESSION_ENCRYPTION_KEY` | Worker | ❌ | ✅ Cloudflare | 🔴 Critical Secret |
| `TELEGRAM_API_ID` | Worker | ❌ | ✅ Cloudflare | 🟡 Private API Credential |
| `TELEGRAM_API_HASH` | Worker | ❌ | ✅ Cloudflare | 🔴 Critical Secret |
| `ADMIN_TELEGRAM_USER_IDS` | Worker | ❌ | ✅ Cloudflare | 🟡 Private Whitelist |
| `database_id` (`c43a6484...`) | Worker | ✅ `wrangler.jsonc` | Optional (Dashboard Binding) | 🟢 Safe UUID (Requires CF Auth) |
| `ANDROID_KEYSTORE_*` | Mobile CI | ❌ | ✅ GitHub Secrets | 🔴 Critical Signing Keys |
