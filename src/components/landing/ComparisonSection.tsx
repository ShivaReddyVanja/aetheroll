"use client";

import React from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

export function ComparisonSection() {
  const specs = [
    {
      metric: "Free Storage Allocation",
      google: "15 GB Free (Shared with Gmail/Drive)",
      icloud: "5 GB Free",
      teledrive: "Unlimited (Telegram)",
      aetheroll: "100% Unlimited (Telegram)",
      highlight: true,
    },
    {
      metric: "Monthly Cost (2 TB)",
      google: "$9.99 / mo ($120/yr)",
      icloud: "$9.99 / mo ($120/yr)",
      teledrive: "$5–$20/mo VPS Server",
      aetheroll: "$0.00 / month Forever",
      highlight: true,
    },
    {
      metric: "Media Compression & EXIF",
      google: "Lossy compression unless paying",
      icloud: "Fills paid quota",
      teledrive: "Generic file list",
      aetheroll: "100% Original Quality + Full EXIF",
      highlight: true,
    },
    {
      metric: "4K Video Scrubbing Engine",
      google: "Proprietary transcoding",
      icloud: "Native",
      teledrive: "Buffers on range seeks",
      aetheroll: "10-Worker Parallel 16MB Chunk Stream",
      highlight: true,
    },
    {
      metric: "Zero-Knowledge Encryption",
      google: "No (Scanned by Google AI)",
      icloud: "No (Apple managed keys)",
      teledrive: "Plaintext DB Tokens",
      aetheroll: "Dual-Key HKDF-SHA256 Envelope",
      highlight: true,
    },
    {
      metric: "Disaster Recovery",
      google: "Manual Google Takeout",
      icloud: "iCloud Sync",
      teledrive: "Database backup required",
      aetheroll: "Append-Only Telegram WAL Replay",
      highlight: false,
    },
    {
      metric: "Self-Hosting Requirement",
      google: "N/A (Closed SaaS)",
      icloud: "N/A (Closed SaaS)",
      teledrive: "24/7 VPS Server (Go/Node daemon)",
      aetheroll: "$0/mo Serverless (Cloudflare Workers)",
      highlight: true,
    },
  ];

  return (
    <section id="comparison" className="py-24 md:py-32 bg-zinc-950 border-t border-zinc-800/80 scroll-mt-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mb-16 text-left">
          <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-400 text-xs font-mono mb-4">
            <span>BENCHMARK COMPARISON</span>
          </div>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-white mb-4">
            Built Different from the Ground Up
          </h2>
          <p className="text-base text-zinc-400 leading-relaxed">
            See how Aetheroll compares against legacy cloud photo silos and generic Telegram drive wrappers.
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
