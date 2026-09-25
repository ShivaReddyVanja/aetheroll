"use client";

import React, { useState, useEffect } from "react";
import {
  X,
  Share2,
  Copy,
  Check,
  Clock,
  ShieldCheck,
  Eye,
  Trash2,
  ExternalLink,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { apiFetch } from "@/lib/config";
import type { MediaShare } from "@aetheroll/types";
import { MediaItem } from "./MediaCard";

interface ShareModalProps {
  item: MediaItem;
  onClose: () => void;
}

const EXPIRY_OPTIONS = [
  { label: "24 Hours", seconds: 86400 },
  { label: "7 Days", seconds: 604800 },
  { label: "30 Days", seconds: 2592000 },
  { label: "Never", seconds: 0 },
];

export function ShareModal({ item, onClose }: ShareModalProps) {
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [activeShare, setActiveShare] = useState<MediaShare | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [selectedExpiry, setSelectedExpiry] = useState<number>(604800); // Default 7 days
  const [customTitle, setCustomTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Check if an active share link already exists for this media item
  useEffect(() => {
    let isMounted = true;
    async function loadExistingShare() {
      try {
        setLoading(true);
        const res = await apiFetch(`/api/shares/media/${encodeURIComponent(item.id)}`);
        if (!res.ok) throw new Error("Failed to load share state");
        const data = await res.json();
        if (isMounted && data.success && data.share) {
          setActiveShare(data.share);
          const origin = typeof window !== "undefined" ? window.location.origin : "";
          setShareUrl(data.share_url || `${origin}/v/${data.share.id}`);
        }
      } catch (err: any) {
        if (isMounted) setError(err.message);
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadExistingShare();
    return () => {
      isMounted = false;
    };
  }, [item.id]);

  const handleCreateShare = async () => {
    try {
      setCreating(true);
      setError(null);
      const res = await apiFetch("/api/shares/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          media_id: item.id,
          title: customTitle.trim() || undefined,
          expires_in_seconds: selectedExpiry > 0 ? selectedExpiry : undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to generate share link");
      }

      setActiveShare(data.share);
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      setShareUrl(data.share_url || `${origin}/v/${data.share.id}`);
    } catch (err: any) {
      setError(err.message || "Failed to create share link");
    } finally {
      setCreating(false);
    }
  };

  const handleRevokeShare = async () => {
    if (!activeShare) return;
    try {
      setRevoking(true);
      setError(null);
      const res = await apiFetch(`/api/shares/${encodeURIComponent(activeShare.id)}/revoke`, {
        method: "POST",
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to revoke share");
      }

      setActiveShare(null);
      setShareUrl(null);
    } catch (err: any) {
      setError(err.message || "Failed to revoke link");
    } finally {
      setRevoking(false);
    }
  };

  const handleCopy = () => {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
              <Share2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">Share Public Link</h2>
              <p className="text-xs text-zinc-400">
                {item.file_type === "video" ? "4K Video Stream" : "Original Photo"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5">
          {error && (
            <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{error}</span>
            </div>
          )}

          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-3 text-zinc-400">
              <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
              <p className="text-xs">Checking share status...</p>
            </div>
          ) : activeShare && shareUrl ? (
            /* Active Share State */
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-medium text-zinc-300">Public Link</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={shareUrl}
                    className="flex-1 px-3.5 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-zinc-200 font-mono select-all focus:outline-none focus:border-indigo-500"
                  />
                  <button
                    onClick={handleCopy}
                    className="px-3.5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-medium transition-colors flex items-center gap-1.5 shadow-md shadow-indigo-600/20"
                  >
                    {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    <span>{copied ? "Copied!" : "Copy"}</span>
                  </button>
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="p-3 bg-zinc-950/60 border border-zinc-800/80 rounded-xl space-y-1">
                  <div className="flex items-center gap-1.5 text-zinc-400 text-[11px]">
                    <Eye className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Views</span>
                  </div>
                  <p className="text-sm font-semibold text-white">{activeShare.view_count || 0}</p>
                </div>

                <div className="p-3 bg-zinc-950/60 border border-zinc-800/80 rounded-xl space-y-1">
                  <div className="flex items-center gap-1.5 text-zinc-400 text-[11px]">
                    <Clock className="w-3.5 h-3.5 text-amber-400" />
                    <span>Expires</span>
                  </div>
                  <p className="text-xs font-medium text-zinc-200 truncate">
                    {activeShare.expires_at
                      ? new Date(activeShare.expires_at).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })
                      : "Never"}
                  </p>
                </div>
              </div>

              {/* Actions */}
              <div className="pt-2 flex items-center justify-between border-t border-zinc-800/80">
                <a
                  href={shareUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 font-medium transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Preview Page</span>
                </a>

                <button
                  onClick={handleRevokeShare}
                  disabled={revoking}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 text-xs font-medium border border-rose-500/20 transition-colors disabled:opacity-50"
                >
                  {revoking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  <span>Revoke Link</span>
                </button>
              </div>
            </div>
          ) : (
            /* Create Share State */
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-300">Title (Optional)</label>
                <input
                  type="text"
                  placeholder="Enter a title or caption..."
                  value={customTitle}
                  onChange={(e) => setCustomTitle(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-indigo-500 transition-colors"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-300">Link Expiration</label>
                <div className="grid grid-cols-4 gap-2">
                  {EXPIRY_OPTIONS.map((opt) => (
                    <button
                      key={opt.seconds}
                      type="button"
                      onClick={() => setSelectedExpiry(opt.seconds)}
                      className={`px-2.5 py-2 rounded-xl text-xs font-medium border transition-all ${
                        selectedExpiry === opt.seconds
                          ? "bg-indigo-600/20 border-indigo-500 text-indigo-300"
                          : "bg-zinc-950/60 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={handleCreateShare}
                disabled={creating}
                className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs rounded-xl shadow-lg shadow-indigo-600/25 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Share2 className="w-4 h-4" />}
                <span>Generate Public Link</span>
              </button>
            </div>
          )}

          {/* Security Guarantee Note */}
          <div className="p-3 bg-zinc-950/40 border border-zinc-800/60 rounded-xl flex items-start gap-2.5 text-[11px] text-zinc-400 leading-relaxed">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <span>
              <strong>Zero-Knowledge Relay:</strong> Public viewers stream through Cloudflare Serverless Edge. Your personal Telegram account and private chats are never exposed.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
