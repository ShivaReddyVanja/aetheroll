"use client";

import React, { useState } from "react";
import {
  Image as ImageIcon,
  Star,
  User,
  MapPin,
  PlayCircle,
  Folder,
  Tag,
  Compass,
  Calendar,
  Cloud,
  ChevronDown,
  ChevronRight,
  Plus,
  RefreshCw,
  Zap,
  LogOut,
} from "lucide-react";

export interface Channel {
  id: string;
  telegram_channel_id: string;
  name: string;
  media_count?: number;
  last_synced_at?: string;
}

export interface UserProfile {
  id: string;
  telegramUserId: number | string;
  displayName: string;
  avatarUrl?: string;
}

interface SidebarProps {
  user: UserProfile | null;
  channels: Channel[];
  selectedChannelId: string | null;
  onSelectChannel: (id: string) => void;
  onOpenChannelPicker: () => void;
  activeFilter: "all" | "photos" | "videos" | "favorites" | "people" | "places" | "events" | "trips" | "tags";
  onSelectFilter: (filter: any) => void;
  onOpenUploader: () => void;
  onSyncChannel: (id: string) => void;
  onOpenTurboSettings?: () => void;
  isSyncing: boolean;
  onLogout: () => void;
  isDarkMode: boolean;
  onToggleTheme: () => void;
}

const AVATAR_COLORS = [
  "from-blue-500 to-indigo-600",
  "from-emerald-500 to-teal-600",
  "from-amber-500 to-orange-600",
  "from-purple-500 to-pink-600",
  "from-rose-500 to-red-600",
  "from-cyan-500 to-blue-600",
];

