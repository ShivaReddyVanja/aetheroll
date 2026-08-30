"use client";

import React, { useState, useEffect } from "react";
import {
  X,
  Moon,
  Sun,
  Zap,
  Shield,
  Key,
  CheckCircle,
  Database,
  BarChart3,
  Activity,
  Cpu,
  HardDrive,
  Calendar,
  AlertTriangle,
  RefreshCw,
  Users,
} from "lucide-react";
import { apiFetch } from "../lib/config.ts";

interface SettingsModalProps {
  isDarkMode: boolean;
  onToggleTheme: () => void;
  onClose: () => void;
}

export function SettingsModal({ isDarkMode, onToggleTheme, onClose }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<"appearance" | "turbo" | "billing" | "admin">("appearance");

  // R2 Turbo Mode Form State
  const [accountId, setAccountId] = useState("");
  const [bucketName, setBucketName] = useState("");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [savedSuccess, setSavedSuccess] = useState(false);

  // Billing Metrics State
  const [targetDate, setTargetDate] = useState<string>(() => new Date().toISOString().split("T")[0]);
  const [userMetrics, setUserMetrics] = useState<any>(null);
  const [systemMetrics, setSystemMetrics] = useState<any>(null);
  const [loadingUserMetrics, setLoadingUserMetrics] = useState<boolean>(false);
  const [loadingSystemMetrics, setLoadingSystemMetrics] = useState<boolean>(false);
  const [metricsError, setMetricsError] = useState<string | null>(null);

  // Fetch user billing metrics
  const fetchUserMetrics = async (date: string) => {
    setLoadingUserMetrics(true);
    setMetricsError(null);
    try {
      const res = await apiFetch(`/api/billing/me?date=${date}`);
      if (!res.ok) {
        if (res.status === 401) throw new Error("Please log in to view your billing metrics");
        throw new Error("Failed to load user metrics");
      }
      const data = await res.json();
      setUserMetrics(data);
    } catch (err: any) {
      setMetricsError(err.message || "Failed to load billing metrics");
    } finally {
      setLoadingUserMetrics(false);
    }
  };

  // Fetch system billing summary for Admin
  const fetchSystemMetrics = async (date: string) => {
    setLoadingSystemMetrics(true);
    setMetricsError(null);
    try {
      const res = await apiFetch(`/api/billing/summary?date=${date}`);
      if (!res.ok) {
        if (res.status === 401) throw new Error("Unauthorized: Admin session required");
        throw new Error("Failed to load system metrics");
      }
      const data = await res.json();
      setSystemMetrics(data);
    } catch (err: any) {
      setMetricsError(err.message || "Failed to load admin system metrics");
    } finally {
      setLoadingSystemMetrics(false);
    }
  };

  useEffect(() => {
    if (activeTab === "billing") {
      fetchUserMetrics(targetDate);
    } else if (activeTab === "admin") {
      fetchSystemMetrics(targetDate);
    }
  }, [activeTab, targetDate]);

  const handleSaveTurbo = (e: React.FormEvent) => {
    e.preventDefault();
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-3xl max-w-xl w-full p-6 shadow-2xl space-y-6 my-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-color)] pb-4">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">Settings & Usage</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1.5 border-b border-[var(--border-color)] pb-2 text-xs font-medium overflow-x-auto">
          <button
            onClick={() => setActiveTab("appearance")}
            className={`px-3 py-1.5 rounded-full whitespace-nowrap transition-colors ${
              activeTab === "appearance"
                ? "bg-[var(--bg-active-pill)] text-[var(--text-active-pill)] font-semibold"
                : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
            }`}
          >
            Appearance
          </button>
          <button
            onClick={() => setActiveTab("turbo")}
            className={`px-3 py-1.5 rounded-full flex items-center gap-1.5 whitespace-nowrap transition-colors ${
              activeTab === "turbo"
                ? "bg-[var(--bg-active-pill)] text-[var(--text-active-pill)] font-semibold"
                : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
            }`}
          >
            <Zap className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
            <span>Turbo Mode</span>
          </button>
          <button
            onClick={() => setActiveTab("billing")}
            className={`px-3 py-1.5 rounded-full flex items-center gap-1.5 whitespace-nowrap transition-colors ${
              activeTab === "billing"
                ? "bg-[var(--bg-active-pill)] text-[var(--text-active-pill)] font-semibold"
                : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5 text-blue-500" />
            <span>Usage & Billing</span>
          </button>
          <button
            onClick={() => setActiveTab("admin")}
            className={`px-3 py-1.5 rounded-full flex items-center gap-1.5 whitespace-nowrap transition-colors ${
              activeTab === "admin"
                ? "bg-[var(--bg-active-pill)] text-[var(--text-active-pill)] font-semibold"
                : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
            }`}
          >
            <Shield className="w-3.5 h-3.5 text-emerald-500" />
            <span>Admin Console</span>
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

        {/* Tab 3: User Usage & Billing */}
        {activeTab === "billing" && (
          <div className="space-y-4 text-xs text-[var(--text-secondary)]">
            {/* Date Selector Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-blue-500" />
                <span className="font-semibold text-[var(--text-primary)]">Target Date:</span>
                <input
                  type="date"
                  value={targetDate}
                  onChange={(e) => setTargetDate(e.target.value)}
                  className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg px-2 py-1 text-xs text-[var(--text-primary)] focus:outline-none focus:border-blue-500"
                />
              </div>

              <button
                onClick={() => fetchUserMetrics(targetDate)}
                className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                title="Refresh metrics"
              >
                <RefreshCw className={`w-4 h-4 ${loadingUserMetrics ? "animate-spin" : ""}`} />
              </button>
            </div>

            {metricsError && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 flex items-center gap-2 text-xs">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{metricsError}</span>
              </div>
            )}

            {loadingUserMetrics ? (
              <div className="py-8 text-center text-[var(--text-tertiary)] flex flex-col items-center gap-2">
                <RefreshCw className="w-6 h-6 animate-spin text-blue-500" />
                <span>Loading your Cloudflare billing metrics...</span>
              </div>
            ) : userMetrics ? (
              <div className="space-y-4">
                {/* Metric Summary Cards Grid */}
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="p-3 rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-color)] space-y-1">
                    <div className="flex items-center gap-1.5 text-[var(--text-tertiary)]">
                      <Cpu className="w-3.5 h-3.5 text-purple-500" />
                      <span className="text-[11px] font-medium">DO Invocations</span>
                    </div>
                    <div className="text-base font-bold text-[var(--text-primary)]">
                      {(userMetrics.totalMetrics?.doRequests || 0).toLocaleString()} <span className="text-[10px] font-normal text-[var(--text-tertiary)]">reqs</span>
                    </div>
                    <div className="text-[10px] text-[var(--text-tertiary)]">
                      {(userMetrics.totalMetrics?.doGbSeconds || 0).toFixed(4)} GB-Seconds
                    </div>
                  </div>

                  <div className="p-3 rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-color)] space-y-1">
                    <div className="flex items-center gap-1.5 text-[var(--text-tertiary)]">
                      <Database className="w-3.5 h-3.5 text-blue-500" />
                      <span className="text-[11px] font-medium">D1 Database Rows</span>
                    </div>
                    <div className="text-base font-bold text-[var(--text-primary)]">
                      {(userMetrics.totalMetrics?.d1ReadRows || 0).toLocaleString()} <span className="text-[10px] font-normal text-[var(--text-tertiary)]">read</span>
                    </div>
                    <div className="text-[10px] text-[var(--text-tertiary)]">
                      {(userMetrics.totalMetrics?.d1WriteRows || 0).toLocaleString()} write rows
                    </div>
                  </div>
                </div>

                {/* Purpose Breakdown */}
                {userMetrics.byPurpose && Object.keys(userMetrics.byPurpose).length > 0 ? (
                  <div className="space-y-2">
                    <div className="text-[11px] font-semibold uppercase text-[var(--text-tertiary)]">
                      Consumption Breakdown by Purpose
                    </div>
                    <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                      {Object.entries(userMetrics.byPurpose).map(([purpose, item]: [string, any]) => (
                        <div
                          key={purpose}
                          className="flex items-center justify-between p-2.5 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)] text-xs"
                        >
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/10 text-blue-500 border border-blue-500/20">
                              {purpose}
                            </span>
                          </div>
                          <div className="text-right text-[11px] text-[var(--text-secondary)]">
                            <span className="font-semibold text-[var(--text-primary)]">{item.doRequests || 0} reqs</span>
                            {" · "}
                            <span>{(item.doGbSeconds || 0).toFixed(4)} GB-s</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="p-4 text-center rounded-2xl bg-[var(--bg-secondary)] text-[var(--text-tertiary)]">
                    No recorded billable consumption for {targetDate}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        )}

        {/* Tab 4: Admin System Console */}
        {activeTab === "admin" && (
          <div className="space-y-4 text-xs text-[var(--text-secondary)]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-emerald-500" />
                <span className="font-semibold text-[var(--text-primary)]">Free Tier Health:</span>
                <input
                  type="date"
                  value={targetDate}
                  onChange={(e) => setTargetDate(e.target.value)}
                  className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg px-2 py-1 text-xs text-[var(--text-primary)] focus:outline-none focus:border-emerald-500"
                />
              </div>

              <button
                onClick={() => fetchSystemMetrics(targetDate)}
                className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                title="Refresh system metrics"
              >
                <RefreshCw className={`w-4 h-4 ${loadingSystemMetrics ? "animate-spin" : ""}`} />
              </button>
            </div>

            {metricsError && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 flex items-center gap-2 text-xs">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{metricsError}</span>
              </div>
            )}

            {loadingSystemMetrics ? (
              <div className="py-8 text-center text-[var(--text-tertiary)] flex flex-col items-center gap-2">
                <RefreshCw className="w-6 h-6 animate-spin text-emerald-500" />
                <span>Loading platform system metrics...</span>
              </div>
            ) : systemMetrics ? (
              <div className="space-y-4">
                {/* Active Users Badge */}
                <div className="flex items-center justify-between p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-500">
                  <div className="flex items-center gap-2 font-medium">
                    <Users className="w-4 h-4" />
                    <span>Active Users Today</span>
                  </div>
                  <span className="text-base font-bold">{systemMetrics.activeUsersCount || 0}</span>
                </div>

                {/* Free Tier Comparison Progress Bars */}
                {systemMetrics.comparisonVsFreeTier && (
                  <div className="space-y-3">
                    <div className="text-[11px] font-semibold uppercase text-[var(--text-tertiary)]">
                      System Total vs Cloudflare Free Tier Limits
                    </div>

                    <div className="space-y-2.5 max-h-56 overflow-y-auto pr-1">
                      {Object.entries(systemMetrics.comparisonVsFreeTier).map(([key, item]: [string, any]) => {
                        const pct = Math.min(100, item.percentageUsed || 0);
                        const isExceeded = item.isExceeded;
                        const isWarning = pct > 80;

                        return (
                          <div key={key} className="p-2.5 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)] space-y-1.5">
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="font-semibold text-[var(--text-primary)]">{key}</span>
                              <span className={`font-bold ${isExceeded ? "text-red-500" : isWarning ? "text-amber-500" : "text-emerald-500"}`}>
                                {item.used.toLocaleString()} / {item.limit.toLocaleString()} ({pct.toFixed(1)}%)
                              </span>
                            </div>
                            <div className="w-full h-2 rounded-full bg-[var(--bg-hover)] overflow-hidden">
                              <div
                                className={`h-full transition-all duration-500 rounded-full ${
                                  isExceeded ? "bg-red-500" : isWarning ? "bg-amber-500" : "bg-emerald-500"
                                }`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
