"use client";

import React, { useState } from "react";
import { ChevronDown } from "lucide-react";
import { FAQ_ITEMS } from "@/lib/faq";

export function FaqSection() {
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  const toggle = (idx: number) => {
    setOpenIdx((prev) => (prev === idx ? null : idx));
  };

  return (
    <section id="faq" className="py-24 md:py-32 bg-zinc-950 border-t border-zinc-800/80 scroll-mt-16">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl mb-16 text-left">
          <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-400 text-xs font-mono mb-4">
            <span>FREQUENTLY ASKED QUESTIONS</span>
          </div>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-white mb-4">
            Technical & Architecture FAQ
          </h2>
          <p className="text-base text-zinc-400 leading-relaxed">
            Everything you need to know about Telegram cloud storage, encryption protocols, and streaming speeds.
          </p>
        </div>

        {/* Accordions */}
        <div className="space-y-3">
          {FAQ_ITEMS.map((item, idx) => {
            const isOpen = openIdx === idx;
            return (
              <div
                key={idx}
                className="rounded-lg border border-zinc-800 bg-zinc-900/30 overflow-hidden transition-colors hover:border-zinc-700"
              >
                <button
                  onClick={() => toggle(idx)}
                  className="w-full py-4 px-6 text-left flex items-center justify-between gap-4 font-medium text-zinc-100 text-sm sm:text-base focus:outline-none"
                  aria-expanded={isOpen}
                >
                  <span>{item.question}</span>
                  <ChevronDown
                    className={`w-4 h-4 text-zinc-400 flex-shrink-0 transition-transform duration-200 ${
                      isOpen ? "rotate-180 text-zinc-100" : ""
                    }`}
                  />
                </button>
                {isOpen && (
                  <div className="px-6 pb-5 pt-1 text-xs sm:text-sm text-zinc-400 leading-relaxed border-t border-zinc-800/50">
                    {item.answer}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
