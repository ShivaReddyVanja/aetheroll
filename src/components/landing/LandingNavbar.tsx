"use client";

import React, { useState } from "react";
import Link from "next/link";
import { BrandIcon } from "@/components/BrandIcon";
import { ArrowUpRight, Sparkles, Menu, X } from "lucide-react";

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

interface LandingNavbarProps {
  hasActiveSession?: boolean;
}

export function LandingNavbar({ hasActiveSession }: LandingNavbarProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 w-full backdrop-blur-md bg-zinc-950/80 border-b border-zinc-800/80 transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
        {/* Logo & Brand */}
        <Link href="/" className="flex items-center gap-2.5 group">
          <BrandIcon size={22} className="flex-shrink-0 group-hover:opacity-90 transition-opacity" />
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold tracking-tight text-zinc-100">
              Aetheroll
            </span>
            <span className="text-[10px] font-mono text-zinc-400 border border-zinc-800 px-1.5 py-0.5 rounded bg-zinc-900/80">
              Edge
            </span>
          </div>
        </Link>

        {/* Desktop Nav Links */}
        <nav className="hidden md:flex items-center gap-7 text-xs font-medium text-zinc-400">
          <Link href="/#features" className="hover:text-zinc-100 transition-colors">
            Features
          </Link>
          <Link href="/#comparison" className="hover:text-zinc-100 transition-colors">
            Comparison
          </Link>
          <Link href="/#faq" className="hover:text-zinc-100 transition-colors">
            FAQ
          </Link>
          <Link
            href="/compare/google-photos"
            className="hover:text-zinc-200 transition-colors"
          >
            vs Google Photos
          </Link>
          <Link
            href="/compare/teledrive"
            className="hover:text-zinc-200 transition-colors"
          >
            vs TeleDrive
          </Link>
          <Link
            href="/compare/icloud"
            className="hover:text-zinc-200 transition-colors"
          >
            vs iCloud
          </Link>
        </nav>

        {/* Right Action Buttons */}
        <div className="flex items-center gap-2.5">
          <a
            href="https://github.com/ShivaReddyVanja/aetheroll"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:text-zinc-100 bg-zinc-900/90 hover:bg-zinc-800 border border-zinc-800 rounded-lg transition-colors"
          >
            <GithubIcon className="w-3.5 h-3.5" />
            <span>GitHub</span>
          </a>

          <Link
            href="/app"
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-lg text-zinc-950 bg-white hover:bg-zinc-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] transition-all"
          >
            {hasActiveSession ? (
              <>
                <Sparkles className="w-3.5 h-3.5 text-amber-500 animate-pulse" />
                <span>Open Gallery</span>
              </>
            ) : (
              <>
                <span>Launch App</span>
                <ArrowUpRight className="w-3.5 h-3.5 text-zinc-600" />
              </>
            )}
          </Link>

          {/* Mobile Menu Toggle Button */}
          <button
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            aria-label="Toggle Navigation Menu"
            className="md:hidden p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 border border-transparent hover:border-zinc-800 transition-colors"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden border-b border-zinc-800 bg-zinc-950/95 backdrop-blur-xl px-4 py-4 space-y-3">
          <div className="grid grid-cols-2 gap-2 text-xs font-medium text-zinc-300 pb-3 border-b border-zinc-800/80">
            <Link
              href="/#features"
              onClick={() => setMobileMenuOpen(false)}
              className="p-2 rounded-lg bg-zinc-900/50 hover:bg-zinc-900 border border-zinc-800/50"
            >
              Features
            </Link>
            <Link
              href="/#comparison"
              onClick={() => setMobileMenuOpen(false)}
              className="p-2 rounded-lg bg-zinc-900/50 hover:bg-zinc-900 border border-zinc-800/50"
            >
              Comparison
            </Link>
            <Link
              href="/#faq"
              onClick={() => setMobileMenuOpen(false)}
              className="p-2 rounded-lg bg-zinc-900/50 hover:bg-zinc-900 border border-zinc-800/50"
            >
              FAQ
            </Link>
            <a
              href="https://github.com/ShivaReddyVanja/aetheroll"
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 rounded-lg bg-zinc-900/50 hover:bg-zinc-900 border border-zinc-800/50 flex items-center gap-1.5 text-zinc-300"
            >
              <GithubIcon className="w-3.5 h-3.5" />
              <span>GitHub</span>
            </a>
          </div>

          <div className="space-y-1 pt-1 text-xs">
            <div className="font-mono uppercase text-[10px] text-zinc-500 px-2 py-1">
              Alternative Comparisons
            </div>
            <Link
              href="/compare/google-photos"
              onClick={() => setMobileMenuOpen(false)}
              className="block px-2 py-1.5 rounded-md text-zinc-300 hover:text-white hover:bg-zinc-900 transition-colors"
            >
              vs Google Photos
            </Link>
            <Link
              href="/compare/teledrive"
              onClick={() => setMobileMenuOpen(false)}
              className="block px-2 py-1.5 rounded-md text-zinc-300 hover:text-white hover:bg-zinc-900 transition-colors"
            >
              vs TeleDrive & Teldrive
            </Link>
            <Link
              href="/compare/icloud"
              onClick={() => setMobileMenuOpen(false)}
              className="block px-2 py-1.5 rounded-md text-zinc-300 hover:text-white hover:bg-zinc-900 transition-colors"
            >
              vs Apple iCloud Photos
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
