"use client";

import React, { useState, useEffect } from "react";
import { X, Search, Plus, RefreshCw, Check, Users, Radio } from "lucide-react";
import { Channel } from "./Sidebar";

interface ChannelPickerModalProps {
  onClose: () => void;
  onSelectAndAddChannel: (channel: Channel) => void;
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
  activeChannelIds,
}: ChannelPickerModalProps) {
  const [allChannels, setAllChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    async function loadAllChannels() {
      try {
        const res = await fetch("/api/channels?all=true");
        const data = await res.json();
        if (data.channels) {
          setAllChannels(data.channels);
        }
      } catch (err) {
        console.error("Failed to load Telegram channels:", err);
      } finally {
        setLoading(false);
      }
    }
    loadAllChannels();
  }, []);

  const filteredChannels = allChannels.filter((c) =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

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
              Select any Telegram Channel or Group to use as a photo gallery.
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
              const isActive = activeChannelIds.has(ch.id);
              const colorGradient = AVATAR_COLORS[idx % AVATAR_COLORS.length];

              return (
                <div
                  key={ch.id}
                  onClick={() => onSelectAndAddChannel(ch)}
                  className={`flex items-center justify-between p-3 rounded-2xl cursor-pointer transition-all border ${
                    isActive
                      ? "bg-[var(--bg-active-pill)]/20 border-blue-500/30"
                      : "bg-[var(--bg-secondary)] border-transparent hover:border-[var(--border-color)] hover:bg-[var(--bg-hover)]"
                  }`}
                >
                  <div className="flex items-center gap-3 overflow-hidden">
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
                        {ch.telegram_channel_id === "me" && (
                          <span className="text-blue-500 font-semibold">Private Cloud Vault</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <button
                    className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                      isActive
                        ? "bg-blue-600 text-white"
                        : "bg-[var(--bg-hover)] text-[var(--text-primary)] hover:bg-blue-600 hover:text-white"
                    }`}
                  >
                    {isActive ? "Active" : "+ Add"}
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
