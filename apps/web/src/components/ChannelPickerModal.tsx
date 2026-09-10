"use client";

import React, { useState, useEffect } from "react";
import { X, Search, Plus, RefreshCw, Check, Users, Radio } from "lucide-react";
import { Channel } from "./Sidebar";
import { apiFetch } from "@/lib/config";

interface ChannelPickerModalProps {
  onClose: () => void;
  onSelectAndAddChannel: (channel: Channel) => void;
  onRemoveChannel?: (channelId: string) => void;
  activeChannelIds: Set<string>;
}

const AVATAR_COLORS = [
  "from-blue-500 to-indigo-600",
  "from-emerald-500 to-teal-600",
  "from-amber-500 to-orange-600",
  "from-purple-500 to-pink-600",
  "from-rose-500 to-red-600",
  "from-cyan-500 to-blue-600",
];

export function ChannelPickerModal({
  onClose,
  onSelectAndAddChannel,
  onRemoveChannel,
  activeChannelIds,
}: ChannelPickerModalProps) {
  const [allChannels, setAllChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [localActiveIds, setLocalActiveIds] = useState<Set<string>>(new Set(activeChannelIds));

  useEffect(() => {
    setLocalActiveIds(new Set(activeChannelIds));
  }, [activeChannelIds]);

  useEffect(() => {
    async function loadAllChannels() {
      try {
        const res = await apiFetch("/api/channels?all=true");
        if (res.status === 401) {
          onClose();
          return;
        }
        const data = await res.json();
        if (data.channels) {
          setAllChannels(data.channels);
          const activeFromApi = new Set<string>();
          for (const ch of data.channels) {
            if ((ch as any).is_added === 1 || activeChannelIds.has(ch.id)) {
              activeFromApi.add(ch.id);
            }
          }
          setLocalActiveIds(activeFromApi);
        }
      } catch (err) {
        console.error("Failed to load Telegram channels:", err);
      } finally {
        setLoading(false);
      }
    }
    loadAllChannels();
  }, [activeChannelIds]);

  const handleToggleChannel = async (ch: Channel, isActive: boolean) => {
    setLoadingId(ch.id);
    try {
      if (isActive && onRemoveChannel) {
        await onRemoveChannel(ch.id);
        setLocalActiveIds((prev) => {
          const next = new Set(prev);
          next.delete(ch.id);
          return next;
        });
      } else {
        await onSelectAndAddChannel(ch);
        setLocalActiveIds((prev) => {
          const next = new Set(prev);
          next.add(ch.id);
          return next;
        });
      }
    } catch (err) {
      console.error("Failed toggling channel:", err);
    } finally {
      setLoadingId(null);
    }
  };

  const filteredChannels = allChannels
    .filter((c) => c.name.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a, b) => {
      const aActive = localActiveIds.has(a.id);
      const bActive = localActiveIds.has(b.id);
      if (aActive !== bActive) {
        return aActive ? -1 : 1; // Added channels appear on top!
      }
      const aIsSaved = a.telegram_channel_id === "me" || a.telegram_channel_id.startsWith("me_");
      const bIsSaved = b.telegram_channel_id === "me" || b.telegram_channel_id.startsWith("me_");
      if (aIsSaved !== bIsSaved) {
        return aIsSaved ? -1 : 1; // Saved Messages prioritized within group
      }
      return a.name.localeCompare(b.name);
    });

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-5 flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-color)] pb-3 flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold text-[var(--text-primary)]">
              Add Library from Telegram
            </h2>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5">
              Select any Telegram Channel, Group, or Saved Messages to use as a photo gallery.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search Bar */}
        <div className="relative flex-shrink-0">
          <Search className="w-4 h-4 text-[var(--text-secondary)] absolute left-3.5 top-3" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search your channels & groups..."
            className="w-full bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl pl-10 pr-4 py-2.5 text-xs text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none focus:border-blue-500"
          />
        </div>

        {/* Channels List */}
        <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-48 text-[var(--text-tertiary)]">
              <RefreshCw className="w-6 h-6 animate-spin text-blue-500 mb-2" />
              <p className="text-xs">Fetching your Telegram channels...</p>
            </div>
          ) : filteredChannels.length === 0 ? (
            <div className="text-center py-12 text-xs text-[var(--text-tertiary)]">
              No channels found matching &quot;{searchQuery}&quot;
            </div>
          ) : (
            filteredChannels.map((ch, idx) => {
              const isActive = localActiveIds.has(ch.id);
              const isSavedMessages = ch.telegram_channel_id === "me" || ch.telegram_channel_id.startsWith("me_");
              const isProcessing = loadingId === ch.id;
              const colorGradient = AVATAR_COLORS[idx % AVATAR_COLORS.length];

              return (
                <div
                  key={ch.id}
                  className={`flex items-center justify-between p-3 rounded-2xl transition-all border ${
                    isActive
                      ? "bg-[var(--bg-active-pill)]/20 border-blue-500/30"
                      : "bg-[var(--bg-secondary)] border-transparent hover:border-[var(--border-color)] hover:bg-[var(--bg-hover)]"
                  }`}
                >
                  <div className="flex items-center gap-3 overflow-hidden flex-1 mr-2">
                    <div
                      className={`w-9 h-9 rounded-full bg-gradient-to-tr ${colorGradient} text-white flex items-center justify-center text-xs font-bold flex-shrink-0 shadow-sm`}
                    >
                      {ch.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="overflow-hidden">
                      <div className="text-xs font-medium text-[var(--text-primary)] truncate">
                        {ch.name}
                      </div>
                      <div className="text-[10px] text-[var(--text-tertiary)] flex items-center gap-2">
                        {ch.media_count !== undefined && (
                          <span>{ch.media_count} indexed items</span>
                        )}
                        {isSavedMessages && (
                          <span className="text-blue-500 font-semibold">Private Cloud Vault</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!isProcessing) {
                        handleToggleChannel(ch, isActive);
                      }
                    }}
                    disabled={isProcessing}
                    className={`min-w-[72px] h-8 px-3 rounded-full text-xs font-medium transition-all flex items-center justify-center ${
                      isProcessing
                        ? "bg-[var(--bg-hover)] text-[var(--text-secondary)] cursor-not-allowed"
                        : isActive
                        ? "bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white"
                        : "bg-blue-600 text-white hover:bg-blue-700"
                    }`}
                  >
                    {isProcessing ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-current" />
                    ) : isActive ? (
                      "Remove"
                    ) : (
                      "+ Add"
                    )}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
