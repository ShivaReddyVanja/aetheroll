"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { LandingNavbar } from "@/components/landing/LandingNavbar";
import { HeroSection } from "@/components/landing/HeroSection";
import { ComparisonSection } from "@/components/landing/ComparisonSection";
import { FeaturesSection } from "@/components/landing/FeaturesSection";
import { FaqSection } from "@/components/landing/FaqSection";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { apiFetch } from "@/lib/config";
import { ArrowRight } from "lucide-react";

export default function RootLandingPage() {
  const [user, setUser] = useState<{ id: string; displayName?: string } | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Background check for existing session
  useEffect(() => {
    let isMounted = true;
    apiFetch("/api/auth/me")
      .then((res) => res.json())
      .then((data) => {
        if (isMounted && data.authenticated && data.user) {
          setUser(data.user);
        }
      })
      .catch(() => {
        // Silently continue for unauthenticated visitors
      })
      .finally(() => {
        if (isMounted) setCheckingAuth(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col selection:bg-zinc-800 selection:text-white">
      {/* Compact Active Session Notification Bar */}
      {user && (
        <div className="bg-zinc-900/95 border-b border-zinc-800 text-zinc-400 text-[11px] sm:text-xs font-medium py-1.5 px-3 flex items-center justify-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
          <span className="truncate">
            <span className="hidden sm:inline">Active session: </span>
            <strong className="text-zinc-200 font-semibold">{user.displayName || "Telegram User"}</strong>
          </span>
          <span className="text-zinc-600 mx-0.5">•</span>
          <Link
            href="/app"
            className="inline-flex items-center gap-0.5 text-zinc-100 hover:text-white font-medium underline underline-offset-2 flex-shrink-0"
          >
            <span>Open Gallery</span>
            <ArrowRight className="w-3 h-3 text-zinc-400" />
          </Link>
        </div>
      )}

      {/* Navigation Bar */}
      <LandingNavbar hasActiveSession={!!user} />

      {/* Main Content Sections */}
      <main className="flex-1">
        {/* Hero with Interactive Product Simulator */}
        <HeroSection hasActiveSession={!!user} />

        {/* Bento Grid Architecture */}
        <FeaturesSection />

        {/* Technical Benchmark Matrix */}
        <ComparisonSection />

        {/* Technical FAQ */}
        <FaqSection />
      </main>

      {/* Footer */}
      <LandingFooter />
    </div>
  );
}
