import React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { LandingNavbar } from "@/components/landing/LandingNavbar";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { SITE_URL } from "@/lib/brand";
import {
  ArrowRight,
  Film,
  Camera,
  Layers,
  Zap,
  Lock,
  Cpu,
  Database,
} from "lucide-react";

export const metadata: Metadata = {
  title: "Aetheroll vs TeleDrive: Why Aetheroll is Built Specifically for Photos & Videos",
  description:
    "Compare Aetheroll vs TeleDrive and Teldrive. Discover why Aetheroll's dedicated Google Photos masonry layout, 10-worker 4K video scrubbing, and EXIF timeline outperform generic file storage bots.",
  keywords: [
    "teledrive alternative",
    "telegram drive for photos",
    "teledrive vs aetheroll",
    "teldrive alternative",
    "telegram cloud photo gallery",
    "telegram video streaming",
  ],
  alternates: {
    canonical: `${SITE_URL}/compare/teledrive`,
  },
  openGraph: {
    title: "Aetheroll vs TeleDrive — The Specialized Telegram Media Gallery",
    description:
      "TeleDrive is built for files. Aetheroll is purpose-built for media with BlurHash previews, sub-5ms 4K video streaming, and automated EXIF timeline grouping.",
    url: `${SITE_URL}/compare/teledrive`,
  },
};

