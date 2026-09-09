"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Shield,
  Zap,
  HardDrive,
  Camera,
  Film,
  MapPin,
  Sparkles,
  Play,
  Lock,
  Database,
  Layers,
  CheckCircle2,
  Cpu,
  Download,
} from "lucide-react";
import { APK_DOWNLOAD_URL, GITHUB_REPO_URL } from "@/lib/brand";

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
  const [activeTab, setActiveTab] = useState<"gallery" | "video" | "security" | "wal">("gallery");

  return (
    <section className="relative pt-16 pb-20 md:pt-24 md:pb-32 overflow-hidden bg-zinc-950">
      {/* Subtle, precise background gradient mask (no messy neon blobs) */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-20%,rgba(120,119,198,0.12),rgba(255,255,255,0))] pointer-events-none -z-10" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        {/* Editorial Top Badge */}
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs font-medium mb-8">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          <span>Zero-Knowledge Media Vault on Telegram</span>
        </div>

        {/* Primary Authoritative Headline */}
        <h1 className="text-4xl sm:text-6xl md:text-7xl font-bold tracking-tight text-white max-w-4xl mx-auto mb-6 leading-[1.08]">
          Your Photos. Infinite Storage. Zero Cloud Bills.
        </h1>

        {/* Crisp Subtitle */}
        <p className="text-base sm:text-lg text-zinc-400 max-w-2xl mx-auto mb-10 leading-relaxed font-normal">
          A high-performance, private Google Photos alternative powered by Telegram.
          Stream 4K videos with sub-5ms seek times, preserve 100% original camera EXIF data, and protect your session with dual-key zero-knowledge encryption.
        </p>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3.5 max-w-xl mx-auto mb-6">
          <Link
            href="/app"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg font-medium text-sm text-zinc-950 bg-white hover:bg-zinc-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] transition-all group"
          >
            <span>{hasActiveSession ? "Open Your Gallery" : "Launch Web App"}</span>
            <ArrowRight className="w-4 h-4 text-zinc-600 group-hover:translate-x-0.5 transition-transform" />
          </Link>

          <a
            href={APK_DOWNLOAD_URL}
            download
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2.5 px-5 py-3 rounded-lg font-medium text-sm text-emerald-300 hover:text-emerald-100 bg-emerald-950/50 hover:bg-emerald-900/60 border border-emerald-700/60 hover:border-emerald-600 shadow-sm transition-all"
          >
            <AndroidIcon className="w-4 h-4 text-emerald-400" />
            <span>Download Android APK</span>
            <Download className="w-3.5 h-3.5 text-emerald-400/80" />
          </a>

          <a
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-medium text-sm text-zinc-400 hover:text-zinc-200 bg-zinc-900/80 hover:bg-zinc-800/80 border border-zinc-800 transition-colors"
          >
            <span>GitHub</span>
          </a>
        </div>

        {/* Small Subtext / Note under buttons */}
        <div className="text-[11px] font-mono text-zinc-500 mb-16">
          Direct APK from latest GitHub release • Free & Open Source
        </div>

        {/* Monochromatic Technical Spec Strip */}
        <div className="flex flex-wrap items-center justify-center gap-y-3 gap-x-8 text-xs font-mono text-zinc-400 mb-16 select-none border-y border-zinc-900 py-4 max-w-4xl mx-auto">
          <div className="flex items-center gap-2">
            <Cpu className="w-3.5 h-3.5 text-zinc-400" />
            <span>10-Worker MTProto Pipeline</span>
          </div>
          <div className="flex items-center gap-2">
            <Lock className="w-3.5 h-3.5 text-zinc-400" />
            <span>Dual-Key HKDF Zero-Knowledge</span>
          </div>
          <div className="flex items-center gap-2">
            <Camera className="w-3.5 h-3.5 text-zinc-400" />
            <span>100% Original RAW & 4K</span>
          </div>
          <div className="flex items-center gap-2">
            <HardDrive className="w-3.5 h-3.5 text-zinc-400" />
            <span>$0/mo Serverless Edge</span>
          </div>
        </div>

        {/* ── Interactive Live Product Showcase ── */}
        <div className="relative max-w-5xl mx-auto rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl overflow-hidden text-left">
          {/* Mock Window Title Bar & Tabs */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between px-4 py-3 border-b border-zinc-800/80 bg-zinc-900/60 gap-3">
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 mr-1">
                <div className="w-3 h-3 rounded-full bg-[#FF5F56] border border-[#E0443E] shadow-sm" />
                <div className="w-3 h-3 rounded-full bg-[#FFBD2E] border border-[#DEA123] shadow-sm" />
                <div className="w-3 h-3 rounded-full bg-[#27C93F] border border-[#1AAB29] shadow-sm" />
              </div>
              <span className="ml-1 font-mono text-xs text-zinc-400">
                aetheroll.builtbyshiva.com/app
              </span>
            </div>

            {/* Interactive Tab Switcher */}
            <div className="flex items-center gap-1 bg-zinc-900 p-1 rounded-lg border border-zinc-800 text-xs font-medium">
              <button
                onClick={() => setActiveTab("gallery")}
                className={`px-3 py-1 rounded-md transition-colors ${
                  activeTab === "gallery"
                    ? "bg-zinc-800 text-zinc-100 shadow-sm"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                Gallery & EXIF
              </button>
              <button
                onClick={() => setActiveTab("video")}
                className={`px-3 py-1 rounded-md transition-colors ${
                  activeTab === "video"
                    ? "bg-zinc-800 text-zinc-100 shadow-sm"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                4K Stream Engine
              </button>
              <button
                onClick={() => setActiveTab("security")}
                className={`px-3 py-1 rounded-md transition-colors ${
                  activeTab === "security"
                    ? "bg-zinc-800 text-zinc-100 shadow-sm"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                Zero-Knowledge
              </button>
              <button
                onClick={() => setActiveTab("wal")}
                className={`px-3 py-1 rounded-md transition-colors ${
                  activeTab === "wal"
                    ? "bg-zinc-800 text-zinc-100 shadow-sm"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                WAL Replay
              </button>
            </div>
          </div>

          {/* Interactive Screen View */}
          <div className="p-4 sm:p-6 bg-zinc-950">
            {activeTab === "gallery" && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {/* Photo 1: High-Res Landscape */}
                <div className="group relative rounded-lg border border-zinc-800/80 bg-zinc-900 overflow-hidden flex flex-col">
                  <div className="relative aspect-[4/3] bg-zinc-800 overflow-hidden">
                    <img
                      src="https://images.unsplash.com/photo-1506905925346-21bda4d32df4?q=80&w=800&auto=format&fit=crop"
                      alt="Swiss Alps Sunrise"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                    <div className="absolute top-2 left-2 bg-black/60 backdrop-blur-md px-2 py-0.5 rounded text-[10px] font-mono text-zinc-200">
                      RAW • 48 MP
                    </div>
                  </div>
                  <div className="p-3 border-t border-zinc-800/60 bg-zinc-900/40">
                    <div className="flex items-center justify-between text-xs font-medium text-zinc-200 mb-1">
                      <span>Matterhorn Glacier.dng</span>
                      <span className="text-zinc-500 font-mono text-[11px]">42 MB</span>
                    </div>
                    <p className="text-[11px] font-mono text-zinc-400">
                      Sony A7IV • 24mm f/1.4 • ISO 100
                    </p>
                  </div>
                </div>

                {/* Photo 2: Kyoto Street Night */}
                <div className="group relative rounded-lg border border-zinc-800/80 bg-zinc-900 overflow-hidden flex flex-col">
                  <div className="relative aspect-[4/3] bg-zinc-800 overflow-hidden">
                    <img
                      src="https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?q=80&w=800&auto=format&fit=crop"
                      alt="Kyoto Autumn"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                    <div className="absolute top-2 left-2 bg-black/60 backdrop-blur-md px-2 py-0.5 rounded text-[10px] font-mono text-zinc-200">
                      GPS Tagged
                    </div>
                  </div>
                  <div className="p-3 border-t border-zinc-800/60 bg-zinc-900/40">
                    <div className="flex items-center justify-between text-xs font-medium text-zinc-200 mb-1">
                      <span>Gion Historic Lane.heic</span>
                      <span className="text-zinc-500 font-mono text-[11px]">8.4 MB</span>
                    </div>
                    <p className="text-[11px] font-mono text-zinc-400">
                      Leica Q2 • 28mm f/1.7 • Kyoto, JP
                    </p>
                  </div>
                </div>

                {/* Photo 3: Coastal Amalfi Sunset */}
                <div className="group relative rounded-lg border border-zinc-800/80 bg-zinc-900 overflow-hidden flex flex-col">
                  <div className="relative aspect-[4/3] bg-zinc-800 overflow-hidden">
                    <img
                      src="https://images.unsplash.com/photo-1533105079780-92b9be482077?q=80&w=800&auto=format&fit=crop"
                      alt="Amalfi Coast"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                    <div className="absolute top-2 left-2 bg-black/60 backdrop-blur-md px-2 py-0.5 rounded text-[10px] font-mono text-zinc-200">
                      Trip Collection
                    </div>
                  </div>
                  <div className="p-3 border-t border-zinc-800/60 bg-zinc-900/40">
                    <div className="flex items-center justify-between text-xs font-medium text-zinc-200 mb-1">
                      <span>Positano Cliffside.jpg</span>
                      <span className="text-zinc-500 font-mono text-[11px]">14.2 MB</span>
                    </div>
                    <p className="text-[11px] font-mono text-zinc-400">
                      Apple ProRAW • 48MP • Amalfi, IT
                    </p>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "video" && (
              <div className="p-6 rounded-lg border border-zinc-800 bg-zinc-900/40 space-y-6">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-zinc-800/80 pb-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      <h4 className="text-sm font-semibold text-zinc-100">
                        10-Worker MTProto Segment Fetcher
                      </h4>
                    </div>
                    <p className="text-xs text-zinc-400 mt-0.5">
                      16 MB lookahead ring-buffer streaming directly from Telegram Data Centers
                    </p>
                  </div>
                  <div className="flex items-center gap-4 text-xs font-mono">
                    <div>
                      <span className="text-zinc-500 block text-[10px]">THROUGHPUT</span>
                      <span className="text-zinc-200 font-bold">28.4 MB/s</span>
                    </div>
                    <div>
                      <span className="text-zinc-500 block text-[10px]">SEEK LATENCY</span>
                      <span className="text-emerald-400 font-bold">3.2 ms</span>
                    </div>
                    <div>
                      <span className="text-zinc-500 block text-[10px]">ACTIVE DC</span>
                      <span className="text-zinc-200 font-bold">DC 4 (Amsterdam)</span>
                    </div>
                  </div>
                </div>

                {/* Simulated 10-Worker Visualizer */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs font-mono text-zinc-400">
                    <span>16MB Buffer Workers (Parallel HTTP Range Stream)</span>
                    <span>10 / 10 Active</span>
                  </div>
                  <div className="grid grid-cols-5 sm:grid-cols-10 gap-1.5">
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((worker) => (
                      <div
                        key={worker}
                        className="p-2 rounded bg-zinc-800/80 border border-zinc-700/50 text-center font-mono text-[10px]"
                      >
                        <span className="text-zinc-500 block">W{worker}</span>
                        <span className="text-emerald-400 font-semibold">16MB</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeTab === "security" && (
              <div className="p-6 rounded-lg border border-zinc-800 bg-zinc-900/40 space-y-6">
                <div className="border-b border-zinc-800/80 pb-4">
                  <h4 className="text-sm font-semibold text-zinc-100">
                    Dual-Key HKDF-SHA256 Cryptographic Envelope
                  </h4>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Your Telegram MTProto auth string is never stored in plaintext on the server.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 font-mono text-xs">
                  <div className="p-4 rounded-lg bg-zinc-900 border border-zinc-800">
                    <div className="flex items-center gap-2 text-zinc-200 font-semibold mb-2">
                      <Lock className="w-3.5 h-3.5 text-blue-400" />
                      <span>Client Cookie (Browser Only)</span>
                    </div>
                    <p className="text-zinc-400 text-[11px] mb-2 leading-relaxed">
                      Holds <code className="text-blue-300">clientSecret</code> in an HttpOnly, Secure cookie. Never persisted in server databases.
                    </p>
                    <div className="p-2 rounded bg-zinc-950 border border-zinc-800 text-[10px] text-zinc-500 truncate">
                      tg_session: a7f8c9...d2e1b4
                    </div>
                  </div>

                  <div className="p-4 rounded-lg bg-zinc-900 border border-zinc-800">
                    <div className="flex items-center gap-2 text-zinc-200 font-semibold mb-2">
                      <Database className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Server D1 Database</span>
                    </div>
                    <p className="text-zinc-400 text-[11px] mb-2 leading-relaxed">
                      Stores only AES-256-GCM encrypted ciphertext. Mathematically undecryptable without the client secret.
                    </p>
                    <div className="p-2 rounded bg-zinc-950 border border-zinc-800 text-[10px] text-zinc-500 truncate">
                      session_encrypted: [Ciphertext: AES-GCM-256]
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "wal" && (
              <div className="p-6 rounded-lg border border-zinc-800 bg-zinc-900/40 space-y-4 font-mono">
                <div className="border-b border-zinc-800/80 pb-3">
                  <h4 className="text-sm font-semibold text-zinc-100 font-sans">
                    Append-Only Telegram Write-Ahead Log (WAL)
                  </h4>
                  <p className="text-xs text-zinc-400 font-sans mt-0.5">
                    Zero-loss architecture: replaying Telegram thread replies restores 100% of your tags, favorites, and trip groupings if your database is ever cleared.
                  </p>
                </div>

                <div className="bg-zinc-950 rounded-lg p-3 border border-zinc-800/80 text-[11px] space-y-1.5 text-zinc-400">
                  <div className="text-zinc-500">// Live Telegram Thread Event Replay</div>
                  <div className="text-emerald-400 flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>[GP_EVENT:v1] {`{"action":"tag_add","tag":"favorites","msg_id":48201}`}</span>
                  </div>
                  <div className="text-emerald-400 flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>[GP_EVENT:v1] {`{"action":"trip_group","trip":"Swiss Alps 2026","items":14}`}</span>
                  </div>
                  <div className="text-zinc-500">
                    &gt; 24,190 ledger events replayed deterministically in 184ms.
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
