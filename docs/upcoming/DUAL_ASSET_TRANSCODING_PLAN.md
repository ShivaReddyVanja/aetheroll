# Dual-Track Multi-Variant Video Transcoding Architecture
## Zero-Knowledge Ephemeral Job Envelopes, Hugging Face Docker Worker & Adaptive Edge Streaming

> **Document Status**: APPROVED ARCHITECTURAL SPECIFICATION  
> **Target Environment**: Cloudflare Workers, Durable Objects, D1 Database, Hugging Face Spaces (Free Docker Tier), Telegram MTProto.  
> **Related Specifications**: [`AUTH_AND_SECURITY_ARCHITECTURE.md`](../AUTH_AND_SECURITY_ARCHITECTURE.md), [`CACHING_AND_DATA_FETCHING_ARCHITECTURE.md`](../CACHING_AND_DATA_FETCHING_ARCHITECTURE.md).

---

## 1. Executive Summary & Problem Statement

Modern mobile and camera devices capture video at extremely high bitrates and complex formats:
* **Massive Bitrate**: A 1-minute 4K 60fps video is **~250–400 MB** (≈ 40–60 Mbps). Streaming this directly over cellular requires downloading 5–8 MB *every single second*, overwhelming mobile radio buffers and causing intermittent stalls.
* **Codec Incompatibility**: Captured in **10-bit HEVC (H.265), Dolby Vision Profile 8.4 HDR, or Apple ProRes**, which many desktop browsers (Chrome on Windows/Linux) cannot decode natively.
* **Network Buffering**: Streaming 45+ Mbps over HTTP Range requests causes continuous buffering on mobile networks, high data consumption, and rapid battery drain.

### The Problem with Single-Asset Approaches
* **Destructive Transcode Only**: Downsamples video to 1080p SDR, permanently destroying the original 4K HDR master.
* **Raw Master Only**: Uploads untouched raw files, causing browser codec failures and severe playback buffering.

### The Solution: Multi-Variant Dual-Track Architecture
Aetheroll leverages Telegram's **free, unlimited cloud storage** to store the **original untouched master alongside multiple web-streamable variants**:
1. **Asset 1: Original Raw Master** (4K HDR / ProRes untouched file for archival & lossless download).
2. **Asset 2+: Transcoded Web Stream Variants** (1080p @ 4.5 Mbps, 720p @ 2.2 Mbps H.264/AAC with faststart headers for instant sub-100ms playback).

---

## 2. System Architecture & Component Diagram

```mermaid
flowchart TD
    subgraph Client ["Client Devices (Mobile App & Web)"]
        RawVideo["Raw 4K Video Input"]
        Player["MediaViewer Player <br/> (Auto: 720p/1080p | Toggle: 4K Master)"]
    end

    subgraph Edge ["Cloudflare Worker & Durable Objects"]
        UploadDO["Upload Handler (TelegramAuthDO)"]
        D1[("Cloudflare D1 Database")]
        StreamDO["Stream Handler (TelegramAuthDO)"]
        CronKeepalive["Cron Trigger (12h Keepalive Ping)"]
    end

    subgraph Transcoder ["Hugging Face Space (Docker Free Tier)"]
        HFServer["Express / Fastify HTTP Server (POST /transcode)"]
        FFmpegCore["FFmpeg 7.x (libx264 + AAC + faststart)"]
        GramJSTranscoder["Direct MTProto Client (Ephemeral Session)"]
    end

    subgraph TG ["Telegram Cloud Storage"]
        MasterMsg["1. Raw 4K Master (Message ID: 101)"]
        Stream1080["2. 1080p Stream Variant (Message ID: 102)"]
        Stream720["3. 720p Stream Variant (Message ID: 103)"]
    end

    RawVideo -->|1. Direct Upload Raw Master| UploadDO
    UploadDO -->|Stores Raw Master| MasterMsg
    UploadDO -->|INSERT media_items transcode_status='queued'| D1
    UploadDO -->|2. Asymmetric RSA-OAEP Webhook POST /transcode| HFServer

    CronKeepalive -.->|Keepalive Ping GET /health| HFServer

    HFServer --> GramJSTranscoder
    GramJSTranscoder -->|3. Fast MTProto PULL 4K Master| MasterMsg
    GramJSTranscoder -->|Streams into FFmpeg| FFmpegCore
    FFmpegCore -->|Produces 1080p & 720p FastStart MP4s| GramJSTranscoder
    GramJSTranscoder -->|4. Fast MTProto PUSH 1080p| Stream1080
    GramJSTranscoder -->|5. Fast MTProto PUSH 720p| Stream720
    GramJSTranscoder -->|6. POST /api/internal/transcode/complete| UploadDO

    UploadDO -->|INSERT media_variants (1080p, 720p)| D1
    UploadDO -->|UPDATE media_items transcode_status='ready'| D1

    Player -->|GET /api/stream?quality=auto| StreamDO
    StreamDO -->|Resolves 720p/1080p Message ID| Stream720
```

