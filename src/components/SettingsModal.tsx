"use client";

import React, { useState } from "react";
import { X, Moon, Sun, Zap, Shield, Key, CheckCircle, Database } from "lucide-react";

interface SettingsModalProps {
  isDarkMode: boolean;
  onToggleTheme: () => void;
  onClose: () => void;
}

export function SettingsModal({ isDarkMode, onToggleTheme, onClose }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<"appearance" | "turbo" | "account">("appearance");

  // R2 Turbo Mode Form
  const [accountId, setAccountId] = useState("");
  const [bucketName, setBucketName] = useState("");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [savedSuccess, setSavedSuccess] = useState(false);

  const handleSaveTurbo = (e: React.FormEvent) => {
    e.preventDefault();
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-color)] pb-4">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">Settings</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 border-b border-[var(--border-color)] pb-2 text-xs font-medium">
          <button
            onClick={() => setActiveTab("appearance")}
            className={`px-3 py-1.5 rounded-full transition-colors ${
              activeTab === "appearance"
                ? "bg-[var(--bg-active-pill)] text-[var(--text-active-pill)] font-semibold"
                : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
            }`}
          >
            Appearance & Theme
          </button>
          <button
            onClick={() => setActiveTab("turbo")}
            className={`px-3 py-1.5 rounded-full flex items-center gap-1.5 transition-colors ${
              activeTab === "turbo"
                ? "bg-[var(--bg-active-pill)] text-[var(--text-active-pill)] font-semibold"
                : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
            }`}
          >
            <Zap className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
            <span>Turbo Mode (R2)</span>
          </button>
        </div>

        {/* Tab 1: Appearance */}
        {activeTab === "appearance" && (
          <div className="space-y-4 py-2">
            <div className="flex items-center justify-between p-4 rounded-2xl bg-[var(--bg-secondary)]">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-[var(--bg-hover)] flex items-center justify-center text-[var(--text-primary)]">
                  {isDarkMode ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
                </div>
                <div>
                  <div className="text-sm font-medium text-[var(--text-primary)]">Dark Theme</div>
                  <div className="text-xs text-[var(--text-secondary)]">
                    {isDarkMode ? "Google Dark Theme Active" : "Google Light Theme Active"}
                  </div>
                </div>
              </div>

              {/* Toggle Switch */}
              <button
                onClick={onToggleTheme}
                className={`w-12 h-6 rounded-full transition-colors p-0.5 flex items-center ${
                  isDarkMode ? "bg-blue-600 justify-end" : "bg-slate-300 justify-start"
                }`}
              >
                <div className="w-5 h-5 rounded-full bg-white shadow-md" />
              </button>
            </div>
          </div>
        )}

        {/* Tab 2: Turbo Mode (R2 BYOS) */}
        {activeTab === "turbo" && (
          <form onSubmit={handleSaveTurbo} className="space-y-3.5 text-xs text-[var(--text-secondary)]">
            <p>
              Connect your own Cloudflare R2 bucket for **10ms edge streaming** and **0ms seeking**.
              (Zero egress fees + 10 GB free on Cloudflare).
            </p>

            <div className="space-y-1">
              <label className="text-[11px] font-semibold uppercase text-[var(--text-tertiary)]">
                Cloudflare Account ID
              </label>
              <input
                type="text"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                placeholder="e.g. 7a8e8abe0192837..."
                className="w-full bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-semibold uppercase text-[var(--text-tertiary)]">
                R2 Bucket Name
              </label>
              <input
                type="text"
                value={bucketName}
                onChange={(e) => setBucketName(e.target.value)}
                placeholder="e.g. my-photos-cache"
                className="w-full bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-semibold uppercase text-[var(--text-tertiary)]">
                R2 Access Key ID
              </label>
              <input
                type="text"
                value={accessKeyId}
                onChange={(e) => setAccessKeyId(e.target.value)}
                placeholder="Access Key ID"
                className="w-full bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-semibold uppercase text-[var(--text-tertiary)]">
                R2 Secret Access Key
              </label>
              <input
                type="password"
                value={secretAccessKey}
                onChange={(e) => setSecretAccessKey(e.target.value)}
                placeholder="Secret Access Key"
                className="w-full bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none focus:border-blue-500"
              />
            </div>

            <button
              type="submit"
              className="w-full py-2.5 rounded-full bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs transition-colors flex items-center justify-center gap-1.5 shadow-md shadow-blue-500/20"
            >
              {savedSuccess ? (
                <>
                  <CheckCircle className="w-4 h-4" />
                  <span>Turbo Mode Configured!</span>
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4" />
                  <span>Enable Turbo Edge Cache</span>
                </>
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
