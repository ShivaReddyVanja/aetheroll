"use client";

import React from "react";
import {
  Clapperboard,
  Archive,
  Smartphone,
  Share2,
  Camera,
  Lock,
} from "lucide-react";

export function UseCasesSection() {
  const useCases = [
    {
      icon: <Clapperboard className="w-5 h-5 text-amber-400" />,
      title: "Store Movies to Watch Later",
      desc: "Save 4K movies, recorded shows, and video courses in your private cloud to stream seamlessly on your phone, tablet, or laptop anytime.",
    },
    {
      icon: <Archive className="w-5 h-5 text-blue-400" />,
      title: "Heavy \"Don't Want to Delete\" Media",
      desc: "Stash huge screen recordings, old video clips, and camera dumps that you don't use daily but want to keep safe forever without paying cloud fees.",
    },
    {
      icon: <Smartphone className="w-5 h-5 text-emerald-400" />,
      title: "Free Up Phone & iCloud Storage",
      desc: "Safely offload thousands of photos and videos from your phone to reclaim storage space without losing your original quality memories.",
    },
    {
      icon: <Share2 className="w-5 h-5 text-rose-400" />,
      title: "Full-Quality Trip & Event Albums",
      desc: "Share 20+ GB of vacation photos or family gatherings with relatives in original resolution without hitting Google Drive download quotas.",
    },
    {
      icon: <Camera className="w-5 h-5 text-purple-400" />,
      title: "RAW Photo & Video Creator Archive",
      desc: "Back up heavy 48MP ProRAW photos, 4K 60fps footage, and client deliverables with zero monthly subscription bills eating into your profits.",
    },
    {
      icon: <Lock className="w-5 h-5 text-teal-400" />,
      title: "Private Personal Memory Vault",
      desc: "Keep private personal moments and sensitive memories safely encrypted where no big tech algorithm can scan them for targeted advertising.",
    },
  ];

  return (
    <section id="use-cases" className="py-16 md:py-24 bg-zinc-950 border-t border-zinc-800/80 scroll-mt-16">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="max-w-2xl mb-10 text-left">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-400 text-xs font-medium mb-3">
            <span>POPULAR USE CASES</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white mb-2">
            Built for Whatever You Need to Store
          </h2>
          <p className="text-sm text-zinc-400 leading-relaxed">
            How people use their private unlimited vault every day.
          </p>
        </div>

        {/* Use Cases Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {useCases.map((item, idx) => (
            <div
              key={idx}
              className="p-4 sm:p-5 rounded-xl border border-zinc-800/90 bg-zinc-900/40 hover:bg-zinc-900/70 hover:border-zinc-700/80 transition-all flex flex-col justify-between group"
            >
              <div>
                <div className="w-9 h-9 rounded-lg bg-zinc-800/90 border border-zinc-700/60 flex items-center justify-center mb-3.5">
                  {item.icon}
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
