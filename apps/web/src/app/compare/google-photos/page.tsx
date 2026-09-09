import React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { LandingNavbar } from "@/components/landing/LandingNavbar";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { SITE_URL } from "@/lib/brand";
import {
  ArrowRight,
  ShieldCheck,
  Zap,
  Camera,
  HardDrive,
  Lock,
  Cpu,
  CheckCircle2,
} from "lucide-react";

export const metadata: Metadata = {
  title: "Aetheroll vs Google Photos: The Free Unlimited Storage Alternative",
  description:
    "Looking for a free, unlimited Google Photos alternative? Compare Aetheroll vs Google Photos on storage limits, monthly pricing, compression, privacy, and 4K video streaming.",
  keywords: [
    "google photos alternative",
    "free unlimited photo storage",
    "google photos full alternative",
    "google photos telegram",
    "unlimited photo cloud backup",
    "best google photos alternative 2026",
  ],
  alternates: {
    canonical: `${SITE_URL}/compare/google-photos`,
  },
  openGraph: {
    title: "Aetheroll vs Google Photos — Free Unlimited Cloud Photo Gallery",
    description:
      "Stop paying for Google One storage. Turn Telegram into a private, unlimited Google Photos vault with zero compression and sub-5ms 4K video streaming.",
    url: `${SITE_URL}/compare/google-photos`,
  },
};

export default function CompareGooglePhotosPage() {
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
            "name": "Google Photos Alternative",
            "item": `${SITE_URL}/compare/google-photos`,
          },
        ],
      },
      {
        "@type": "TechArticle",
        "headline": "Aetheroll vs. Google Photos: Free Unlimited Storage Alternative",
        "description": "Technical benchmark and cost breakdown comparing Aetheroll on Telegram vs Google Photos.",
        "author": {
          "@type": "Person",
          "name": "Shiva Reddy",
        },
      },
    ],
  };

  const specs = [
    {
      feature: "Storage Cap",
      google: "15 GB Free (Shared with Drive/Gmail)",
      aetheroll: "100% Unlimited (Telegram Backend)",
    },
    {
      feature: "Monthly Pricing (2 TB)",
      google: "$9.99 / mo ($120/year)",
      aetheroll: "$0.00 / month Forever",
    },
    {
      feature: "Media Compression",
      google: "Lossy compression unless paying",
      aetheroll: "100% Original Quality + Full EXIF",
    },
    {
      feature: "4K Video Playback",
      google: "Proprietary transcoding delay",
      aetheroll: "10-Worker MTProto 16MB Chunk Stream",
    },
    {
      feature: "Privacy & Encryption",
      google: "No (AI models scan library)",
      aetheroll: "Dual-Key HKDF-SHA256 Zero-Knowledge",
    },
    {
      feature: "Disaster Recovery",
      google: "Manual Google Takeout",
      aetheroll: "Append-Only Telegram WAL Replay",
    },
    {
      feature: "Hosting Cost",
      google: "N/A (Closed SaaS)",
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
          <span className="text-zinc-300">Google Photos Alternative</span>
        </div>

        {/* Editorial Header */}
        <div className="mb-14">
          <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-400 text-xs font-mono mb-4">
            <span>BENCHMARK ANALYSIS</span>
          </div>
          <h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-white mb-6 leading-tight">
            Aetheroll vs. Google Photos
          </h1>
          <p className="text-base sm:text-lg text-zinc-400 leading-relaxed">
            In June 2021, Google eliminated free unlimited storage for Google Photos, forcing millions into recurring Google One subscriptions. Aetheroll provides an open-source, zero-cost alternative powered by private Telegram channels.
          </p>
        </div>

        {/* Feature Comparison Matrix */}
        <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/30 mb-16">
          <table className="w-full text-left border-collapse text-xs sm:text-sm min-w-[580px]">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900/80 text-xs uppercase font-mono text-zinc-400">
                <th className="py-4 px-6 font-semibold w-1/3">Specification</th>
                <th className="py-4 px-6 font-medium text-zinc-400 w-1/3">Google Photos</th>
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
                    {item.google}
                  </td>
                  <td className="py-4 px-6 font-semibold text-zinc-100 bg-zinc-800/30 border-l border-zinc-700/80">
                    {item.aetheroll}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Deep Dive Bento Sections */}
        <div className="space-y-6 mb-16">
          <h2 className="text-2xl font-bold text-white tracking-tight">
            Why Photographers Migrate to Aetheroll
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-6 rounded-xl border border-zinc-800 bg-zinc-900/40 flex flex-col justify-between">
              <div>
                <div className="w-9 h-9 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-200 mb-4">
                  <Camera className="w-4 h-4" />
                </div>
                <h3 className="text-base font-semibold text-white mb-2">
                  Zero Lossy Re-Encoding
                </h3>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Google Photos secretly converts your high-bitrate RAW files into compressed JPEGs unless you pay for Google One storage tiers. Aetheroll stores every pixel and metadata tag exactly as captured.
                </p>
              </div>
            </div>

            <div className="p-6 rounded-xl border border-zinc-800 bg-zinc-900/40 flex flex-col justify-between">
              <div>
                <div className="w-9 h-9 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-200 mb-4">
                  <Lock className="w-4 h-4" />
                </div>
                <h3 className="text-base font-semibold text-white mb-2">
                  Private & Zero-Knowledge
                </h3>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Google scans your photos to train machine learning models and target advertisements. Aetheroll encrypts your session with HKDF-SHA256, leaving no plaintext credentials on server databases.
                </p>
              </div>
            </div>

            <div className="p-6 rounded-xl border border-zinc-800 bg-zinc-900/40 flex flex-col justify-between">
              <div>
                <div className="w-9 h-9 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-200 mb-4">
                  <Cpu className="w-4 h-4" />
                </div>
                <h3 className="text-base font-semibold text-white mb-2">
                  10-Worker MTProto Streaming
                </h3>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Enjoy instant, sub-5ms seek times on multi-gigabyte 4K 60fps videos with parallel 16MB lookahead range chunk workers inside Cloudflare Durable Objects.
                </p>
              </div>
            </div>

            <div className="p-6 rounded-xl border border-zinc-800 bg-zinc-900/40 flex flex-col justify-between">
              <div>
                <div className="w-9 h-9 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-200 mb-4">
                  <HardDrive className="w-4 h-4" />
                </div>
                <h3 className="text-base font-semibold text-white mb-2">
                  $0/Month Serverless Edge
                </h3>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Runs indefinitely on Cloudflare's free tier with zero server maintenance, zero subscription bills, and automatic edge deployment across 300+ global cities.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Call to Action Bar */}
        <div className="p-8 rounded-xl border border-zinc-800 bg-zinc-900/40 text-center flex flex-col items-center">
          <h3 className="text-xl font-bold text-white mb-2">
            Ready to reclaim unlimited cloud storage?
          </h3>
          <p className="text-xs text-zinc-400 max-w-md mb-6 leading-relaxed">
            Connect your Telegram account in 5 seconds via QR login. No credit card required.
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
