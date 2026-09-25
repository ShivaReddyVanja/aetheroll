"use client";

import React from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

export function ComparisonSection() {
  const specs = [
    {
      metric: "Free Storage Space",
      google: "15 GB (Shared with Gmail & Drive)",
      icloud: "5 GB (Fills up quickly)",
      teledrive: "Unlimited (Telegram)",
      aetheroll: "100% Unlimited Free Storage",
      highlight: true,
    },
    {
      metric: "Monthly Cost (2 TB+)",
      google: "$9.99 / mo ($120/yr)",
      icloud: "$9.99 / mo ($120/yr)",
      teledrive: "$5–$20/mo VPS Server",
      aetheroll: "$0.00 / month Forever",
      highlight: true,
    },
    {
      metric: "Photo & Video Quality",
      google: "Compressed unless paying top tier",
      icloud: "Original (fills paid quota)",
      teledrive: "Original file list",
      aetheroll: "100% Original (48MP RAW & 4K HDR)",
      highlight: true,
    },
    {
      metric: "4K Video Playback",
      google: "Transcoded / delayed buffering",
      icloud: "Native iOS playback",
      teledrive: "Buffers on range seek",
      aetheroll: "Instant, Smooth 4K Streaming",
      highlight: true,
    },
    {
      metric: "Privacy & Data Scanning",
      google: "Scanned for Ads & AI training",
      icloud: "Apple managed server keys",
      teledrive: "Unencrypted server tokens",
      aetheroll: "Zero Scanning • 100% Private Vault",
      highlight: true,
    },
    {
      metric: "Automatic Phone Backup",
      google: "Included",
      icloud: "Included (Apple devices)",
      teledrive: "Manual upload only",
      aetheroll: "Background Camera Roll Sync",
      highlight: false,
    },
    {
      metric: "Ease of Access",
      google: "Web & Mobile apps",
      icloud: "Best on Apple devices only",
      teledrive: "Web app only",
      aetheroll: "Android App & Universal Web App",
      highlight: true,
    },
  ];

  return (
    <section id="comparison" className="py-24 md:py-32 bg-zinc-950 border-t border-zinc-800/80 scroll-mt-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mb-16 text-left">
          <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-400 text-xs font-medium mb-4">
            <span>HOW WE COMPARE</span>
          </div>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-white mb-4">
            Better Storage. Zero Monthly Bills.
          </h2>
          <p className="text-base text-zinc-400 leading-relaxed">
            See how Aetheroll gives you the full experience of premium cloud photo apps without the recurring subscriptions.
          </p>
        </div>

        {/* High-Density Matrix Table */}
        <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/30">
          <table className="w-full text-left border-collapse min-w-[720px] text-xs sm:text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900/80 text-zinc-400 font-mono text-xs uppercase tracking-wider">
                <th className="py-4 px-6 font-semibold w-1/4">Specification</th>
                <th className="py-4 px-6 font-medium text-zinc-400 w-1/5">Google Photos</th>
                <th className="py-4 px-6 font-medium text-zinc-400 w-1/5">Apple iCloud</th>
                <th className="py-4 px-6 font-medium text-zinc-400 w-1/5">TeleDrive / Teldrive</th>
                <th className="py-4 px-6 font-semibold text-zinc-100 bg-zinc-800/50 border-l border-zinc-700/80 w-1/4">
                  Aetheroll Edge
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {specs.map((item, idx) => (
                <tr key={idx} className="hover:bg-zinc-900/50 transition-colors">
                  <td className="py-4 px-6 font-medium text-zinc-200">
                    {item.metric}
                  </td>
                  <td className="py-4 px-6 text-zinc-400 font-normal">
                    {item.google}
                  </td>
                  <td className="py-4 px-6 text-zinc-400 font-normal">
                    {item.icloud}
                  </td>
                  <td className="py-4 px-6 text-zinc-400 font-normal">
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

        {/* Deep Dive Articles Grid */}
        <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Link
            href="/compare/google-photos"
            className="p-5 rounded-xl border border-zinc-800 bg-zinc-900/40 hover:bg-zinc-900 hover:border-zinc-700 transition-all flex items-center justify-between group"
          >
            <div>
              <p className="text-[11px] font-mono text-zinc-500 uppercase">Analysis</p>
              <p className="text-sm font-semibold text-zinc-200 group-hover:text-white transition-colors">
                vs Google Photos
              </p>
            </div>
            <ArrowUpRight className="w-4 h-4 text-zinc-500 group-hover:text-zinc-200 transition-colors" />
          </Link>

          <Link
            href="/compare/teledrive"
            className="p-5 rounded-xl border border-zinc-800 bg-zinc-900/40 hover:bg-zinc-900 hover:border-zinc-700 transition-all flex items-center justify-between group"
          >
            <div>
              <p className="text-[11px] font-mono text-zinc-500 uppercase">Analysis</p>
              <p className="text-sm font-semibold text-zinc-200 group-hover:text-white transition-colors">
                vs TeleDrive & Teldrive
              </p>
            </div>
            <ArrowUpRight className="w-4 h-4 text-zinc-500 group-hover:text-zinc-200 transition-colors" />
          </Link>

          <Link
            href="/compare/icloud"
            className="p-5 rounded-xl border border-zinc-800 bg-zinc-900/40 hover:bg-zinc-900 hover:border-zinc-700 transition-all flex items-center justify-between group"
          >
            <div>
              <p className="text-[11px] font-mono text-zinc-500 uppercase">Analysis</p>
              <p className="text-sm font-semibold text-zinc-200 group-hover:text-white transition-colors">
                vs Apple iCloud
              </p>
            </div>
            <ArrowUpRight className="w-4 h-4 text-zinc-500 group-hover:text-zinc-200 transition-colors" />
          </Link>
        </div>
      </div>
    </section>
  );
}
