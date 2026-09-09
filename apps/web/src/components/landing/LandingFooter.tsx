"use client";

import React from "react";
import Link from "next/link";
import { BrandIcon } from "@/components/BrandIcon";
import { ArrowUpRight } from "lucide-react";

function GithubIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
      />
    </svg>
  );
}

export function LandingFooter() {
  return (
    <footer className="border-t border-zinc-800/80 bg-zinc-950 py-16 text-zinc-400 text-xs font-sans">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-10 mb-16">
          {/* Col 1: Brand Info */}
          <div className="space-y-3 md:col-span-1">
            <div className="flex items-center gap-2">
              <BrandIcon size={20} className="flex-shrink-0" />
              <span className="font-semibold text-zinc-100 text-sm">Aetheroll</span>
            </div>
            <p className="text-zinc-500 text-xs leading-relaxed max-w-xs">
              The high-performance, zero-knowledge media gallery and cloud vault powered by Telegram.
            </p>
            <div className="flex items-center gap-2 pt-1">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-[10px] font-mono text-zinc-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <span>All Systems Edge</span>
              </span>
            </div>
          </div>

          {/* Col 2: Product */}
          <div>
            <h4 className="font-medium text-zinc-200 text-xs font-mono uppercase tracking-wider mb-4">
              Product
            </h4>
            <ul className="space-y-2.5">
              <li>
                <Link href="/app" className="hover:text-zinc-200 transition-colors">
                  Web Gallery App
                </Link>
              </li>
              <li>
                <Link href="/#features" className="hover:text-zinc-200 transition-colors">
                  Architectural Specs
                </Link>
              </li>
              <li>
                <Link href="/#comparison" className="hover:text-zinc-200 transition-colors">
                  Benchmark Comparison
                </Link>
              </li>
              <li>
                <Link href="/#faq" className="hover:text-zinc-200 transition-colors">
                  Documentation FAQ
                </Link>
              </li>
            </ul>
          </div>

          {/* Col 3: Comparisons */}
          <div>
            <h4 className="font-medium text-zinc-200 text-xs font-mono uppercase tracking-wider mb-4">
              Comparisons
            </h4>
            <ul className="space-y-2.5">
              <li>
                <Link
                  href="/compare/google-photos"
                  className="hover:text-zinc-200 transition-colors"
                >
                  vs Google Photos
                </Link>
              </li>
              <li>
                <Link
                  href="/compare/teledrive"
                  className="hover:text-zinc-200 transition-colors"
                >
                  vs TeleDrive & Teldrive
                </Link>
              </li>
              <li>
                <Link
                  href="/compare/icloud"
                  className="hover:text-zinc-200 transition-colors"
                >
                  vs Apple iCloud Photos
                </Link>
              </li>
            </ul>
          </div>

          {/* Col 4: Open Source */}
          <div>
            <h4 className="font-medium text-zinc-200 text-xs font-mono uppercase tracking-wider mb-4">
              Open Source
            </h4>
            <ul className="space-y-2.5">
              <li>
                <a
                  href="https://github.com/ShivaReddyVanja/aetheroll"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 hover:text-zinc-200 transition-colors"
                >
                  <GithubIcon className="w-3.5 h-3.5" />
                  <span>GitHub Repository</span>
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/ShivaReddyVanja/aetheroll/blob/main/README.md"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 hover:text-zinc-200 transition-colors"
                >
                  <span>Architecture Docs</span>
                  <ArrowUpRight className="w-3 h-3 text-zinc-500" />
                </a>
              </li>
              <li>
                <span className="text-zinc-500">MIT Open Source License</span>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom Status Bar */}
        <div className="border-t border-zinc-900 pt-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-zinc-500 text-xs">
          <p>© {new Date().getFullYear()} Aetheroll. Built for high-speed photography & cinema.</p>
          <div className="flex items-center gap-1">
            <span>Designed & Built by</span>
            <a
              href="https://github.com/ShivaReddyVanja"
              target="_blank"
              rel="noopener noreferrer"
              className="text-zinc-300 hover:text-white font-medium ml-1"
            >
              Shiva Reddy
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
