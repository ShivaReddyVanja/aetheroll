"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Camera,
  Film,
  MapPin,
  Play,
  Smartphone,
  CheckCircle2,
  Download,
  Heart,
  ShieldCheck,
} from "lucide-react";
import { APK_DOWNLOAD_URL } from "@/lib/brand";

function AndroidIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M17.523 15.3414c-.5511 0-.9993-.4486-.9993-.9997s.4482-.9993.9993-.9993c.551 0 .9993.4482.9993.9993.0001.5511-.4483.9997-.9993.9997m-11.046 0c-.5511 0-.9993-.4486-.9993-.9997s.4482-.9993.9993-.9993c.5511 0 .9993.4482.9993.9993 0 .5511-.4482.9997-.9993.9997m11.4045-6.02l1.996-3.4572c.1558-.27.0634-.6148-.2064-.7706-.2699-.1559-.6148-.0635-.7707.2064l-2.0232 3.5042C15.426 8.2323 13.7667 7.893 12 7.893s-3.426.3393-4.8827.9117L5.094 5.3006c-.1559-.2699-.5008-.3623-.7707-.2064-.2698.1558-.3622.5006-.2064.7706l1.996 3.4572C2.7937 11.2057.5 15.1118.5 19.6052h23c0-4.4934-2.2937-8.3995-5.6185-10.2838" />
    </svg>
  );
}

interface HeroSectionProps {
  hasActiveSession?: boolean;
}

