import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Film, Image as ImageIcon, Download, ShieldCheck, Clock, AlertCircle, Share2, Sparkles } from "lucide-react";
import { getApiBaseUrl, getPublicStreamUrl } from "@/lib/config";
import { BRAND_NAME } from "@/lib/brand";
import type { PublicShareInfo } from "@aetheroll/types";

interface PageProps {
  params: Promise<{ shareId: string }>;
}

async function getShareInfo(shareId: string): Promise<PublicShareInfo | null> {
  try {
    const baseUrl = getApiBaseUrl(true) || "https://aetheroll-api.builtbyshiva.com";
    const res = await fetch(`${baseUrl}/api/shares/info/${encodeURIComponent(shareId)}`, {
      cache: "no-store",
    });

    if (!res.ok) return null;
    const data = await res.json();
    return data.success ? data.info : null;
  } catch (err) {
    console.error("[SharePage] Fetch info error:", err);
    return null;
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { shareId } = await params;
  const info = await getShareInfo(shareId);

  if (!info) {
    return {
      title: `Shared Video — ${BRAND_NAME}`,
      description: "Private shared media link",
    };
  }

  const isVideo = info.file_type === "video";
  const title = info.title || (isVideo ? "Shared Video" : "Shared Photo");
  const description = `Watch "${title}" in full 4K resolution on ${BRAND_NAME}.`;

  return {
    title: `${title} | ${BRAND_NAME}`,
    description,
    openGraph: {
      title,
      description,
      type: isVideo ? "video.other" : "article",
      videos: isVideo ? [{ url: info.stream_url, type: info.mime_type || "video/mp4" }] : undefined,
      images: info.thumbnail_url ? [{ url: info.thumbnail_url }] : undefined,
    },
    twitter: {
      card: isVideo ? "player" : "summary_large_image",
      title,
      description,
    },
  };
}

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

export default async function PublicSharePage({ params }: PageProps) {
  const { shareId } = await params;
  const info = await getShareInfo(shareId);

  if (!info) {
    return (
      <main className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center p-6 selection:bg-indigo-500 selection:text-white">
        <div className="max-w-md w-full text-center space-y-6 bg-zinc-900/60 p-8 rounded-2xl border border-zinc-800/80 backdrop-blur-xl shadow-2xl">
          <div className="w-16 h-16 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-400 mx-auto flex items-center justify-center">
            <AlertCircle className="w-8 h-8" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-bold tracking-tight text-white">Link Expired or Revoked</h1>
            <p className="text-sm text-zinc-400 leading-relaxed">
              This shared link is no longer available. The owner may have revoked access or the link reached its expiration limit.
            </p>
          </div>
          <Link
            href="/"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-sm font-medium text-white transition-colors"
          >
            Go to Aetheroll Home
          </Link>
        </div>
      </main>
    );
  }

  const isVideo = info.file_type === "video";
  const streamUrl = getPublicStreamUrl(shareId);

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col selection:bg-indigo-500 selection:text-white">
      {/* Top Header */}
      <header className="h-16 px-4 md:px-8 border-b border-zinc-900/80 bg-zinc-950/80 backdrop-blur-xl flex items-center justify-between sticky top-0 z-30">
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-500 to-violet-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div className="flex flex-col">
            <span className="font-bold text-sm tracking-tight text-white group-hover:text-indigo-400 transition-colors">
              {BRAND_NAME}
            </span>
            <span className="text-[10px] text-zinc-400 -mt-0.5">Zero-Knowledge Cloud</span>
          </div>
        </Link>

        <div className="flex items-center gap-3">
          <a
            href={streamUrl}
            download
            className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-medium text-zinc-200 hover:text-white transition-all shadow-sm"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download</span>
          </a>
        </div>
      </header>

      {/* Main Player Viewport */}
      <div className="flex-1 max-w-6xl w-full mx-auto p-4 md:p-8 flex flex-col gap-6">
        <div className="relative w-full aspect-video md:aspect-[16/9] max-h-[75vh] bg-black rounded-2xl overflow-hidden border border-zinc-800/80 shadow-2xl flex items-center justify-center">
          {isVideo ? (
            <video
              src={streamUrl}
              controls
              playsInline
              preload="auto"
              poster={info.thumbnail_url}
              className="w-full h-full object-contain"
            >
              Your browser does not support HTML5 video playback.
            </video>
          ) : (
            <img
              src={streamUrl}
              alt={info.title || "Shared Media"}
              className="w-full h-full object-contain"
            />
          )}
        </div>

        {/* Video Metadata & Security Card */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2 bg-zinc-900/40 p-6 rounded-2xl border border-zinc-800/60 backdrop-blur-sm space-y-4">
            <div className="space-y-1">
              <h1 className="text-xl md:text-2xl font-semibold tracking-tight text-white">
                {info.title || (isVideo ? "Untitled Video" : "Untitled Photo")}
              </h1>
              <p className="text-xs text-zinc-400">
                Shared on {new Date(info.created_at).toLocaleDateString(undefined, { dateStyle: "long" })}
              </p>
            </div>

            {/* Metrics Pills */}
            <div className="flex flex-wrap items-center gap-2.5 pt-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-zinc-800/80 border border-zinc-700/50 text-xs text-zinc-300">
                {isVideo ? <Film className="w-3.5 h-3.5 text-indigo-400" /> : <ImageIcon className="w-3.5 h-3.5 text-indigo-400" />}
                {isVideo ? "4K Stream" : "Original Photo"}
              </span>

              {info.duration_seconds ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-zinc-800/80 border border-zinc-700/50 text-xs text-zinc-300">
                  <Clock className="w-3.5 h-3.5 text-amber-400" />
                  {formatDuration(info.duration_seconds)}
                </span>
              ) : null}

              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-zinc-800/80 border border-zinc-700/50 text-xs text-zinc-300">
                {formatBytes(info.file_size_bytes)}
              </span>

              {info.width && info.height ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-zinc-800/80 border border-zinc-700/50 text-xs text-zinc-300">
                  {info.width} × {info.height}
                </span>
              ) : null}
            </div>
          </div>

          {/* Privacy & Edge CDN Info Box */}
          <div className="bg-zinc-900/40 p-6 rounded-2xl border border-zinc-800/60 backdrop-blur-sm flex flex-col justify-between space-y-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-emerald-400 font-medium text-xs">
                <ShieldCheck className="w-4 h-4" />
                <span>Zero-Knowledge Relay</span>
              </div>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Streamed via Cloudflare Serverless Edge with sub-5ms seek caching. The owner&apos;s Telegram account remains 100% private and isolated.
              </p>
            </div>

            <Link
              href="/"
              className="text-xs text-indigo-400 hover:text-indigo-300 font-medium inline-flex items-center gap-1 group transition-colors"
            >
              <span>Learn more about Aetheroll</span>
              <span className="group-hover:translate-x-0.5 transition-transform">→</span>
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
