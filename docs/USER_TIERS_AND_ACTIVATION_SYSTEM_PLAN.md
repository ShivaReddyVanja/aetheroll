# 💎 Aetheroll User Tiers & Activation System Architecture Plan

---

## 1. Executive Summary & Philosophy

Aetheroll offers unlimited photo and video backup by utilizing private Telegram channels as storage vaults. However, features like **Cloudflare Turbo Streaming**, **Cloudflare Direct Uploads**, and **Public Media Link Sharing** utilize Cloudflare Durable Objects, Edge Caching, and outbound bandwidth.

To make the platform sustainable, we are implementing a strict **2-Tier Model (Free vs Premium)** with an **exclusive invite/activation code gating system**:

* **Free Tier (Zero Infrastructure Cost):**
  - **Storage:** Unlimited (Telegram Vault).
  - **Uploads:** Locked to **Telegram MTProto Direct Uploads**.
  - **Streaming:** Locked to **Telegram MTProto Direct Streaming**.
  - **Media Sharing (Public Links):** 🔒 **Locked (Pro Exclusive)**.
  - **Engine Mode Switches:** 🔒 **Locked (View Only)**.
* **Premium / Pro Tier (Edge-Accelerated Power User):**
  - **Storage:** Unlimited (Telegram Vault).
  - **Streaming:** Default to **⚡ Cloudflare Turbo Edge (< 3ms PoP latency, cached multi-threaded DO streaming)**.
  - **Uploads:** Default to **Telegram MTProto Direct Uploads**, with user option to toggle **Cloudflare Turbo Multi-Part Uploads**.
  - **Media Sharing (Public Links):** 🔓 **Unlimited Zero-Knowledge Public Video & Photo Sharing** with social preview tags & PiP player.
  - **Engine Mode Switches:** 🔓 **Fully Configurable**.

---

## 2. Complete Tier Feature Matrix

| Feature | Free Tier 🆓 | Premium / Pro Tier ⚡ |
| :--- | :--- | :--- |
| **Cloud Storage** | Unlimited (Telegram) | Unlimited (Telegram) |
| **Default Upload Engine** | Telegram MTProto Direct | Telegram MTProto Direct |
| **Cloudflare Turbo Uploads** | ❌ 🔒 Locked | ✅ 🔓 Configurable Toggle |
| **Default Video Streaming** | Telegram MTProto Streaming | ⚡ **Cloudflare Turbo Edge Streaming** |
| **Public Media Sharing (Links)** | ❌ 🔒 **Locked to Pro** | ⚡ **Full Access (Social Previews + PiP Player)** |
| **Engine Mode Selector** | 🔒 Locked / Read-Only | 🔓 Fully Configurable |
| **4K Video Scrubbing & Playback** | Standard Telegram Rate (~1-2 MB/s) | Turbo Multi-Worker Edge (~15-30 MB/s) |
| **Cost to Infrastructure** | **\$0.00 / user / month** | Covered by Access Grant / Code |

---

## 3. Architecture for Gating & Access Approval

To avoid public abuse while keeping onboarding smooth and personal, we use a **Hybrid Gating Engine**:

```mermaid
flowchart TD
    User([User Downloads & Logs In]) --> Free[Assigned 'Free' Tier]
    
    subgraph Free Experience
        Free --> FreeStream[Telegram Direct Streaming]
        Free --> FreeUpload[Telegram Direct Uploads]
        Free --> LockedShare[Share Button -> Opens 'Unlock Pro' Modal]
    end
    
    subgraph Upgrade Pathways
        Free -->|Method 1: Enter Promo Code| RedeemAPI[POST /api/tier/redeem]
        Free -->|Method 2: Tap 'Request Pro Access'| RequestAPI[POST /api/tier/request]
    end
    
    RedeemAPI -->|Valid Code?| D1_Update[(Update User Tier in D1 SQL)]
    RequestAPI -->|Send Telegram Alert| AdminBot[Admin Telegram Bot]
    
    AdminBot -->|Admin taps Inline Button [Approve]| Webhook[Bot Webhook Callback]
    Webhook --> D1_Update
    
    D1_Update -->|tier = 'premium'| ProState[⚡ Active Pro Account]
    
    subgraph Pro Experience
        ProState --> TurboStream[Cloudflare Turbo Edge Streaming]
        ProState --> TurboUpload[Optional Cloudflare Turbo Uploads]
        ProState --> FullShare[Public Web Video Sharing /v/:id]
    end
```

