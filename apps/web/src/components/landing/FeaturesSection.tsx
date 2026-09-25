"use client";

import React from "react";
import {
  HardDrive,
  Film,
  Share2,
  LayoutGrid,
  Camera,
  ShieldCheck,
} from "lucide-react";

export function FeaturesSection() {
  const features = [
    {
      icon: <HardDrive className="w-5 h-5 text-emerald-400" />,
      title: "Unlimited Cloud Storage",
      desc: "Upload infinite photos, 4K videos, and heavy files with zero storage limits and $0 monthly fees.",
      badge: "Free Forever",
    },
    {
      icon: <Film className="w-5 h-5 text-amber-400" />,
      title: "Optimized 4K Streaming",
      desc: "Instant video playback and smooth scrubbing without waiting for massive files to download.",
      badge: "Zero Buffering",
    },
    {
      icon: <Share2 className="w-5 h-5 text-blue-400" />,
      title: "Shareable Web Links",
      desc: "Send private links to friends and family to view and download full-resolution photos directly in browser.",
      badge: "One-Click",
    },
    {
      icon: <LayoutGrid className="w-5 h-5 text-rose-400" />,
      title: "Google Photos-Style UI",
      desc: "Smooth masonry gallery with timeline scrubber to jump by year, tag collections, and favorite photos.",
      badge: "Modern Grid",
    },
    {
      icon: <Camera className="w-5 h-5 text-purple-400" />,
      title: "100% Original Quality",
      desc: "Zero compression. Preserves 48MP resolution, ProRAW photos, lens apertures, and GPS location pins.",
      badge: "No Compression",
    },
    {
      icon: <ShieldCheck className="w-5 h-5 text-teal-400" />,
      title: "Private & Encrypted",
      desc: "Your files stay locked in your private vault. No ads, no data mining, and no AI model training.",
      badge: "Zero Scanning",
    },
  ];

  return (
    <section id="features" className="py-16 md:py-24 bg-zinc-950 border-t border-zinc-800/80 scroll-mt-16">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Compact Section Header */}
        <div className="max-w-2xl mb-10 text-left">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-400 text-xs font-medium mb-3">
            <span>CORE FEATURES</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white mb-2">
            Everything Built In. Nothing Cut Down.
          </h2>
          <p className="text-sm text-zinc-400 leading-relaxed">
            All the essentials of a modern photo cloud without storage quotas or monthly rent.
          </p>
        </div>

        {/* Small, Compact Feature Boxes */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {features.map((item, idx) => (
            <div
              key={idx}
              className="p-4 sm:p-5 rounded-xl border border-zinc-800/90 bg-zinc-900/40 hover:bg-zinc-900/70 hover:border-zinc-700/80 transition-all flex flex-col justify-between group"
            >
              <div>
                <div className="flex items-center justify-between mb-3.5">
                  <div className="w-9 h-9 rounded-lg bg-zinc-800/90 border border-zinc-700/60 flex items-center justify-center">
                    {item.icon}
                  </div>
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-zinc-800/80 text-zinc-400 border border-zinc-700/50">
                    {item.badge}
                  </span>
                </div>
                <h3 className="text-sm sm:text-base font-semibold text-white mb-1.5 group-hover:text-zinc-100 transition-colors">
                  {item.title}
                </h3>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  {item.desc}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
