import React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { LandingNavbar } from "@/components/landing/LandingNavbar";
import { LandingFooter } from "@/components/landing/LandingFooter";
import {
  ShieldCheck,
  Lock,
  EyeOff,
  HardDrive,
  Cpu,
  Mail,
  FileText,
  AlertCircle,
  CheckCircle2,
  Database,
  Smartphone,
} from "lucide-react";

export const metadata: Metadata = {
  title: "Privacy Policy — Aetheroll",
  description:
    "Privacy Policy for Aetheroll. Learn how your data and media are protected, encrypted, and stored in your private Telegram vault with zero third-party tracking.",
  alternates: {
    canonical: "https://aetheroll.builtbyshiva.com/privacy",
  },
  openGraph: {
    title: "Privacy Policy — Aetheroll",
    description:
      "Aetheroll Privacy Policy. Learn about our zero-knowledge architecture, hardware-backed token security, and strict data privacy standards.",
    url: "https://aetheroll.builtbyshiva.com/privacy",
  },
};

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans selection:bg-zinc-800 selection:text-zinc-100">
      <LandingNavbar />

      <main className="flex-1 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
        {/* Header */}
        <div className="space-y-4 border-b border-zinc-800 pb-10 mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-mono font-medium">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Compliance & Data Protection</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-zinc-100">
            Privacy Policy
          </h1>
          <p className="text-zinc-400 text-sm leading-relaxed max-w-2xl">
            This Privacy Policy explains how <strong>Aetheroll</strong> (&quot;we&quot;, &quot;us&quot;, or &quot;our&quot;), developed by Shiva Reddy, collects, uses, and safeguards your information when you use our mobile application and web platform at{" "}
            <a
              href="https://aetheroll.builtbyshiva.com"
              className="text-zinc-200 underline hover:text-white"
            >
              https://aetheroll.builtbyshiva.com
            </a>
            .
          </p>
          <div className="flex flex-wrap gap-4 text-xs font-mono text-zinc-500 pt-2">
            <span>Effective Date: September 9, 2026</span>
            <span>•</span>
            <span>Last Updated: September 9, 2026</span>
          </div>
        </div>

        {/* Policy Content */}
        <div className="space-y-12 text-sm text-zinc-300 leading-relaxed">
          {/* Summary Box */}
          <div className="p-6 rounded-2xl bg-zinc-900/60 border border-zinc-800/80 space-y-3">
            <h3 className="text-base font-semibold text-zinc-100 flex items-center gap-2">
              <EyeOff className="w-4 h-4 text-blue-400" />
              Privacy Highlights (TL;DR)
            </h3>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-zinc-400 pt-1">
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                <span><strong>Zero Data Selling:</strong> We never sell, rent, or monetize your personal data.</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                <span><strong>No Third-Party Ads:</strong> No trackers, ad SDKs, or analytics profiling.</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                <span><strong>User-Owned Storage:</strong> Your media lives in your own private Telegram channels.</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                <span><strong>Hardware-Backed Security:</strong> Session tokens are encrypted in device KeyStore/Keychain.</span>
              </li>
            </ul>
          </div>

          {/* 1. Information We Collect */}
          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-zinc-100 flex items-center gap-2.5">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-zinc-800 text-xs font-mono text-zinc-300">
                1
              </span>
              Information We Collect
            </h2>
            <p>
              We only collect information that is strictly necessary to provide the Aetheroll cloud gallery, backup, and streaming services:
            </p>
            <div className="space-y-3 pl-2">
              <div className="border-l-2 border-zinc-800 pl-4 space-y-1">
                <h4 className="font-semibold text-zinc-200 text-xs uppercase tracking-wide font-mono">
                  A. Telegram Authentication Credentials
                </h4>
                <p className="text-zinc-400 text-xs">
                  When you authenticate using your phone number or QR code, Aetheroll connects to Telegram&apos;s official MTProto API to authenticate your account. We receive your Telegram User ID, display name, username, and an encrypted session token. We do <strong>not</strong> store your Telegram account password.
                </p>
              </div>

              <div className="border-l-2 border-zinc-800 pl-4 space-y-1">
                <h4 className="font-semibold text-zinc-200 text-xs uppercase tracking-wide font-mono">
                  B. User Media & EXIF Metadata
                </h4>
                <p className="text-zinc-400 text-xs">
                  When you select photos or videos for upload or enable automatic camera roll backup, the media files (along with technical EXIF metadata such as capture date, dimensions, and file size) are uploaded directly to your specified private Telegram channels. A lightweight hash (BlurHash) is generated to render instant visual placeholders.
                </p>
              </div>

              <div className="border-l-2 border-zinc-800 pl-4 space-y-1">
                <h4 className="font-semibold text-zinc-200 text-xs uppercase tracking-wide font-mono">
                  C. Device & Network State
                </h4>
                <p className="text-zinc-400 text-xs">
                  The mobile app checks network connection type (Wi-Fi vs. Cellular) to respect your background backup preferences, and checks local available storage capacity to safely manage cache size.
                </p>
              </div>
            </div>
          </section>

          {/* 2. Device Permissions */}
          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-zinc-100 flex items-center gap-2.5">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-zinc-800 text-xs font-mono text-zinc-300">
                2
              </span>
              Mobile App Permissions & Justifications
            </h2>
            <p>
              To provide photo gallery and background backup services on Android and iOS, Aetheroll requests the following permissions:
            </p>
            <div className="overflow-x-auto rounded-xl border border-zinc-800">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-zinc-900/80 border-b border-zinc-800 text-zinc-300 font-mono">
                    <th className="p-3">Permission</th>
                    <th className="p-3">Purpose & Justification</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60 text-zinc-400">
                  <tr>
                    <td className="p-3 font-mono text-zinc-300 font-medium">READ_MEDIA_IMAGES / READ_MEDIA_VIDEO / READ_EXTERNAL_STORAGE</td>
                    <td className="p-3">Allows the app to display your device photos/videos in the gallery picker and upload selected media to your private Telegram vault.</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-mono text-zinc-300 font-medium">FOREGROUND_SERVICE & FOREGROUND_SERVICE_DATA_SYNC</td>
                    <td className="p-3">Allows uninterrupted, resilient background upload of large photos and 4K videos even when the app is minimized or the screen is locked.</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-mono text-zinc-300 font-medium">POST_NOTIFICATIONS</td>
                    <td className="p-3">Displays active backup progress, items remaining in queue, and completion status alerts.</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-mono text-zinc-300 font-medium">INTERNET & ACCESS_NETWORK_STATE</td>
                    <td className="p-3">Required to transfer media chunks to Telegram servers and check if the device is connected to Wi-Fi before initiating large uploads.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* 3. How We Use & Protect Data */}
          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-zinc-100 flex items-center gap-2.5">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-zinc-800 text-xs font-mono text-zinc-300">
                3
              </span>
              How We Use & Protect Your Data
            </h2>
            <p>
              Your data is processed strictly for providing and improving the core features of the Aetheroll service:
            </p>
            <ul className="space-y-2 list-disc list-inside text-zinc-400 pl-1 text-xs">
              <li>To synchronize, organize, and display your media timeline across devices.</li>
              <li>To transcode and deliver high-speed, sub-second edge video streaming.</li>
              <li>To manage automatic camera roll backups according to your configured preferences.</li>
            </ul>

            <div className="p-4 rounded-xl bg-zinc-900/40 border border-zinc-800 space-y-2 mt-4">
              <h4 className="font-semibold text-zinc-200 text-xs font-mono uppercase flex items-center gap-2">
                <Lock className="w-3.5 h-3.5 text-emerald-400" />
                Hardware-Backed Token Encryption
              </h4>
              <p className="text-zinc-400 text-xs">
                Authentication tokens on mobile devices are protected using the device&apos;s hardware security module (Android KeyStore TEE / StrongBox and iOS Secure Enclave Keychain). All transmissions between your client, our edge servers, and Telegram MTProto endpoints are strictly encrypted using TLS 1.3 / HTTPS.
              </p>
            </div>
          </section>

          {/* 4. Third-Party Services */}
          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-zinc-100 flex items-center gap-2.5">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-zinc-800 text-xs font-mono text-zinc-300">
                4
              </span>
              Third-Party Infrastructure & Disclosures
            </h2>
            <p>
              Aetheroll relies on trusted, industry-standard infrastructure providers to operate:
            </p>
            <ul className="space-y-2.5 text-xs text-zinc-400">
              <li className="flex items-start gap-2">
                <Database className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
                <div>
                  <strong className="text-zinc-200">Telegram MTProto Cloud Infrastructure:</strong> Your photos and videos are stored directly in your private Telegram channels under your Telegram account, governed by Telegram&apos;s Terms of Service and Privacy Policy.
                </div>
              </li>
              <li className="flex items-start gap-2">
                <Cpu className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                <div>
                  <strong className="text-zinc-200">Cloudflare (CDN & Workers):</strong> Used to provide edge acceleration, fast video streaming proxy, and temporary sliding LRU caching.
                </div>
              </li>
            </ul>
            <p className="text-xs text-zinc-500 italic pt-1">
              We do not share your media with any other third parties, advertising networks, data brokers, or analytics marketing platforms.
            </p>
          </section>

          {/* 5. Data Retention & User Rights */}
          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-zinc-100 flex items-center gap-2.5">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-zinc-800 text-xs font-mono text-zinc-300">
                5
              </span>
              Data Retention & Deletion Rights
            </h2>
            <p>
              You maintain full ownership and control over your photos, videos, and personal information:
            </p>
            <ul className="space-y-2 list-disc list-inside text-zinc-400 pl-1 text-xs">
              <li>
                <strong>Media Deletion:</strong> When you delete a photo or video within Aetheroll, the message is permanently deleted from your Telegram channel and purged from the edge cache.
              </li>
              <li>
                <strong>Session Revocation:</strong> Logging out from Aetheroll immediately removes all authentication tokens and cached credentials from your device&apos;s secure storage.
              </li>
              <li>
                <strong>Account & Data Deletion Request:</strong> You may request complete erasure of any index data associated with your Telegram account by contacting our Grievance Officer at{" "}
                <a href="mailto:privacy@builtbyshiva.com" className="text-blue-400 underline">
                  privacy@builtbyshiva.com
                </a>
                . Requests are processed within 15 business days.
              </li>
            </ul>
          </section>

          {/* 6. Children's Privacy */}
          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-zinc-100 flex items-center gap-2.5">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-zinc-800 text-xs font-mono text-zinc-300">
                6
              </span>
              Children&apos;s Privacy
            </h2>
            <p className="text-zinc-400 text-xs">
              Aetheroll is not intended for or directed towards children under the age of 13 (or under 18 in relevant jurisdictions). We do not knowingly collect or solicit personal information from minors. If we discover that personal data from a child has been collected, we will take prompt steps to delete that data.
            </p>
          </section>

          {/* 7. Changes to Policy */}
          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-zinc-100 flex items-center gap-2.5">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-zinc-800 text-xs font-mono text-zinc-300">
                7
              </span>
              Changes to this Privacy Policy
            </h2>
            <p className="text-zinc-400 text-xs">
              We may update this Privacy Policy periodically to reflect technological changes, product enhancements, or regulatory requirements. Any updates will be posted on this page with an updated revision date.
            </p>
          </section>

          {/* 8. Grievance Officer & Contact Information */}
          <section className="p-6 rounded-2xl bg-zinc-900/80 border border-zinc-800 space-y-4">
            <h2 className="text-lg font-semibold text-zinc-100 flex items-center gap-2">
              <Mail className="w-4 h-4 text-emerald-400" />
              Grievance Officer & Contact Information
            </h2>
            <p className="text-xs text-zinc-400">
              In accordance with the <strong>Information Technology Act, 2000</strong>, the <strong>Information Technology (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021</strong>, and the <strong>Digital Personal Data Protection Act (DPDPA), 2023</strong>, the name and contact details of the Grievance Officer are provided below:
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 text-xs">
              <div className="space-y-1">
                <span className="text-zinc-500 font-mono uppercase">Grievance Officer</span>
                <p className="font-semibold text-zinc-200">Shiva Reddy</p>
                <p className="text-zinc-400">Founder & Developer, Aetheroll</p>
              </div>
              <div className="space-y-1">
                <span className="text-zinc-500 font-mono uppercase">Contact Email</span>
                <p>
                  <a
                    href="mailto:privacy@builtbyshiva.com"
                    className="text-blue-400 hover:text-blue-300 font-mono font-medium"
                  >
                    privacy@builtbyshiva.com
                  </a>
                </p>
                <p className="text-zinc-500">Website: https://aetheroll.builtbyshiva.com</p>
              </div>
            </div>
            <p className="text-[11px] text-zinc-500 pt-2 border-t border-zinc-800/80">
              We will acknowledge your grievance or privacy query within 24 hours and resolve it within 15 to 30 days of receipt.
            </p>
          </section>
        </div>
      </main>

      <LandingFooter />
    </div>
  );
}