### Pathway 1: Redeemable Activation Codes (`PRO-XXXX-XXXX`)
* **How it works:** You run a simple command (e.g. `pnpm run generate-codes --count 10 --days 365`) to create cryptographic activation codes.
* **Usage:** You hand codes to friends, beta testers, VIPs, or social followers.
* **Redemption:** The user pastes the code into the app's **"Redeem Code"** dialog $\rightarrow$ instantly unlocked.

### Pathway 2: 1-Tap Telegram Admin Bot Approval (Zero-Code Workflow)
* **How it works:** In the app, a free user taps **"Request Pro Access"**.
* **Telegram Notification:** Your Telegram Bot instantly sends you a private Telegram message:
  ```text
  👤 New Pro Access Request
  User: Shiva Reddy (@shivareddy)
  Telegram ID: 123456789
  Account Created: Sep 28, 2026
  
  [ ✅ Approve Lifetime Pro ]  [ ⏱ Approve 30 Days ]  [ ❌ Decline ]
  ```
* **Instant Activation:** Tapping `[ Approve Lifetime Pro ]` directly executes an API callback that updates the user's tier in the Cloudflare D1 database. Next time they open the app (or within seconds via WebSocket), Pro is active!

---

## 4. Detailed Component Implementation Plan

### Component 1: Database Migration (`migrations/0007_user_tiers_and_codes.sql`)

```sql
-- 1. Add Tier Fields to Users Table
ALTER TABLE users ADD COLUMN tier TEXT DEFAULT 'free' CHECK (tier IN ('free', 'premium', 'admin'));
ALTER TABLE users ADD COLUMN tier_expires_at TIMESTAMP NULL;
ALTER TABLE users ADD COLUMN tier_granted_by TEXT NULL;

-- 2. Activation / Promo Codes Table
CREATE TABLE IF NOT EXISTS activation_codes (
    code            TEXT PRIMARY KEY,                  -- e.g. 'PRO-2026-ALPHA', 'VIP-SHIVA-99'
    tier            TEXT NOT NULL DEFAULT 'premium',   -- Tier granted upon redemption
    duration_days   INTEGER DEFAULT NULL,              -- NULL = Lifetime, 30 = 1 month, 365 = 1 year
    max_uses        INTEGER DEFAULT 1,                 -- Max redemption count (1 = single-use)
    times_used      INTEGER DEFAULT 0,
    is_active       INTEGER DEFAULT 1,
    note            TEXT NULL,                         -- e.g. 'Given to John'
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at      TIMESTAMP NULL
);

-- 3. Redemption History Audit Table
CREATE TABLE IF NOT EXISTS code_redemptions (
    id              TEXT PRIMARY KEY,
    code            TEXT NOT NULL,
    user_id         TEXT NOT NULL,
    redeemed_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(code) REFERENCES activation_codes(code),
    FOREIGN KEY(user_id) REFERENCES users(id),
    UNIQUE(code, user_id)
);

CREATE INDEX IF NOT EXISTS idx_users_tier ON users(tier);
CREATE INDEX IF NOT EXISTS idx_codes_active ON activation_codes(is_active);
```

---

### Component 2: Backend Tier Enforcement & Endpoints

#### 1. Public Media Share Creation Lockdown (`workers/api/src/durable_objects/shares/shareHandler.ts`)
```typescript
// Inside handleCreateShare() before creating bot-relayed share:
const userRow = await db.get(`SELECT tier, tier_expires_at FROM users WHERE id = ?`, [userId]);
const isPro = userRow && (userRow.tier === "premium" || userRow.tier === "admin");
const isExpired = userRow?.tier_expires_at && new Date(userRow.tier_expires_at).getTime() < Date.now();

if (!isPro || isExpired) {
  return new Response(
    JSON.stringify({
      success: false,
      error: "UPGRADE_REQUIRED",
      message: "Public link sharing is exclusively available to Pro members.",
    }),
    { status: 403, headers: { "Content-Type": "application/json" } }
  );
}
```