export function HeroSection({ hasActiveSession }: HeroSectionProps) {
  const [activeTab, setActiveTab] = useState<"gallery" | "video" | "backup" | "privacy">("gallery");

  return (
    <section className="relative pt-12 pb-16 md:pt-18 md:pb-24 overflow-hidden bg-zinc-950">
      {/* Subtle background glow */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_-10%,rgba(120,119,198,0.15),rgba(255,255,255,0))] pointer-events-none -z-10" />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        {/* Top Product Badge */}
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-zinc-900/90 border border-zinc-800 text-zinc-300 text-xs font-medium mb-6">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          <span>Unlimited Cloud Storage • $0/mo Forever</span>
        </div>

        {/* Short, Punchy Headline */}
        <h1 className="text-3xl sm:text-5xl md:text-6xl font-bold tracking-tight text-white max-w-3xl mx-auto mb-4 leading-tight">
          Unlimited Cloud Photos. <br className="hidden sm:inline" />
          <span className="text-zinc-400">Zero Monthly Fees.</span>
        </h1>

        {/* Concise 1-Line Subtitle */}
        <p className="text-sm sm:text-base text-zinc-400 max-w-xl mx-auto mb-8 font-normal">
          Keep all your photos and 4K videos in 100% original quality with automatic mobile backup and total privacy.
        </p>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center justify-center gap-3 max-w-md mx-auto mb-6">
          <Link
            href="/app"
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg font-medium text-sm text-zinc-950 bg-white hover:bg-zinc-200 transition-all shadow-sm group"
          >
            <span>{hasActiveSession ? "Open Your Gallery" : "Launch Web App"}</span>
            <ArrowRight className="w-4 h-4 text-zinc-600 group-hover:translate-x-0.5 transition-transform" />
          </Link>

          <a
            href={APK_DOWNLOAD_URL}
            download
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium text-sm text-zinc-200 hover:text-white bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 transition-all"
          >
            <AndroidIcon className="w-4 h-4 text-emerald-400" />
            <span>Android App</span>
            <Download className="w-3.5 h-3.5 text-zinc-500" />
          </a>
        </div>

        {/* Disclaimer Note */}
        <div className="max-w-xl mx-auto mb-10 text-[11px] sm:text-xs text-amber-200/80 leading-relaxed bg-amber-950/30 border border-amber-500/30 rounded-lg py-2 px-3.5 text-center">
          <span className="text-amber-400 font-semibold">Note:</span> All data is securely stored in your Telegram private channels without touching. Aetheroll is not liable for actions taken by Telegram; it is completely an abstraction layer.
        </div>

        {/* ── Interactive Live Product Showcase (Directly Visible) ── */}
        <div className="relative max-w-4xl mx-auto rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl overflow-hidden text-left">
          {/* Window Title Bar & Tabs */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between px-4 py-2.5 border-b border-zinc-800 bg-zinc-900/60 gap-2.5">
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 mr-1">
                <div className="w-2.5 h-2.5 rounded-full bg-rose-500/80" />
                <div className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/80" />
              </div>
              <span className="text-xs text-zinc-400 font-medium">
                Aetheroll Preview
              </span>
            </div>

            {/* Tab Switcher */}
            <div className="flex items-center gap-1 bg-zinc-900 p-0.5 rounded-lg border border-zinc-800 text-xs font-medium">
              <button
                onClick={() => setActiveTab("gallery")}
                className={`px-3 py-1 rounded-md transition-colors ${
                  activeTab === "gallery"
                    ? "bg-zinc-800 text-zinc-100 shadow-sm"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                Gallery & Photos
              </button>
              <button
                onClick={() => setActiveTab("video")}
                className={`px-3 py-1 rounded-md transition-colors ${
                  activeTab === "video"
                    ? "bg-zinc-800 text-zinc-100 shadow-sm"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                4K Video
              </button>
              <button
                onClick={() => setActiveTab("backup")}
                className={`px-3 py-1 rounded-md transition-colors ${
                  activeTab === "backup"
                    ? "bg-zinc-800 text-zinc-100 shadow-sm"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                Mobile Sync
              </button>
              <button
                onClick={() => setActiveTab("privacy")}
                className={`px-3 py-1 rounded-md transition-colors ${
                  activeTab === "privacy"
                    ? "bg-zinc-800 text-zinc-100 shadow-sm"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                Privacy
              </button>
            </div>
          </div>

          {/* Interactive Views */}
          <div className="p-4 sm:p-5 bg-zinc-950">
            {/* TAB 1: GALLERY & PHOTOS */}
            {activeTab === "gallery" && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                {/* Photo 1 */}
                <div className="group relative rounded-lg border border-zinc-800 bg-zinc-900 overflow-hidden flex flex-col">
                  <div className="relative aspect-[4/3] bg-zinc-800 overflow-hidden">
                    <img
                      src="https://images.unsplash.com/photo-1506905925346-21bda4d32df4?q=80&w=800&auto=format&fit=crop"
                      alt="Swiss Alps"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                    <div className="absolute top-2 left-2 bg-black/70 backdrop-blur-md px-2 py-0.5 rounded text-[10px] font-semibold text-emerald-300">
                      48 MP • RAW
                    </div>
                    <div className="absolute top-2 right-2 bg-black/70 backdrop-blur-md p-1 rounded-full text-rose-400">
                      <Heart className="w-3 h-3 fill-rose-400" />
                    </div>
                  </div>
                  <div className="p-2.5 border-t border-zinc-800/60 bg-zinc-900/40">
                    <div className="flex items-center justify-between text-xs font-medium text-zinc-200">
                      <span className="truncate">Matterhorn.dng</span>
                      <span className="text-zinc-500 text-[11px]">42 MB</span>
                    </div>
                    <p className="text-[11px] text-zinc-400 mt-0.5 truncate">
                      Sony A7IV • 24mm f/1.4
                    </p>
                  </div>
                </div>

                {/* Photo 2 */}
                <div className="group relative rounded-lg border border-zinc-800 bg-zinc-900 overflow-hidden flex flex-col">
                  <div className="relative aspect-[4/3] bg-zinc-800 overflow-hidden">
                    <img
                      src="https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?q=80&w=800&auto=format&fit=crop"
                      alt="Kyoto"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                    <div className="absolute top-2 left-2 bg-black/70 backdrop-blur-md px-2 py-0.5 rounded text-[10px] font-medium text-zinc-200 flex items-center gap-1">
                      <MapPin className="w-2.5 h-2.5 text-emerald-400" /> Kyoto, Japan
                    </div>
                  </div>
                  <div className="p-2.5 border-t border-zinc-800/60 bg-zinc-900/40">
                    <div className="flex items-center justify-between text-xs font-medium text-zinc-200">
                      <span className="truncate">Gion Street.heic</span>
                      <span className="text-zinc-500 text-[11px]">8.4 MB</span>
                    </div>
                    <p className="text-[11px] text-zinc-400 mt-0.5 truncate">
                      Leica Q2 • 28mm f/1.7
                    </p>
                  </div>
                </div>

                {/* Photo 3 */}
                <div className="group relative rounded-lg border border-zinc-800 bg-zinc-900 overflow-hidden flex flex-col">
                  <div className="relative aspect-[4/3] bg-zinc-800 overflow-hidden">
                    <img
                      src="https://images.unsplash.com/photo-1533105079780-92b9be482077?q=80&w=800&auto=format&fit=crop"
                      alt="Amalfi Coast"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                    <div className="absolute top-2 left-2 bg-black/70 backdrop-blur-md px-2 py-0.5 rounded text-[10px] font-medium text-purple-300">
                      Trip Album
                    </div>
                  </div>
                  <div className="p-2.5 border-t border-zinc-800/60 bg-zinc-900/40">
                    <div className="flex items-center justify-between text-xs font-medium text-zinc-200">
                      <span className="truncate">Positano.jpg</span>
                      <span className="text-zinc-500 text-[11px]">14.2 MB</span>
                    </div>
                    <p className="text-[11px] text-zinc-400 mt-0.5 truncate">
                      iPhone 16 Pro • 48MP
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: 4K VIDEO PLAYER */}
            {activeTab === "video" && (
              <div className="relative aspect-video max-h-[300px] rounded-lg overflow-hidden bg-zinc-900 border border-zinc-800 flex items-center justify-center group">
                <img
                  src="https://images.unsplash.com/photo-1518709268805-4e9042af9f23?q=80&w=1200&auto=format&fit=crop"
                  alt="4K Video"
                  className="w-full h-full object-cover opacity-80"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/30" />
                
                <div className="w-12 h-12 rounded-full bg-white text-zinc-950 flex items-center justify-center shadow-xl group-hover:scale-110 transition-transform cursor-pointer">
                  <Play className="w-5 h-5 fill-zinc-950 ml-0.5" />
                </div>

                <div className="absolute top-3 left-3 flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded bg-black/70 backdrop-blur-md text-[10px] font-semibold text-amber-300 border border-amber-500/30">
                    4K HDR 60fps
                  </span>
                  <span className="px-2 py-0.5 rounded bg-black/70 backdrop-blur-md text-[10px] text-zinc-200">
                    Instant Playback
                  </span>
                </div>

                <div className="absolute bottom-3 inset-x-3 bg-zinc-950/85 backdrop-blur-md rounded-lg p-2.5 border border-zinc-800/80 space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-zinc-300">
                    <span className="font-medium truncate">Iceland Trip (Home Video 4K).mov</span>
                    <span className="text-zinc-400 font-mono text-[11px]">04:15 / 16:40</span>
                  </div>
                  <div className="w-full bg-zinc-800 h-1.5 rounded-full overflow-hidden flex">
                    <div className="bg-amber-400 h-full w-2/5 rounded-full" />
                  </div>
                </div>
              </div>
            )}

            {/* TAB 3: MOBILE AUTO-BACKUP */}
            {activeTab === "backup" && (
              <div className="p-4 sm:p-5 rounded-lg border border-zinc-800 bg-zinc-900/40 space-y-4">
                <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
                  <div className="flex items-center gap-2.5">
                    <Smartphone className="w-4 h-4 text-emerald-400" />
                    <span className="text-xs font-medium text-zinc-200">
                      Android Background Auto-Sync
                    </span>
                  </div>
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Active & Synced
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2.5 text-left">
                  <div className="p-3 rounded-lg bg-zinc-950 border border-zinc-800">
                    <span className="text-zinc-500 text-[10px] uppercase font-medium block">Total Synced</span>
                    <span className="text-base font-bold text-white">3,842</span>
                    <span className="text-zinc-400 text-[10px] block">Items</span>
                  </div>
                  <div className="p-3 rounded-lg bg-zinc-950 border border-zinc-800">
                    <span className="text-zinc-500 text-[10px] uppercase font-medium block">Quality</span>
                    <span className="text-base font-bold text-emerald-400">100%</span>
                    <span className="text-zinc-400 text-[10px] block">Original</span>
                  </div>
                  <div className="p-3 rounded-lg bg-zinc-950 border border-zinc-800">
                    <span className="text-zinc-500 text-[10px] uppercase font-medium block">Monthly Cost</span>
                    <span className="text-base font-bold text-white">$0.00</span>
                    <span className="text-emerald-400 text-[10px] block">Unlimited</span>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 4: PRIVACY */}
            {activeTab === "privacy" && (
              <div className="p-4 sm:p-5 rounded-lg border border-zinc-800 bg-zinc-900/40 space-y-3.5 text-left">
                <div className="border-b border-zinc-800 pb-2.5 flex items-center gap-2 text-xs font-medium text-zinc-200">
                  <ShieldCheck className="w-4 h-4 text-purple-400" />
                  <span>Your Personal Private Vault</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                  <div className="p-3 rounded-lg bg-zinc-950 border border-zinc-800">
                    <div className="font-semibold text-zinc-200 mb-1">🔒 Private Keys</div>
                    <p className="text-zinc-400 text-[11px] leading-relaxed">
                      Only you hold the key to view and download your memories.
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-zinc-950 border border-zinc-800">
                    <div className="font-semibold text-zinc-200 mb-1">🚫 No AI Scanning</div>
                    <p className="text-zinc-400 text-[11px] leading-relaxed">
                      Your photos are never scanned or used for AI training.
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-zinc-950 border border-zinc-800">
                    <div className="font-semibold text-zinc-200 mb-1">🛡️ No Ads</div>
                    <p className="text-zinc-400 text-[11px] leading-relaxed">
                      Zero ad tracking, data profiling, or data selling.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
