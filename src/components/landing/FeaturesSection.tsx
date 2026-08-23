"use client";

import React from "react";
import {
  Film,
  Camera,
  Lock,
  Database,
  Cpu,
  Layers,
  Sparkles,
  ArrowRight,
  Check,
} from "lucide-react";

export function FeaturesSection() {
  return (
    <section id="features" className="py-24 md:py-32 bg-zinc-950 border-t border-zinc-800/80 scroll-mt-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mb-16 text-left">
          <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-400 text-xs font-mono mb-4">
            <span>ARCHITECTURAL SPECIFICATION</span>
          </div>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-white mb-4">
            Engineered for Photographers and Cineasts
          </h2>
          <p className="text-base text-zinc-400 leading-relaxed">
            Generic storage bots treat media like arbitrary file blobs. Aetheroll is designed from the ground up to handle massive 48MP ProRAW photos and gigabyte 4K HDR video streams with zero latency.
          </p>
        </div>

        {/* ── Asymmetric Architectural Bento Grid ── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Bento Card 1: 10-Worker MTProto Streaming (Spans 2 cols) */}
          <div className="md:col-span-2 rounded-xl border border-zinc-800 bg-zinc-900/40 p-6 sm:p-8 flex flex-col justify-between hover:border-zinc-700 transition-colors">
            <div>
              <div className="w-10 h-10 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-200 mb-6">
                <Film className="w-5 h-5" />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">
                10-Worker Parallel 4K Video Streaming
              </h3>
              <p className="text-sm text-zinc-400 max-w-xl leading-relaxed mb-6">
                Standard MTProto downloads are throttled to single-thread sequential parts. Aetheroll orchestrates 10 concurrent chunk workers inside Cloudflare Durable Objects, fetching 16 MB ring-buffer slices with predictive range lookahead.
              </p>
            </div>

            {/* Micro visualizer */}
            <div className="p-4 rounded-lg bg-zinc-950 border border-zinc-800/80 font-mono text-xs text-zinc-400 space-y-2">
              <div className="flex items-center justify-between text-[11px] text-zinc-500">
                <span>PARALLEL HTTP RANGE PIPELINE</span>
                <span className="text-emerald-400">SUB-5MS SEEK TIME</span>
              </div>
              <div className="w-full bg-zinc-800 h-2 rounded-full overflow-hidden flex">
                <div className="bg-white h-full w-2/5" />
                <div className="bg-zinc-600 h-full w-1/4" />
                <div className="bg-zinc-700 h-full w-1/5" />
              </div>
              <div className="flex items-center justify-between text-[10px] text-zinc-500">
                <span>Active 16MB Chunk Prefetch</span>
                <span>Bitrate: 4K HDR 60fps (~85 Mbps)</span>
              </div>
            </div>
          </div>

          {/* Bento Card 2: Dual-Key HKDF Zero Knowledge */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6 sm:p-8 flex flex-col justify-between hover:border-zinc-700 transition-colors">
            <div>
              <div className="w-10 h-10 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-200 mb-6">
                <Lock className="w-5 h-5" />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">
                Dual-Key HKDF Security
              </h3>
              <p className="text-sm text-zinc-400 leading-relaxed mb-6">
                Your Telegram session string is split cryptographically. The client secret never touches the server database, ensuring impossible decryption even if D1 is fully breached.
              </p>
            </div>

            <div className="p-3 rounded-lg bg-zinc-950 border border-zinc-800/80 font-mono text-[11px] text-zinc-400 space-y-1">
              <div className="text-zinc-500">// Key Derivation</div>
              <div className="text-zinc-300">IKM = ClientCookieSecret</div>
              <div className="text-zinc-300">Salt = ServerMasterKey</div>
              <div className="text-emerald-400">Cipher = AES-256-GCM</div>
            </div>
          </div>

          {/* Bento Card 3: Camera Sensor & EXIF */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6 sm:p-8 flex flex-col justify-between hover:border-zinc-700 transition-colors">
            <div>
              <div className="w-10 h-10 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-200 mb-6">
                <Camera className="w-5 h-5" />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">
                100% Uncompressed EXIF
              </h3>
              <p className="text-sm text-zinc-400 leading-relaxed mb-6">
                Preserves raw camera sensor data, lens apertures, ISO settings, capture timestamps, and GPS coordinates for precision timeline scrubbing without lossy re-encoding.
              </p>
            </div>

            <div className="p-3 rounded-lg bg-zinc-950 border border-zinc-800/80 font-mono text-[11px] text-zinc-400 space-y-1">
              <div className="flex justify-between text-zinc-300">
                <span>Model:</span>
                <span className="text-zinc-100">Sony ILCE-7M4</span>
              </div>
              <div className="flex justify-between text-zinc-300">
                <span>Lens:</span>
                <span className="text-zinc-100">FE 24mm F1.4 GM</span>
              </div>
              <div className="flex justify-between text-zinc-300">
                <span>Coords:</span>
                <span className="text-emerald-400">35.0116° N, 135.7681° E</span>
              </div>
            </div>
          </div>

          {/* Bento Card 4: Append-Only WAL Event Ledger */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6 sm:p-8 flex flex-col justify-between hover:border-zinc-700 transition-colors">
            <div>
              <div className="w-10 h-10 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-200 mb-6">
                <Database className="w-5 h-5" />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">
                Append-Only Telegram WAL
              </h3>
              <p className="text-sm text-zinc-400 leading-relaxed mb-6">
                Every tag, favorite, trip grouping, and collection update is recorded as an encrypted reply inside your Telegram message threads for instant disaster recovery.
              </p>
            </div>

            <div className="p-3 rounded-lg bg-zinc-950 border border-zinc-800/80 font-mono text-[11px] text-zinc-400 space-y-1">
              <div className="text-zinc-500">// Event Sourced Ledger</div>
              <div className="text-zinc-200">[GP_EVENT:v1] tag_added</div>
              <div className="text-zinc-200">[GP_EVENT:v1] favorite_toggle</div>
              <div className="text-emerald-400">Replay: 100% Deterministic</div>
            </div>
          </div>

          {/* Bento Card 5: $0/mo Serverless Edge Architecture */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6 sm:p-8 flex flex-col justify-between hover:border-zinc-700 transition-colors">
            <div>
              <div className="w-10 h-10 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-200 mb-6">
                <Layers className="w-5 h-5" />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">
                $0/mo Serverless Edge
              </h3>
              <p className="text-sm text-zinc-400 leading-relaxed mb-6">
                Runs on Cloudflare Workers, Durable Objects, and D1 SQLite. Zero server maintenance, zero cold-starts, and global edge caching across 300+ cities worldwide.
              </p>
            </div>

            <div className="p-3 rounded-lg bg-zinc-950 border border-zinc-800/80 font-mono text-[11px] text-zinc-400 space-y-1">
              <div className="flex justify-between text-zinc-300">
                <span>Hosting Cost:</span>
                <span className="text-emerald-400 font-bold">$0.00 / month</span>
              </div>
              <div className="flex justify-between text-zinc-300">
                <span>Database:</span>
                <span className="text-zinc-100">Cloudflare D1 (SQLite)</span>
              </div>
              <div className="flex justify-between text-zinc-300">
                <span>Edge POPs:</span>
                <span className="text-zinc-100">300+ Global Locations</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
