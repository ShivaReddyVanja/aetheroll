"use client";

import React, { useRef, useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Download,
  PictureInPicture2,
  Film,
  Image as ImageIcon,
  Clock,
  HardDrive,
  Maximize2,
  ShieldCheck,
  Check,
} from "lucide-react";
import { BrandIcon } from "@/components/BrandIcon";
import { BRAND_NAME } from "@/lib/brand";
import type { PublicShareInfo } from "@aetheroll/types";

interface SharePlayerProps {
  shareId: string;
  streamUrl: string;
  isVideo: boolean;
  info: PublicShareInfo;
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

export function SharePlayer({ shareId, streamUrl, isVideo, info }: SharePlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPipSupported, setIsPipSupported] = useState(false);
  const [isPipActive, setIsPipActive] = useState(false);

  const title = info.title || (isVideo ? "Shared Video" : "Shared Photo");
  const dateText = new Date(info.created_at).toLocaleDateString(undefined, { dateStyle: "long" });

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !isVideo) return;

    // Detect standard W3C PiP or Apple WebKit presentation mode
    const hasStandardPip = Boolean(
      typeof document !== "undefined" &&
      "pictureInPictureEnabled" in document &&
      (document as any).pictureInPictureEnabled
    );

    const hasWebKitPip = Boolean(
      (video as any).webkitSupportsPresentationMode &&
      typeof (video as any).webkitSetPresentationMode === "function"
    );

    setIsPipSupported(hasStandardPip || hasWebKitPip);

    // Event handlers for standard PiP
    const handleEnterPip = () => setIsPipActive(true);
    const handleLeavePip = () => setIsPipActive(false);

    video.addEventListener("enterpictureinpicture", handleEnterPip);
    video.addEventListener("leavepictureinpicture", handleLeavePip);

    // Event handler for WebKit presentation mode (Safari / iOS)
    const handlePresentationMode = () => {
      const mode = (video as any).webkitPresentationMode;
      setIsPipActive(mode === "picture-in-picture");
    };
    video.addEventListener("webkitpresentationmodechanged", handlePresentationMode);

    // MediaSession API integration (shows title and artwork on lockscreen / OS media widget)
    if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title,
          artist: BRAND_NAME,
          artwork: info.thumbnail_url
            ? [{ src: info.thumbnail_url, sizes: "512x512", type: "image/jpeg" }]
            : [],
        });
      } catch {}
    }

    return () => {
      video.removeEventListener("enterpictureinpicture", handleEnterPip);
      video.removeEventListener("leavepictureinpicture", handleLeavePip);
      video.removeEventListener("webkitpresentationmodechanged", handlePresentationMode);
    };
  }, [isVideo, title, info.thumbnail_url]);

  const togglePiP = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;

    try {
      // 1. Standard W3C Picture-in-Picture API
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        return;
      }

      if (typeof video.requestPictureInPicture === "function") {
        if (video.paused) {
          try {
            await video.play();
          } catch {}
        }
        await video.requestPictureInPicture();
        return;
      }

      // 2. Apple WebKit PiP API (Safari macOS / iOS iPadOS)
      if (
        (video as any).webkitSupportsPresentationMode &&
        typeof (video as any).webkitSetPresentationMode === "function"
      ) {
        const currentMode = (video as any).webkitPresentationMode;
        const targetMode = currentMode === "picture-in-picture" ? "inline" : "picture-in-picture";
        (video as any).webkitSetPresentationMode(targetMode);
      }
    } catch (err) {
      console.warn("[SharePlayer] Picture-in-Picture toggle failed:", err);
    }
  }, []);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col selection:bg-indigo-500 selection:text-white">
      {/* Top Header */}
      <header className="h-16 px-4 md:px-8 border-b border-zinc-900/80 bg-zinc-950/80 backdrop-blur-xl flex items-center justify-between sticky top-0 z-30">
        <Link href="/" className="flex items-center gap-3 group">
          <BrandIcon className="w-7 h-7 drop-shadow-sm transition-transform group-hover:scale-105" size={28} />
          <div className="flex flex-col">
            <span className="font-semibold text-sm tracking-tight text-white group-hover:text-indigo-400 transition-colors">
              {BRAND_NAME}
            </span>
            <span className="text-[10px] text-zinc-400 -mt-0.5">Zero-Knowledge Cloud</span>
          </div>
        </Link>

        <div className="flex items-center gap-2.5">
          {isVideo && isPipSupported && (
            <button
              type="button"
              onClick={togglePiP}
              className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg border text-xs font-medium transition-all shadow-sm ${
                isPipActive
                  ? "bg-indigo-600/20 border-indigo-500/50 text-indigo-300 hover:bg-indigo-600/30"
                  : "bg-zinc-900 hover:bg-zinc-800 border-zinc-800 text-zinc-200 hover:text-white"
              }`}
              title="Float video on top of all apps (Picture in Picture)"
            >
              <PictureInPicture2 className={`w-3.5 h-3.5 ${isPipActive ? "text-indigo-400" : ""}`} />
              <span>{isPipActive ? "Dock Video" : "Pop Out"}</span>
            </button>
          )}

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
      <main className="flex-1 max-w-5xl w-full mx-auto p-4 md:p-8 flex flex-col gap-6">
        <div className="relative group w-full aspect-video md:aspect-[16/9] max-h-[75vh] bg-black rounded-2xl overflow-hidden border border-zinc-800/80 shadow-2xl flex items-center justify-center">
          {isVideo ? (
            <>
              <video
                ref={videoRef}
                src={streamUrl}
                controls
                playsInline
                preload="auto"
                poster={info.thumbnail_url}
                className="w-full h-full object-contain"
              >
                Your browser does not support HTML5 video playback.
              </video>

              {/* Floating Quick-Action PiP Button */}
              {isPipSupported && (
                <button
                  type="button"
                  onClick={togglePiP}
                  className={`absolute top-4 right-4 z-10 p-2 rounded-xl backdrop-blur-md border transition-all duration-200 shadow-lg ${
                    isPipActive
                      ? "opacity-100 bg-indigo-950/80 border-indigo-500/60 text-indigo-300"
                      : "opacity-0 group-hover:opacity-100 bg-black/60 hover:bg-black/85 border-white/10 text-zinc-200 hover:text-white"
                  }`}
                  title="Picture in Picture (stays on top of other apps)"
                >
                  <PictureInPicture2 className="w-4 h-4" />
                </button>
              )}
            </>
          ) : (
            <img
              src={streamUrl}
              alt={title}
              className="w-full h-full object-contain"
            />
          )}
        </div>

        {/* Video Metadata & Security Card */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2 bg-zinc-900/40 p-6 rounded-2xl border border-zinc-800/60 backdrop-blur-sm space-y-4">
            <div className="space-y-1">
              <h1 className="text-xl md:text-2xl font-semibold tracking-tight text-white">{title}</h1>
              <p className="text-xs text-zinc-400">Shared on {dateText}</p>
            </div>

            {/* Metrics Pills */}
            <div className="flex flex-wrap items-center gap-2.5 pt-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-zinc-900/90 border border-zinc-800 text-xs text-zinc-300">
                {isVideo ? <Film className="w-3.5 h-3.5 text-zinc-400" /> : <ImageIcon className="w-3.5 h-3.5 text-zinc-400" />}
                <span>{isVideo ? "Video Stream" : "Original Photo"}</span>
              </span>

              {info.duration_seconds ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-zinc-900/90 border border-zinc-800 text-xs text-zinc-300">
                  <Clock className="w-3.5 h-3.5 text-zinc-400" />
                  <span>{formatDuration(info.duration_seconds)}</span>
                </span>
              ) : null}

              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-zinc-900/90 border border-zinc-800 text-xs text-zinc-300">
                <HardDrive className="w-3.5 h-3.5 text-zinc-400" />
                <span>{formatBytes(info.file_size_bytes)}</span>
              </span>

              {info.width && info.height ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-zinc-900/90 border border-zinc-800 text-xs text-zinc-300">
                  <Maximize2 className="w-3.5 h-3.5 text-zinc-400" />
                  <span>{info.width} × {info.height}</span>
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
                Streamed via Cloudflare Serverless Edge with sub-second segment caching. The owner&apos;s Telegram account remains private and isolated.
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
      </main>
    </div>
  );
}