export function Sidebar({
  user,
  channels,
  selectedChannelId,
  onSelectChannel,
  onOpenChannelPicker,
  activeFilter,
  onSelectFilter,
  onSyncChannel,
  onOpenTurboSettings,
  isSyncing,
  onLogout,
}: SidebarProps) {
  const [channelsExpanded, setChannelsExpanded] = useState(true);

  return (
    <aside className="w-64 h-screen bg-[var(--bg-surface)] border-r border-[var(--border-color)] flex flex-col flex-shrink-0 select-none z-30 transition-colors duration-200">
      {/* Brand Header */}
      <div className="h-16 px-5 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2.5">
          {/* Google Photos 4-color Pinwheel logo */}
          <div className="relative w-7 h-7 flex items-center justify-center">
            <svg viewBox="0 0 24 24" className="w-7 h-7" fill="none">
              <path
                d="M12 2C9.24 2 7 4.24 7 7C7 9.76 9.24 12 12 12C12 9.24 14.24 7 17 7C19.76 7 22 4.76 22 2H12Z"
                fill="#EA4335"
              />
              <path
                d="M22 12C22 9.24 19.76 7 17 7C14.24 7 12 9.24 12 12C12 14.76 14.24 17 17 17C17 19.76 19.24 22 22 22V12Z"
                fill="#FBBC05"
              />
              <path
                d="M12 22C14.76 22 17 19.76 17 17C17 14.24 14.24 12 12 12C12 14.76 9.76 17 7 17C4.24 17 2 19.24 2 22H12Z"
                fill="#34A853"
              />
              <path
                d="M2 12C2 14.76 4.24 17 7 17C9.76 17 12 14.76 12 12C12 9.24 9.76 7 7 7C7 4.24 4.24 2 2 2V12Z"
                fill="#4285F4"
              />
            </svg>
          </div>
          <span className="text-xl font-bold bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-600 bg-clip-text text-transparent tracking-tight">
            Aetheroll
          </span>
        </div>
      </div>

      {/* Backend Environment Indicator Badge */}
      <div className="px-5 pb-2 -mt-2">
        <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-medium bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-secondary)]">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              (process.env.NEXT_PUBLIC_BACKEND_MODE || "dev").toLowerCase() === "prod" ||
              (process.env.NEXT_PUBLIC_BACKEND_MODE || "dev").toLowerCase() === "remote"
                ? "bg-emerald-500 animate-pulse"
                : "bg-amber-500"
            }`}
          />
          <span>
            {(process.env.NEXT_PUBLIC_BACKEND_MODE || "dev").toLowerCase() === "prod" ||
            (process.env.NEXT_PUBLIC_BACKEND_MODE || "dev").toLowerCase() === "remote"
              ? "Remote (Cloudflare Worker)"
              : "Local (Node + SQLite)"}
          </span>
        </div>
      </div>

      {/* Navigation Scrollable Content */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-5">
        {/* Main Section */}
        <div className="space-y-1">
          <button
            onClick={() => onSelectFilter("all")}
            className={`w-full flex items-center gap-4 px-4 py-2.5 rounded-full text-sm font-medium transition-all ${
              activeFilter === "all"
                ? "bg-[var(--bg-active-pill)] text-[var(--text-active-pill)] font-semibold shadow-sm"
                : "text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
            }`}
          >
            <ImageIcon className="w-5 h-5" />
            <span>Photos</span>
          </button>
        </div>

        {/* Active Telegram Galleries */}
        <div>
          <div className="flex items-center justify-between px-4 mb-1.5">
            <button
              onClick={() => setChannelsExpanded(!channelsExpanded)}
              className="flex items-center gap-2 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider hover:text-[var(--text-primary)]"
            >
              {channelsExpanded ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
              <span>Galleries ({channels.length})</span>
            </button>
            {selectedChannelId && (
              <button
                onClick={() => onSyncChannel(selectedChannelId)}
                title="Sync Selected Channel from Telegram"
                disabled={isSyncing}
                className="text-[var(--text-tertiary)] hover:text-blue-500 transition-colors p-1 disabled:animate-spin"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {channelsExpanded && (
            <div className="space-y-1 pl-1">
              {channels.map((ch, idx) => {
                const isSelected = ch.id === selectedChannelId;
                const colorGradient = AVATAR_COLORS[idx % AVATAR_COLORS.length];
                return (
                  <button
                    key={ch.id}
                    onClick={() => onSelectChannel(ch.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-full text-sm transition-all ${
                      isSelected
                        ? "bg-[var(--bg-hover)] text-[var(--text-primary)] font-medium"
                        : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    {/* Circle Avatar */}
                    <div
                      className={`w-6 h-6 rounded-full bg-gradient-to-tr ${colorGradient} text-white flex items-center justify-center text-xs font-bold flex-shrink-0 shadow-sm`}
                    >
                      {ch.name.charAt(0).toUpperCase()}
                    </div>
                    <span className="truncate text-left flex-1 text-xs">{ch.name}</span>
                    {isSelected && (
                      <div className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />
                    )}
                  </button>
                );
              })}

              {/* Add New Library / Channel Button */}
              <button
                onClick={onOpenChannelPicker}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-full text-xs font-medium text-blue-500 hover:bg-[var(--bg-hover)] transition-colors mt-1"
              >
                <div className="w-6 h-6 rounded-full border border-dashed border-blue-400 text-blue-500 flex items-center justify-center flex-shrink-0">
                  <Plus className="w-3.5 h-3.5" />
                </div>
                <span>+ Add Library</span>
              </button>
            </div>
          )}
        </div>

        {/* Collections */}
        <div>
          <div className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider px-4 mb-1.5">
            Collections
          </div>
          <div className="space-y-0.5">
            {[
              { id: "favorites", label: "Favorites", icon: Star },
              { id: "people", label: "People & pets", icon: User },
              { id: "places", label: "Places", icon: MapPin },
              { id: "trips", label: "Trips", icon: Compass },
              { id: "events", label: "Events", icon: Calendar },
              { id: "tags", label: "Tags", icon: Tag },
              { id: "videos", label: "Videos", icon: PlayCircle },
            ].map((item) => {
              const Icon = item.icon;
              const isActive = activeFilter === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onSelectFilter(item.id)}
                  className={`w-full flex items-center gap-4 px-4 py-2.5 rounded-full text-sm transition-colors ${
                    isActive
                      ? "bg-[var(--bg-active-pill)] text-[var(--text-active-pill)] font-semibold"
                      : "text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Storage Bar (Google Photos Widget) */}
        <div className="pt-2 border-t border-[var(--border-color)] px-2">
          <div className="p-3 rounded-2xl bg-[var(--bg-secondary)] space-y-2">
            <div className="flex items-center gap-2 text-xs font-medium text-[var(--text-primary)]">
              <Cloud className="w-4 h-4 text-blue-500" />
              <span>Telegram Cloud Vault</span>
            </div>

            <div className="w-full h-1.5 bg-[var(--border-color)] rounded-full overflow-hidden">
              <div className="w-1/4 h-full bg-blue-500 rounded-full" />
            </div>

            <div className="text-[11px] text-[var(--text-secondary)]">
              Unlimited Cloud Storage
            </div>

            {onOpenTurboSettings && (
              <button
                onClick={onOpenTurboSettings}
                className="w-full py-1.5 px-3 rounded-full border border-[var(--border-color)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] text-xs font-medium flex items-center justify-center gap-1.5 transition-colors"
              >
                <Zap className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
                <span>Turbo Cache (R2)</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* User Footer Profile */}
      <div className="p-3 border-t border-[var(--border-color)] flex items-center justify-between flex-shrink-0 bg-[var(--bg-surface)]">
        <div className="flex items-center gap-2.5 overflow-hidden">
          <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-xs flex-shrink-0">
            {user?.displayName ? user.displayName.charAt(0).toUpperCase() : "U"}
          </div>
          <div className="overflow-hidden">
            <div className="text-xs font-medium text-[var(--text-primary)] truncate">
              {user?.displayName || "Connected User"}
            </div>
            <div className="text-[10px] text-emerald-500 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              Telegram Connected
            </div>
          </div>
        </div>
        <button
          onClick={onLogout}
          title="Log out"
          className="p-1.5 text-[var(--text-secondary)] hover:text-rose-500 hover:bg-[var(--bg-hover)] rounded-full transition-colors"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </aside>
  );
}