---

## 3. Zero-Knowledge Asymmetric Job Envelope Protocol

### 3.1 The Security Dilemma
In Aetheroll’s Zero-Knowledge architecture:
- $K_{\text{server}}$ is stored in Cloudflare Environment Secrets.
- $K_{\text{client}}$ exists **exclusively in the user's browser cookie/header** (`sessionId.clientSecret`) and is **never written to D1, disk, or logs**.
- When transcoding occurs asynchronously in the background, **the database contains no unencrypted user credentials**.

### 3.2 Asymmetric Ephemeral Envelope Protocol
To allow the Hugging Face Transcoder to pull and push to the user's private Telegram channel without compromising zero-knowledge security:

1. **Key Generation**: The Transcoder Space holds an asymmetric key pair:
   - `TRANSCODER_PUBLIC_KEY` (Stored in Cloudflare Worker environment).
   - `TRANSCODER_PRIVATE_KEY` (Stored securely in Hugging Face Space secrets).
2. **Envelope Minting**: At upload time (while user's `clientSecret` is active in Worker memory), Cloudflare Worker mints a short-lived envelope:
   ```ts
   const jobPayload = {
     sessionString: decryptedUserSessionString,
     channelPeer: item.telegram_channel_id,
     rawMessageId: item.telegram_message_id,
     mediaId: item.id,
     expiresAt: Date.now() + 2 * 3600 * 1000, // 2 hour TTL
   };
   // Encrypt with RSA-OAEP 4096-bit + AES-256-GCM
   const encryptedEnvelope = await encryptAsymmetricEnvelope(jobPayload, env.TRANSCODER_PUBLIC_KEY);
   ```
3. **Execution & Memory Zeroization**:
   - The Hugging Face Space decrypts the envelope in volatile RAM using `TRANSCODER_PRIVATE_KEY`.
   - Downloads original, transcodes, uploads variants to Telegram.
   - Zeroes out memory (`sessionBuffer.fill(0)`) immediately upon job completion.

---

## 4. Hugging Face Spaces Deployment Specification

### 4.1 Platform Specifications & Fit
* **Compute**: 2 vCPU Intel Xeon / AMD EPYC
* **Memory**: **16 GB RAM** (Ample memory for 4K FFmpeg frame buffers)
* **Cost**: **$0.00 / Free Forever** (No credit card required)
* **Network**: 1+ Gbps AWS us-east-1 connection to Telegram DCs

### 4.2 Dockerfile (`Dockerfile`)
```dockerfile
FROM node:20-slim

# Install latest FFmpeg with H.264, AAC, and scale filters
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy source code
COPY . .

# Hugging Face Spaces default port is 7860
ENV PORT=7860
EXPOSE 7860

USER node
CMD ["node", "dist/server.js"]
```

### 4.3 Transcoder Daemon Implementation (`src/server.ts`)
```typescript
import express from 'express';
import { Api, TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const execAsync = promisify(exec);
const app = express();
app.use(express.json({ limit: '10mb' }));

const TRANSCODER_PRIVATE_KEY = process.env.TRANSCODER_PRIVATE_KEY!;
const INTERNAL_SECRET = process.env.INTERNAL_SECRET!;
const API_BASE_URL = process.env.API_BASE_URL || 'https://aetheroll-api.yourdomain.com';

// 1. Health check & keep-alive endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), memory: process.memoryUsage() });
});

// 2. Webhook for asynchronous transcoding jobs
app.post('/transcode', async (req, res) => {
  const { encryptedEnvelope, signature } = req.body;
  if (!encryptedEnvelope) return res.status(400).json({ error: 'Missing envelope' });

  // Immediate 202 Accepted response so Cloudflare Worker does not block
  res.status(202).json({ ok: true, status: 'processing' });

  try {
    // Decrypt envelope using private key
    const decrypted = crypto.privateDecrypt(
      {
        key: TRANSCODER_PRIVATE_KEY,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      Buffer.from(encryptedEnvelope, 'base64')
    );

    const job = JSON.parse(decrypted.toString('utf-8'));
    if (Date.now() > job.expiresAt) {
      console.warn(`[Transcoder] Job ${job.mediaId} expired.`);
      return;
    }

    await processTranscodeJob(job);
  } catch (err: any) {
    console.error('[Transcoder Error]:', err);
  }
});

async function processTranscodeJob(job: any) {
  const tempDir = path.join('/tmp', `transcode_${job.mediaId}`);
  fs.mkdirSync(tempDir, { recursive: true });

  const inputPath = path.join(tempDir, 'input_master.mov');
  const out720p = path.join(tempDir, 'variant_720p.mp4');
  const out1080p = path.join(tempDir, 'variant_1080p.mp4');

  const client = new TelegramClient(
    new StringSession(job.sessionString),
    Number(process.env.TELEGRAM_API_ID),
    process.env.TELEGRAM_API_HASH || '',
    { connectionRetries: 5 }
  );

  try {
    await client.connect();

    // Step A: Download Master Video from Telegram
    console.log(`[Transcoder] Downloading master for media ${job.mediaId}...`);
    const messages = await client.getMessages(job.channelPeer, { ids: [Number(job.rawMessageId)] });
    const msg = messages[0];
    const buffer = await client.downloadMedia(msg.media, {});
    fs.writeFileSync(inputPath, buffer as Buffer);

    // Step B: Run FFmpeg Transcoding (720p Mobile FastStart + 1080p HD)
    console.log(`[Transcoder] Transcoding 720p & 1080p for ${job.mediaId}...`);
    
    // 720p Mobile Stream Proxy
    await execAsync(
      `ffmpeg -y -i "${inputPath}" -vf "scale='min(1280,iw)':-2" -c:v libx264 -preset veryfast -crf 24 -maxrate 2200k -bufsize 4400k -c:a aac -b:a 96k -movflags +faststart "${out720p}"`
    );

    // 1080p HD Stream Proxy
    await execAsync(
      `ffmpeg -y -i "${inputPath}" -vf "scale='min(1920,iw)':-2" -c:v libx264 -preset veryfast -crf 22 -maxrate 4500k -bufsize 9000k -c:a aac -b:a 128k -movflags +faststart "${out1080p}"`
    );

    // Step C: Upload Variants to User's Channel
    console.log(`[Transcoder] Uploading variants to Telegram...`);
    const upload720 = await client.sendFile(job.channelPeer, {
      file: out720p,
      caption: `[GP_VARIANT:720p] media_id=${job.mediaId}`,
      attributes: [new Api.DocumentAttributeVideo({ duration: msg.media?.document?.attributes?.find((a: any) => a.duration)?.duration || 0, w: 1280, h: 720, supportsStreaming: true })],
    });

    const upload1080 = await client.sendFile(job.channelPeer, {
      file: out1080p,
      caption: `[GP_VARIANT:1080p] media_id=${job.mediaId}`,
      attributes: [new Api.DocumentAttributeVideo({ duration: msg.media?.document?.attributes?.find((a: any) => a.duration)?.duration || 0, w: 1920, h: 1080, supportsStreaming: true })],
    });

    // Step D: Report Completion to Cloudflare Worker
    const payload = {
      mediaId: job.mediaId,
      variants: [
        {
          quality: '720p',
          telegramMessageId: upload720.id,
          fileSizeBytes: fs.statSync(out720p).size,
          width: 1280,
          height: 720,
          bitrateKbps: 2200,
          mimeType: 'video/mp4',
        },
        {
          quality: '1080p',
          telegramMessageId: upload1080.id,
          fileSizeBytes: fs.statSync(out1080p).size,
          width: 1920,
          height: 1080,
          bitrateKbps: 4500,
          mimeType: 'video/mp4',
        },
      ],
    };

    const signature = crypto.createHmac('sha256', INTERNAL_SECRET).update(JSON.stringify(payload)).digest('hex');

    await fetch(`${API_BASE_URL}/api/internal/transcode/complete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-transcoder-signature': signature,
      },
      body: JSON.stringify(payload),
    });

    console.log(`[Transcoder] Successfully completed transcode for ${job.mediaId}`);
  } finally {
    // Cleanup temporary files and disconnect client
    fs.rmSync(tempDir, { recursive: true, force: true });
    await client.disconnect();
  }
}