#### 2. Streaming & Uploads Tier Enforcement (`workers/api/src/lib/tierGuard.ts`)
* **Streaming (`/api/stream`):**
  * If a `free` tier user requests Cloudflare Turbo Edge, rewrite or redirect to direct Telegram MTProto streaming.
* **Uploads (`/api/media/upload`):**
  * If a `free` tier user attempts Cloudflare Turbo uploads, reject with HTTP 403 (`UPGRADE_REQUIRED`).

#### 3. Redemption Endpoint (`POST /api/tier/redeem`)
* Input: `{ "code": "PRO-XXXX-XXXX" }`
* Flow:
  1. Validates code in `activation_codes` (`is_active = 1`, `times_used < max_uses`).
  2. Updates `users.tier = 'premium'` and calculates `tier_expires_at`.
  3. Increments `times_used` and logs into `code_redemptions`.
  4. Returns `{ success: true, tier: "premium", expires_at: "..." }`.

#### 4. Pro Access Request Endpoint (`POST /api/tier/request`)
* Sends Telegram Bot alert with inline keyboard buttons to your admin Telegram chat ID.

---

### Component 3: Frontend (Web & Mobile) UI/UX Integration

#### 1. Media Viewer Share Button (`MediaViewer.tsx` & `MediaViewerScreen.tsx`)
* **Free User Experience:**
  * The Share button displays a small `🔒 PRO` badge.
  * Clicking the Share button does **not** call the API. Instead, it opens the **"Upgrade to Pro"** modal:
    * *"Public link sharing with custom 4K web player & Picture-in-Picture is a Pro feature."*
    * Quick buttons: `[ Enter Promo Code ]` and `[ Request Access ]`.
* **Pro User Experience:**
  * Clean, seamless 1-click link creation & copy to clipboard.

#### 2. Settings Screen Engine Toggles (`SettingsScreen.tsx` & `SettingsModal.tsx`)
* **Free User Experience:**
  * Engine switches are disabled/locked to "Telegram MTProto".
  * Clicking the locked selector opens the Redeem/Request Access sheet.
* **Pro User Experience:**
  * Full freedom to toggle between Cloudflare Turbo Edge and Telegram MTProto.

#### 3. Profile Badge
* User profile displays an eye-catching `⚡ PRO` badge (Emerald/Indigo pill) when active, and a subtle `Free Plan` pill when on free.

---

### Component 4: Admin CLI Code Generator (`scripts/generate-codes.mjs`)

A simple CLI utility you can run anytime:
```bash
# Generate 5 single-use 1-year codes
node scripts/generate-codes.mjs --count 5 --days 365 --note "Twitter Giveaway"

# Generate 1 multi-use lifetime code for friends
node scripts/generate-codes.mjs --code "VIP-FRIENDS-2026" --uses 20 --lifetime
```

---

## 5. Execution Roadmap

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ PHASE 1: Database & Tier Guard Middleware                               │
│ - Run migration 0007_user_tiers_and_codes.sql                           │
│ - Add tier check to ShareHandler.ts & createShare.ts (403 if Free)      │
│ - Implement POST /api/tier/redeem & POST /api/tier/request              │
├─────────────────────────────────────────────────────────────────────────┤
│ PHASE 2: Admin Telegram Bot Approval                                    │
│ - Connect Telegram bot notification for Pro requests                    │
│ - Handle inline button callback query to upgrade user in D1             │
├─────────────────────────────────────────────────────────────────────────┤
│ PHASE 3: Web App UI/UX                                                  │
│ - Update MediaViewer.tsx: Lock Share button for Free users              │
│ - Update SettingsModal.tsx: Lock Turbo mode & add Redeem Code form      │
│ - Add Pro badge to Header / Profile                                     │
├─────────────────────────────────────────────────────────────────────────┤
│ PHASE 4: Mobile App UI/UX                                               │
│ - Update MediaViewerScreen.tsx: Lock Share button for Free users        │
│ - Update SettingsScreen.tsx: Lock engine toggles & add Pro unlock sheet │
│ - Add Pro badge to user card                                            │
├─────────────────────────────────────────────────────────────────────────┤
│ PHASE 5: Admin Tooling                                                  │
│ - Add scripts/generate-codes.mjs for batch code creation                │
└─────────────────────────────────────────────────────────────────────────┘
```
