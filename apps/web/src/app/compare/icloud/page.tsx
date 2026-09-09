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
  Cpu,
  Layers,
} from "lucide-react";

export const metadata: Metadata = {
  title: "Aetheroll vs Apple iCloud Photos: Free Unlimited iPhone Backup Alternative",
  description:
    "iCloud storage full? Compare Aetheroll vs Apple iCloud Photos. Learn how to backup iPhone camera rolls and 4K ProRes videos to Telegram with zero monthly fees.",
  keywords: [
    "icloud storage full alternative",
    "free icloud photos alternative",
    "backup iphone photos to telegram",
    "icloud photos telegram backup",
    "unlimited iphone cloud storage",
  ],
  alternates: {
    canonical: `${SITE_URL}/compare/icloud`,
  },
  openGraph: {
    title: "Aetheroll vs Apple iCloud Photos — Free Unlimited iPhone Photo Backup",
    description:
      "Tired of iCloud 'Storage Almost Full' alerts? Use Telegram as your unmetered Apple Photos backup with full EXIF, HEIC, and 4K HDR video support.",
    url: `${SITE_URL}/compare/icloud`,
  },
};

export default function CompareICloudPage() {
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
            "name": "Apple iCloud Alternative",
            "item": `${SITE_URL}/compare/icloud`,
          },
        ],
      },
      {
        "@type": "TechArticle",
        "headline": "Aetheroll vs. Apple iCloud Photos: Free Unlimited Storage Alternative",
        "description": "Compare Aetheroll on Telegram against Apple iCloud storage limits and subscription fees.",
        "author": {
          "@type": "Person",
          "name": "Shiva Reddy",
        },
      },
    ],
  };

  const specs = [
    {
      feature: "Free Storage Allocation",
      icloud: "5 GB Free (Fills up quickly)",
      aetheroll: "100% Unlimited (Telegram Backend)",
    },
    {
      feature: "Monthly Pricing (2 TB)",
      icloud: "$9.99 / mo ($120/year)",
      aetheroll: "$0.00 / month Forever",
    },
    {
      feature: "HEIC & Apple ProRAW",
      icloud: "Supported (Consumes paid quota)",
      aetheroll: "100% Original Quality + Full EXIF",
    },
    {
      feature: "4K 60fps Video Storage",
      icloud: "Consumes storage rapidly",
      aetheroll: "10-Worker MTProto 16MB Chunk Stream",
    },
    {
      feature: "Cross-Platform Web Access",
      icloud: "Limited web viewer",
      aetheroll: "Full Google Photos Material 3 Web Gallery",
    },
    {
      feature: "Zero-Knowledge Encryption",
      icloud: "Apple-managed keys",
      aetheroll: "Dual-Key HKDF-SHA256 Zero-Knowledge",
    },
    {
      feature: "Disaster Recovery",
      icloud: "iCloud Sync",
      aetheroll: "Append-Only Telegram WAL Replay",
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
          <span className="text-zinc-300">Apple iCloud Alternative</span>
        </div>

        {/* Editorial Header */}
        <div className="mb-14">
          <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-400 text-xs font-mono mb-4">
            <span>IPHONE STORAGE ARCHITECTURE</span>
          </div>
          <h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-white mb-6 leading-tight">
            Aetheroll vs. Apple iCloud Photos
          </h1>
          <p className="text-base sm:text-lg text-zinc-400 leading-relaxed">
            Apple provides 5 GB of free iCloud storage—enough for only a few minutes of 4K 60fps iPhone video. Aetheroll provides an unmetered, high-performance photo and video backup destination powered by Telegram.
          </p>
        </div>

        {/* Comparison Table */}
        <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/30 mb-16">
          <table className="w-full text-left border-collapse text-xs sm:text-sm min-w-[580px]">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900/80 text-xs uppercase font-mono text-zinc-400">
                <th className="py-4 px-6 font-semibold w-1/3">Capability</th>
                <th className="py-4 px-6 font-medium text-zinc-400 w-1/3">Apple iCloud Photos</th>
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
                    {item.icloud}
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
            Overcoming iCloud Storage Limits
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-6 rounded-xl border border-zinc-800 bg-zinc-900/40 flex flex-col justify-between">
              <div>
                <div className="w-9 h-9 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-200 mb-4">
                  <Camera className="w-4 h-4" />
                </div>
                <h3 className="text-base font-semibold text-white mb-2">
                  Full 48MP Apple ProRAW & HEIC
                </h3>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  iPhone 14/15/16 ProRAW photos can exceed 75 MB per capture. Aetheroll archives raw `.dng` and `.heic` binaries without downgrading resolution.
                </p>
              </div>
            </div>

            <div className="p-6 rounded-xl border border-zinc-800 bg-zinc-900/40 flex flex-col justify-between">
              <div>
                <div className="w-9 h-9 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-200 mb-4">
                  <Zap className="w-4 h-4" />
                </div>
                <h3 className="text-base font-semibold text-white mb-2">
                  4K 60fps Video Streaming
                </h3>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Stream high-bitrate iPhone video directly from Telegram Data Centers via 10 parallel chunk workers with sub-5ms seek latency.
                </p>
              </div>
            </div>

            <div className="p-6 rounded-xl border border-zinc-800 bg-zinc-900/40 flex flex-col justify-between">
              <div>
                <div className="w-9 h-9 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-200 mb-4">
                  <HardDrive className="w-4 h-4" />
                </div>
                <h3 className="text-base font-semibold text-white mb-2">
                  No More &quot;Storage Almost Full&quot; Alerts
                </h3>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Store hundreds of gigabytes of travel memories in private Telegram channels without paying Apple $120 every year.
                </p>
              </div>
            </div>

            <div className="p-6 rounded-xl border border-zinc-800 bg-zinc-900/40 flex flex-col justify-between">
              <div>
                <div className="w-9 h-9 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-200 mb-4">
                  <Cpu className="w-4 h-4" />
                </div>
                <h3 className="text-base font-semibold text-white mb-2">
                  Universal Cross-Platform Access
                </h3>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Access your entire library seamlessly on Mac, Windows, Linux, Android, and iOS browsers through the modern Aetheroll web app.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* CTA Bar */}
        <div className="p-8 rounded-xl border border-zinc-800 bg-zinc-900/40 text-center flex flex-col items-center">
          <h3 className="text-xl font-bold text-white mb-2">
            Start backing up your iPhone media for free
          </h3>
          <p className="text-xs text-zinc-400 max-w-md mb-6 leading-relaxed">
            Connect your Telegram account with zero setup.
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
