import { Hono } from "hono";
import { getDb } from "../../lib/db";
import { BRAND_NAME } from "@aetheroll/types";

export const viewSharePageRoute = new Hono();

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function formatDuration(seconds?: number | null): string {
  if (!seconds || seconds <= 0) return "";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * GET /v/:shareId
 * Standalone, ultra-fast serverless media player page served directly by the Cloudflare Worker.
 * Fully supports Picture-in-Picture (PiP), background playback, and complete social video metadata
 * for rich inline previews on WhatsApp, Telegram, Twitter/X, Discord, and iMessage.
 */
viewSharePageRoute.get("/v/:shareId", async (c) => {
  const shareId = c.req.param("shareId");
  if (!shareId) {
    return c.text("Share ID required", 400);
  }

  const db = getDb((c.env as any)?.DB);
  const share = await db.get(
    `SELECT s.*, m.file_type, m.width, m.height, m.blur_hash, m.thumbnail_r2_key, m.created_at as media_created_at
     FROM media_shares s
     JOIN media_items m ON m.id = s.media_id
     WHERE s.id = ? AND s.is_revoked = 0 AND (s.expires_at IS NULL OR s.expires_at > CURRENT_TIMESTAMP)`,
    [shareId]
  );

  const origin = new URL(c.req.url).origin;
  const brand = BRAND_NAME || "Aetheroll";

  if (!share) {
    const expiredHtml = `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Link Expired | ${brand}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { background-color: #09090b; color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  </style>
</head>
<body class="min-h-screen flex items-center justify-center p-6">
  <div class="max-w-md w-full text-center space-y-6 bg-zinc-900/60 p-8 rounded-2xl border border-zinc-800/80 backdrop-blur-xl shadow-2xl">
    <div class="w-16 h-16 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-400 mx-auto flex items-center justify-center">
      <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
    </div>
    <div class="space-y-2">
      <h1 class="text-2xl font-bold tracking-tight text-white">Link Expired or Revoked</h1>
      <p class="text-sm text-zinc-400 leading-relaxed">
        This shared media link is no longer available. The owner may have revoked access or the link has reached its expiration limit.
      </p>
    </div>
  </div>
</body>
</html>`;
    return c.html(expiredHtml, 404);
  }

  const isVideo = share.mime_type?.startsWith("video/") || share.file_type === "video";
  const title = escapeHtml(share.title || (isVideo ? "Shared Video" : "Shared Photo"));
  const streamUrl = `${origin}/api/stream/public/${encodeURIComponent(share.id)}`;
  const thumbnailUrl = share.thumbnail_r2_key ? `${origin}/api/media/${encodeURIComponent(share.media_id)}/thumbnail` : "";
  const sizeText = formatBytes(Number(share.file_size_bytes));
  const durationText = formatDuration(share.duration_seconds);
  const dateText = new Date(share.created_at).toLocaleDateString(undefined, { dateStyle: "long" });
  const width = Number(share.width) || 1920;
  const height = Number(share.height) || 1080;
  const mimeType = escapeHtml(share.mime_type || (isVideo ? "video/mp4" : "image/jpeg"));

  const html = `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} | ${brand}</title>
  
  <!-- Primary Meta Tags -->
  <meta name="title" content="${title} | ${brand}">
  <meta name="description" content="Watch ${title} in full original resolution on ${brand}.">

  <!-- OpenGraph / Facebook / WhatsApp / Telegram / Discord -->
  <meta property="og:site_name" content="${brand}">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="Watch ${title} in full original resolution on ${brand}.">
  <meta property="og:url" content="${origin}/v/${share.id}">
  <meta property="og:type" content="${isVideo ? "video.other" : "image"}">
  ${thumbnailUrl ? `<meta property="og:image" content="${thumbnailUrl}">
  <meta property="og:image:secure_url" content="${thumbnailUrl}">
  <meta property="og:image:type" content="image/jpeg">
  <meta property="og:image:width" content="${width}">
  <meta property="og:image:height" content="${height}">` : ""}
  
  ${
    isVideo
      ? `<!-- WhatsApp / Telegram Video Stream Direct Embed -->
  <meta property="og:video" content="${streamUrl}">
  <meta property="og:video:secure_url" content="${streamUrl}">
  <meta property="og:video:type" content="${mimeType}">
  <meta property="og:video:width" content="${width}">
  <meta property="og:video:height" content="${height}">
  ${share.duration_seconds ? `<meta property="video:duration" content="${Math.round(share.duration_seconds)}">` : ""}`
      : ""
  }

  <!-- Twitter / X Card -->
  <meta name="twitter:card" content="${isVideo ? "player" : "summary_large_image"}">
  <meta name="twitter:site" content="@${brand}">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="Watch ${title} in full original resolution on ${brand}.">
  ${thumbnailUrl ? `<meta name="twitter:image" content="${thumbnailUrl}">` : ""}
  ${
    isVideo
      ? `<meta name="twitter:player" content="${origin}/v/${share.id}">
  <meta name="twitter:player:width" content="${width}">
  <meta name="twitter:player:height" content="${height}">
  <meta name="twitter:player:stream" content="${streamUrl}">
  <meta name="twitter:player:stream:content_type" content="${mimeType}">`
      : ""
  }

  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { background-color: #09090b; color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    video::-webkit-media-controls-picture-in-picture-button { display: inline-block !important; }
  </style>
</head>
<body class="min-h-screen flex flex-col selection:bg-indigo-500 selection:text-white">
  <!-- Top Navigation Bar -->
  <header class="h-16 px-4 md:px-8 border-b border-zinc-900/80 bg-zinc-950/80 backdrop-blur-xl flex items-center justify-between sticky top-0 z-30">
    <div class="flex items-center gap-2.5">
      <div class="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-500 to-violet-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
        <svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"/></svg>
      </div>
      <div class="flex flex-col">
        <span class="font-bold text-sm tracking-tight text-white">${brand}</span>
        <span class="text-[10px] text-zinc-400 -mt-0.5">Zero-Knowledge Cloud</span>
      </div>
    </div>

    <div class="flex items-center gap-2 md:gap-3">
      ${
        isVideo
          ? `<button
              id="pip-btn"
              onclick="togglePiP()"
              class="hidden md:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-medium text-zinc-300 hover:text-white transition-all shadow-sm"
              title="Picture in Picture"
            >
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/></svg>
              <span>Pop Out</span>
            </button>`
          : ""
      }
      <a
        href="${streamUrl}"
        download
        class="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-medium text-white transition-all shadow-sm shadow-indigo-600/30"
      >
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
        <span>Download</span>
      </a>
    </div>
  </header>

  <!-- Player Main Container -->
  <main class="flex-1 max-w-5xl w-full mx-auto p-4 md:p-8 flex flex-col gap-6">
    <div class="relative w-full aspect-video md:aspect-[16/9] max-h-[75vh] bg-black rounded-2xl overflow-hidden border border-zinc-800/80 shadow-2xl flex items-center justify-center">
      ${
        isVideo
          ? `<video
              id="main-video"
              src="${streamUrl}"
              controls
              autoplay
              playsinline
              webkit-playsinline
              x5-playsinline
              preload="auto"
              ${thumbnailUrl ? `poster="${thumbnailUrl}"` : ""}
              class="w-full h-full object-contain"
            >
              Your browser does not support HTML5 video playback.
            </video>`
          : `<img
              src="${streamUrl}"
              alt="${title}"
              class="w-full h-full object-contain"
            />`
      }
    </div>

    <!-- Metadata & Details -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div class="md:col-span-2 bg-zinc-900/40 p-6 rounded-2xl border border-zinc-800/60 backdrop-blur-sm space-y-4">
        <div class="space-y-1">
          <h1 class="text-xl md:text-2xl font-semibold tracking-tight text-white">${title}</h1>
          <p class="text-xs text-zinc-400">Shared on ${dateText}</p>
        </div>

        <div class="flex flex-wrap items-center gap-2.5 pt-2">
          <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-zinc-800/80 border border-zinc-700/50 text-xs text-zinc-300">
            ${isVideo ? "🎬 Stream" : "🖼️ Photo"}
          </span>
          ${
            durationText
              ? `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-zinc-800/80 border border-zinc-700/50 text-xs text-zinc-300">
                  ⏱️ ${durationText}
                </span>`
              : ""
          }
          <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-zinc-800/80 border border-zinc-700/50 text-xs text-zinc-300">
            💾 ${sizeText}
          </span>
          ${
            share.width && share.height
              ? `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-zinc-800/80 border border-zinc-700/50 text-xs text-zinc-300">
                  📐 ${share.width} × ${share.height}
                </span>`
              : ""
          }
        </div>
      </div>

      <div class="bg-zinc-900/40 p-6 rounded-2xl border border-zinc-800/60 backdrop-blur-sm flex flex-col justify-between space-y-4">
        <div class="space-y-2">
          <div class="flex items-center gap-2 text-emerald-400 font-medium text-xs">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg>
            <span>Zero-Knowledge Relay</span>
          </div>
          <p class="text-xs text-zinc-400 leading-relaxed">
            Delivered via Cloudflare Edge with fast segment streaming. The owner&apos;s Telegram identity is completely isolated.
          </p>
        </div>
      </div>
    </div>
  </main>

  <script>
    const video = document.getElementById("main-video");
    const pipBtn = document.getElementById("pip-btn");
    
    if (video && document.pictureInPictureEnabled && pipBtn) {
      pipBtn.classList.remove("hidden");
    }

    async function togglePiP() {
      try {
        if (!video) return;
        if (document.pictureInPictureElement) {
          await document.exitPictureInPicture();
        } else {
          await video.requestPictureInPicture();
        }
      } catch (err) {
        console.warn("Picture in picture failed:", err);
      }
    }
  </script>
</body>
</html>`;

  return c.html(html);
});