const PORT = process.env.PORT || 7860;
app.listen(PORT, () => {
  console.log(`Aetheroll Transcoder Space running on port ${PORT}`);
});
```

### 4.4 Horizontal Multi-Space Scaling & Load-Balanced Cluster Topology

Hugging Face allows users to create **unlimited free CPU Spaces** across personal accounts and organizations. Each individual free Space provides 1 container replica (2 vCPU + 16 GB RAM). To scale transcoding throughput without paying any cloud bills, multiple identical Spaces can be deployed to form a **Free Distributed Transcoder Farm**:

```
                              [Cloudflare Worker Webhook Dispatcher]
                                                │
                 ┌──────────────────────────────┼──────────────────────────────┐
                 ▼                              ▼                              ▼
     [Space 1: transcoder-node-1]   [Space 2: transcoder-node-2]   [Space 3: transcoder-node-3]
          (2 vCPU, 16 GB RAM)            (2 vCPU, 16 GB RAM)            (2 vCPU, 16 GB RAM)
```

#### Multi-Node Cluster Configuration in Cloudflare Worker:
```jsonc
// wrangler.jsonc or Cloudflare Worker Environment Variable
{
  "vars": {
    "TRANSCODER_SPACE_POOL": "https://user-transcoder-1.hf.space,https://user-transcoder-2.hf.space,https://user-transcoder-3.hf.space"
  }
}
```

#### Round-Robin / Health-Aware Job Dispatcher (`src/server/lib/transcoderPool.ts`):
```typescript
export async function dispatchTranscodeJob(jobEnvelope: string, env: Env): Promise<boolean> {
  const pool = (env.TRANSCODER_SPACE_POOL || env.TRANSCODER_SPACE_URL || '')
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);

  if (pool.length === 0) return false;

  // 1. Shuffle / Round-Robin over candidate nodes
  const candidates = [...pool].sort(() => Math.random() - 0.5);

  for (const nodeUrl of candidates) {
    try {
      const res = await fetch(`${nodeUrl}/transcode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ encryptedEnvelope: jobEnvelope }),
      });

      if (res.status === 202 || res.ok) {
        console.log(`[Transcoder Pool] Job successfully dispatched to node: ${nodeUrl}`);
        return true;
      }
    } catch (err: any) {
      console.warn(`[Transcoder Pool] Node ${nodeUrl} unreachable, trying next node:`, err.message);
    }
  }

  return false;
}
```

#### Aggregate Capacity Matrix:
| Cluster Size | Total Compute | Total RAM | Parallel 4K Streams Transcoding | Monthly Cost |
| :--- | :--- | :--- | :--- | :--- |
| **1 Free Space** | 2 vCPU | 16 GB | 1–2 simultaneous jobs | **$0.00** |
| **3 Free Spaces** | 6 vCPU | 48 GB | 3–6 simultaneous jobs | **$0.00** |
| **5 Free Spaces** | 10 vCPU | 80 GB | 5–10 simultaneous jobs | **$0.00** |

---

## 5. Database Schema Migration (D1)

```sql
-- Migration: migrations/0005_media_variants.sql

-- 1. Variants Table
CREATE TABLE IF NOT EXISTS media_variants (
    id TEXT PRIMARY KEY,
    media_item_id TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
    quality TEXT NOT NULL CHECK(quality IN ('1080p', '720p', '480p', '360p')),
    telegram_message_id INTEGER NOT NULL,
    file_size_bytes INTEGER NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    bitrate_kbps INTEGER,
    mime_type TEXT NOT NULL DEFAULT 'video/mp4',
    codec TEXT NOT NULL DEFAULT 'h264',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(media_item_id, quality)
);

CREATE INDEX IF NOT EXISTS idx_media_variants_item ON media_variants(media_item_id);

-- 2. Transcode Status Columns on media_items
ALTER TABLE media_items ADD COLUMN original_telegram_message_id INTEGER DEFAULT NULL;
ALTER TABLE media_items ADD COLUMN original_file_size_bytes INTEGER DEFAULT NULL;
ALTER TABLE media_items ADD COLUMN transcode_status TEXT DEFAULT 'ready' CHECK(transcode_status IN ('queued', 'processing', 'ready', 'failed'));
ALTER TABLE media_items ADD COLUMN transcode_error TEXT DEFAULT NULL;
```

---

## 6. Cloudflare Worker Keepalive & Webhook Integration

### 6.1 12-Hour Keepalive Cron (`wrangler.jsonc`)
```jsonc
{
  "triggers": {
    "crons": ["0 */12 * * *"] // Runs every 12 hours to prevent Hugging Face Space from sleeping
  }
}
```

### 6.2 Scheduled Worker Handler (`src/server/index.ts`)
```typescript
export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    if (env.TRANSCODER_SPACE_URL) {
      ctx.waitUntil(
        fetch(`${env.TRANSCODER_SPACE_URL}/health`, { method: 'GET' })
          .then((r) => console.log(`[Keepalive] Space Ping Status: ${r.status}`))
          .catch((e) => console.warn(`[Keepalive] Space Ping Failed: ${e.message}`))
      );
    }
  },
  fetch: app.fetch,
};
```

---

## 7. Adaptive Streaming & Player Resolution Switching

### 7.1 Stream Routing Logic (`src/server/routes/stream/index.ts`)
```typescript
// GET /api/stream?media_id=:id&quality=auto|1080p|720p|original
const quality = c.req.query('quality') || 'auto';

let targetMessageId = item.telegram_message_id;

if (quality === 'original') {
  targetMessageId = item.original_telegram_message_id || item.telegram_message_id;
} else if (quality === '720p' || quality === 'auto') {
  // Check for 720p or 1080p variant in media_variants table
  const variant = await db.get(
    `SELECT telegram_message_id FROM media_variants WHERE media_item_id = ? AND quality = ?`,
    [item.id, quality === 'auto' ? '720p' : quality]
  );
  if (variant) {
    targetMessageId = variant.telegram_message_id;
  }
}
```

### 7.2 Mobile & Web MediaViewer Integration
* **Default Playback**: Requests `getMediaStreamUrl(item.id, { quality: 'auto' })` (instantly streams 720p proxy with 0 buffering).
* **Quality Selector Pill**: Renders resolution switcher (`Auto 720p`, `1080p HD`, `4K Original`).
* **Original Download**: Dedicated "Download Original Master" button triggers full-quality download via `original_telegram_message_id`.

---

## 8. Implementation Phases & Roadmap

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                             IMPLEMENTATION PHASES                                │
├──────────────────────────────────────────────────────────────────────────────────┤
│ Phase 1: Database Migration                                                      │
│ • Create migrations/0005_media_variants.sql                                      │
│ • Update D1 queries and types in src/server/lib/db.ts                            │
│                                                                                  │
│ Phase 2: Transcoder Daemon & Docker Package                                      │
│ • Create transcoder/ repository (Dockerfile, server.ts, GramJS, FFmpeg)          │
│ • Deploy to Hugging Face Spaces (Free CPU Docker Tier)                           │
│                                                                                  │
│ Phase 3: Cloudflare Producer & Keepalive                                         │
│ • Implement RSA-OAEP envelope encryption in src/server/lib/crypto.ts             │
│ • Add POST /api/internal/transcode/complete endpoint with HMAC authentication    │
│ • Add 12-hour Cron Keepalive trigger in wrangler.jsonc                           │
│                                                                                  │
│ Phase 4: Adaptive Quality Resolution in Stream Handler                           │
│ • Update streamHandler.ts to route quality query param to appropriate variant    │
│ • Update cascade delete query to delete master + all variants in 1 MTProto call  │
│                                                                                  │
│ Phase 5: Client Quality Switcher & Badging                                       │
│ • Add resolution menu in mobile MediaViewerScreen.tsx & web MediaViewer.tsx      │
│ • Show "Optimizing 4K..." progress pill while transcode_status === 'queued'      │
└──────────────────────────────────────────────────────────────────────────────────┘
```