export default function CompareTeleDrivePage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BreadcrumbList",
        "itemListElement": [
          {
            "@type": "ListItem",
            "position": 1,
            "name": "Home",
            "item": SITE_URL,
          },
          {
            "@type": "ListItem",
            "position": 2,
            "name": "Comparisons",
            "item": `${SITE_URL}/#comparison`,
          },
          {
            "@type": "ListItem",
            "position": 3,
            "name": "TeleDrive & Teldrive Alternative",
            "item": `${SITE_URL}/compare/teledrive`,
          },
        ],
      },
      {
        "@type": "TechArticle",
        "headline": "Aetheroll vs. TeleDrive & Teldrive: Dedicated Media Gallery vs File Storage",
        "description": "Technical comparison between Aetheroll's 10-worker MTProto streaming gallery and TeleDrive file bot.",
        "author": {
          "@type": "Person",
          "name": "Shiva Reddy",
        },
      },
    ],
  };

  const specs = [
    {
      feature: "Target Use Case",
      teledrive: "Generic file list & folder explorer",
      aetheroll: "Purpose-built Google Photos media gallery",
    },
    {
      feature: "4K Video Range Streaming",
      teledrive: "Single-thread sequential download",
      aetheroll: "10-Worker MTProto 16MB Chunk Stream",
    },
    {
      feature: "EXIF & Camera Telemetry",
      teledrive: "None (Treats media as raw files)",
      aetheroll: "Full EXIF (Model, Lens, Aperture, ISO, GPS)",
    },
    {
      feature: "Progressive Image Loading",
      teledrive: "None (Wait for full download)",
      aetheroll: "BlurHash progressive preview instant decode",
    },
    {
      feature: "Session Key Security",
      teledrive: "Plaintext auth tokens in DB",
      aetheroll: "Dual-Key HKDF-SHA256 Zero-Knowledge",
    },
    {
      feature: "Disaster Recovery",
      teledrive: "Requires DB snapshot backups",
      aetheroll: "Append-Only Telegram WAL Replay",
    },
    {
      feature: "Server Architecture",
      teledrive: "Requires 24/7 VPS hosting",
      aetheroll: "$0/mo Serverless Edge (Cloudflare)",
    },
  ];

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col selection:bg-zinc-800 selection:text-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <LandingNavbar />

      <main className="flex-1 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-20">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-xs text-zinc-500 mb-8 font-mono">
          <Link href="/" className="hover:text-zinc-300 transition-colors">
            Home
          </Link>
          <span>/</span>
          <span>Comparisons</span>
          <span>/</span>
          <span className="text-zinc-300">TeleDrive Alternative</span>
        </div>

        {/* Editorial Header */}
        <div className="mb-14">
          <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-400 text-xs font-mono mb-4">
            <span>MEDIA SPECIALIZATION BENCHMARK</span>
          </div>
          <h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-white mb-6 leading-tight">
            Aetheroll vs. TeleDrive & Teldrive
          </h1>
          <p className="text-base sm:text-lg text-zinc-400 leading-relaxed">
            Projects like TeleDrive demonstrated the utility of Telegram as cloud storage, but were architected as generic Google Drive file tree clones. Aetheroll was purpose-built as a dedicated, high-performance Google Photos replacement for visual media.
          </p>
        </div>

        {/* Comparison Table */}
        <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/30 mb-16">
          <table className="w-full text-left border-collapse text-xs sm:text-sm min-w-[580px]">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900/80 text-xs uppercase font-mono text-zinc-400">
                <th className="py-4 px-6 font-semibold w-1/3">Capability</th>
                <th className="py-4 px-6 font-medium text-zinc-400 w-1/3">TeleDrive / Teldrive</th>
                <th className="py-4 px-6 font-semibold text-zinc-100 bg-zinc-800/50 border-l border-zinc-700/80 w-1/3">
                  Aetheroll Edge
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {specs.map((item, idx) => (
                <tr key={idx} className="hover:bg-zinc-900/40 transition-colors">
                  <td className="py-4 px-6 font-medium text-zinc-200">
                    {item.feature}
                  </td>
                  <td className="py-4 px-6 text-zinc-400">
                    {item.teledrive}
                  </td>
                  <td className="py-4 px-6 font-semibold text-zinc-100 bg-zinc-800/30 border-l border-zinc-700/80">
                    {item.aetheroll}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Deep Dive Bento Grid */}
        <div className="space-y-6 mb-16">
          <h2 className="text-2xl font-bold text-white tracking-tight">
            Architectural Differences
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-6 rounded-xl border border-zinc-800 bg-zinc-900/40 flex flex-col justify-between">
              <div>
                <div className="w-9 h-9 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-200 mb-4">
                  <Film className="w-4 h-4" />
                </div>
                <h3 className="text-base font-semibold text-white mb-2">
                  Parallel Range Streaming vs. Sequential Download
                </h3>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  TeleDrive requires downloading large video files sequentially, resulting in buffering stalls during timeline scrubbing. Aetheroll coordinates 10 concurrent chunk workers to stream only the requested 16MB lookahead segments.
                </p>
              </div>
            </div>

            <div className="p-6 rounded-xl border border-zinc-800 bg-zinc-900/40 flex flex-col justify-between">
              <div>
                <div className="w-9 h-9 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-200 mb-4">
                  <Camera className="w-4 h-4" />
                </div>
                <h3 className="text-base font-semibold text-white mb-2">
                  BlurHash Progressive Loading
                </h3>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Instead of staring at blank file icons, Aetheroll generates 32-byte BlurHash placeholders that decode instantly in the browser while high-resolution media streams in the background.
                </p>
              </div>
            </div>

            <div className="p-6 rounded-xl border border-zinc-800 bg-zinc-900/40 flex flex-col justify-between">
              <div>
                <div className="w-9 h-9 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-200 mb-4">
                  <Lock className="w-4 h-4" />
                </div>
                <h3 className="text-base font-semibold text-white mb-2">
                  Zero-Knowledge Security
                </h3>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  TeleDrive stores raw Telegram session strings in its database. Aetheroll splits credentials via Dual-Key HKDF so the server database stores only AES-GCM ciphertext undecryptable without the client cookie.
                </p>
              </div>
            </div>

            <div className="p-6 rounded-xl border border-zinc-800 bg-zinc-900/40 flex flex-col justify-between">
              <div>
                <div className="w-9 h-9 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-200 mb-4">
                  <Database className="w-4 h-4" />
                </div>
                <h3 className="text-base font-semibold text-white mb-2">
                  Telegram Append-Only WAL
                </h3>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  If your server is ever lost, Aetheroll replays encrypted event logs directly from Telegram message threads to restore 100% of your albums, tags, and timeline grouping.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* CTA Banner */}
        <div className="p-8 rounded-xl border border-zinc-800 bg-zinc-900/40 text-center flex flex-col items-center">
          <h3 className="text-xl font-bold text-white mb-2">
            Experience the dedicated media gallery
          </h3>
          <p className="text-xs text-zinc-400 max-w-md mb-6 leading-relaxed">
            Fast, private, and unlimited. Connect your Telegram account in seconds.
          </p>
          <Link
            href="/app"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-xs font-medium text-zinc-950 bg-white hover:bg-zinc-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] transition-colors"
          >
            <span>Launch Web Gallery</span>
            <ArrowRight className="w-3.5 h-3.5 text-zinc-600" />
          </Link>
        </div>
      </main>

      <LandingFooter />
    </div>
  );
}
