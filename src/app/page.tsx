"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Sidebar, Channel, UserProfile } from "@/components/Sidebar";
import { MasonryGrid } from "@/components/MasonryGrid";
import { MediaItem } from "@/components/MediaCard";
import { MediaViewer } from "@/components/MediaViewer";
import { QRCodeModal } from "@/components/QRCodeModal";
import { UploaderModal } from "@/components/UploaderModal";
import { SettingsModal } from "@/components/SettingsModal";
import { TimelineScrubber } from "@/components/TimelineScrubber";
import { ChannelPickerModal } from "@/components/ChannelPickerModal";
import { DevLogHUD } from "@/components/DevLogHUD";
import { getApiBaseUrl, apiFetch } from "@/lib/config";
import {
  Search,
  Plus,
  Moon,
  Sun,
  Settings,
  RefreshCw,
  X,
  Star,
  Download,
  Trash2,
  Share2,
} from "lucide-react";

export default function GalleryPage() {
  // Theme state
  const [isDarkMode, setIsDarkMode] = useState(true);

  // Auth state
  const [user, setUser] = useState<UserProfile | null>(null);
  const [authChecking, setAuthChecking] = useState(true);

  // Channels & Media state
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [loadingMedia, setLoadingMedia] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Selection state (Google Photos multi-select)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Navigation Filter
  const [activeFilter, setActiveFilter] = useState<
    "all" | "photos" | "videos" | "favorites" | "people" | "places" | "events"
  >("all");

  // Modals / Lightbox state
  const [activeViewerItem, setActiveViewerItem] = useState<MediaItem | null>(null);
  const [showUploader, setShowUploader] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showChannelPicker, setShowChannelPicker] = useState(false);

  // Apply dark mode class to html document
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [isDarkMode]);

  // Toggle Theme
  const toggleTheme = () => setIsDarkMode((prev) => !prev);

  // 1. Check Authentication on Mount
  const checkAuth = useCallback(async () => {
    try {
      const res = await apiFetch("/api/auth/me");
      const data = await res.json();
      if (data.authenticated && data.user) {
        setUser(data.user);
      } else {
        setUser(null);
      }
    } catch (e) {
      setUser(null);
    } finally {
      setAuthChecking(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  // 2. Fetch User Channels
  const fetchChannels = useCallback(async () => {
    if (!user) return;
    try {
      const res = await apiFetch("/api/channels");
      const data = await res.json();
      if (data.channels) {
        setChannels(data.channels);
        if (!selectedChannelId && data.channels.length > 0) {
          setSelectedChannelId(data.channels[0].id);
        }
      }
    } catch (e) {
      console.error("Failed to load channels:", e);
    }
  }, [user, selectedChannelId]);

  useEffect(() => {
    if (user) {
      fetchChannels();
    }
  }, [user, fetchChannels]);

  // 3. Fetch Media Items
  const fetchMedia = useCallback(
    async (cursor?: string) => {
      if (!selectedChannelId) return;
      setLoadingMedia(true);

      try {
        let url = `/api/media?channel_id=${selectedChannelId}&limit=50`;
        if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;
        if (activeFilter === "favorites") url += `&favorites_only=true`;

        const res = await apiFetch(url);
        const data = await res.json();

        if (data.items) {
          let items: MediaItem[] = data.items;

          if (activeFilter === "photos") items = items.filter((i) => i.file_type === "photo");
          if (activeFilter === "videos") items = items.filter((i) => i.file_type === "video");

          if (cursor) {
            setMediaItems((prev) => [...prev, ...items]);
          } else {
            setMediaItems(items);
          }
          setNextCursor(data.nextCursor || null);
        }
      } catch (e) {
        console.error("Failed to load media:", e);
      } finally {
        setLoadingMedia(false);
      }
    },
    [selectedChannelId, activeFilter]
  );

  useEffect(() => {
    if (selectedChannelId) {
      fetchMedia();
    }
  }, [selectedChannelId, activeFilter, fetchMedia]);

  // Channel Sync
  const handleSyncChannel = async (channelId: string) => {
    setIsSyncing(true);
    try {
      const res = await apiFetch(`/api/channels/${channelId}/sync`, { method: "POST" });
      const data = await res.json();
      if (data.success) {
        await fetchMedia();
        await fetchChannels();
      }
    } catch (e) {
      console.error("Sync error:", e);
    } finally {
      setIsSyncing(false);
    }
  };

  // Toggle Favorite
  const handleToggleFavorite = async (mediaId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const res = await apiFetch(`/api/media/${mediaId}/favorite`, { method: "POST" });
      const data = await res.json();
      setMediaItems((prev) =>
        prev.map((item) =>
          item.id === mediaId ? { ...item, is_favorite: data.favorited ? 1 : 0 } : item
        )
      );
      if (activeViewerItem?.id === mediaId) {
        setActiveViewerItem((prev) =>
          prev ? { ...prev, is_favorite: data.favorited ? 1 : 0 } : null
        );
      }
    } catch (err) {
      console.error("Favorite toggle error:", err);
    }
  };

  // Selection handlers
  const handleToggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectDay = (itemIds: string[]) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allSelected = itemIds.every((id) => next.has(id));
      if (allSelected) {
        itemIds.forEach((id) => next.delete(id));
      } else {
        itemIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  // Filter items by search query
  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return mediaItems;
    const q = searchQuery.toLowerCase();
    return mediaItems.filter(
      (i) =>
        i.people?.some((p) => p.name.toLowerCase().includes(q)) ||
        i.locations?.some((l) => l.name.toLowerCase().includes(q)) ||
        i.events?.some((e) => e.name.toLowerCase().includes(q)) ||
        i.mime_type.toLowerCase().includes(q)
    );
  }, [mediaItems, searchQuery]);

  // Extract years for TimelineScrubber
  const availableYears = useMemo(() => {
    return mediaItems.map((i) => new Date(i.captured_at || Date.now()).getFullYear());
  }, [mediaItems]);

  const handleScrollToYear = (year: number) => {
    const el = document.getElementById(`year-${year}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  // Add channel from Telegram
  const handleSelectAndAddChannel = async (channel: Channel) => {
    try {
      const res = await apiFetch("/api/channels/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          telegram_channel_id: channel.telegram_channel_id,
          name: channel.name,
        }),
      });
      const data = await res.json();
      setShowChannelPicker(false);
      await fetchChannels();
      const targetId = data.channelId || channel.id;
      setSelectedChannelId(targetId);
      handleSyncChannel(targetId);
    } catch (err) {
      console.error("Failed adding channel:", err);
    }
  };

  // Remove channel from Telegram Gallery
  const handleRemoveChannel = async (channelId: string) => {
    try {
      await apiFetch("/api/channels/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel_id: channelId }),
      });
      await fetchChannels();
      if (selectedChannelId === channelId) {
        const remaining = channels.filter((c) => c.id !== channelId);
        setSelectedChannelId(remaining[0]?.id || null);
      }
    } catch (err) {
      console.error("Failed removing channel:", err);
    }
  };

  // Delete media item(s)
  const handleDeleteMedia = async (mediaIds: string[]) => {
    if (mediaIds.length === 0) return;
    const confirmText =
      mediaIds.length === 1
        ? "Delete this item from your gallery and Telegram?"
        : `Delete ${mediaIds.length} items from your gallery and Telegram?`;

    if (!window.confirm(confirmText)) return;

    try {
      const res = await apiFetch("/api/media/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ media_ids: mediaIds }),
      });
      if (res.ok) {
        const idSet = new Set(mediaIds);
        setMediaItems((prev) => prev.filter((item) => !idSet.has(item.id)));
        setSelectedIds(new Set());
        if (activeViewerItem && idSet.has(activeViewerItem.id)) {
          setActiveViewerItem(null);
        }
      }
    } catch (err) {
      console.error("Failed to delete media:", err);
    }
  };

  // Logout
  const handleLogout = async () => {
    await apiFetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    setChannels([]);
    setMediaItems([]);
  };

  if (authChecking) {
    return (
      <div className="h-screen w-screen bg-[var(--bg-primary)] flex items-center justify-center text-[var(--text-tertiary)]">
        <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  const currentChannel = channels.find((c) => c.id === selectedChannelId);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)]">
      {/* Auth Modal if unauthenticated */}
      {!user && (
        <QRCodeModal
          onLoginSuccess={(authUser) => {
            setUser(authUser);
            checkAuth();
          }}
        />
      )}

      {/* Google Photos Material 3 Sidebar */}
      <Sidebar
        user={user}
        channels={channels}
        selectedChannelId={selectedChannelId}
        onSelectChannel={(id) => setSelectedChannelId(id)}
        onOpenChannelPicker={() => setShowChannelPicker(true)}
        activeFilter={activeFilter}
        onSelectFilter={(filter) => setActiveFilter(filter)}
        onOpenUploader={() => setShowUploader(true)}
        onSyncChannel={handleSyncChannel}
        onOpenTurboSettings={() => setShowSettings(true)}
        isSyncing={isSyncing}
        onLogout={handleLogout}
        isDarkMode={isDarkMode}
        onToggleTheme={toggleTheme}
      />

      {/* Main Gallery Workspace */}
      <main className="flex-1 flex flex-col h-full overflow-hidden bg-[var(--bg-primary)] relative">
        {/* Google Photos Top Floating Search Bar */}
        <header className="h-16 px-6 flex items-center justify-between z-20 flex-shrink-0">
          {/* Multi-selection Action Bar Override */}
          {selectedIds.size > 0 ? (
            <div className="w-full h-12 rounded-full bg-[var(--bg-secondary)] border border-[var(--border-color)] px-5 flex items-center justify-between shadow-md animate-fadeIn">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setSelectedIds(new Set())}
                  className="p-1 rounded-full text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                >
                  <X className="w-5 h-5" />
                </button>
                <span className="text-sm font-semibold text-[var(--text-primary)]">
                  {selectedIds.size} selected
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    selectedIds.forEach((id) => handleToggleFavorite(id, { stopPropagation: () => {} } as any));
                  }}
                  className="p-2 rounded-full text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-amber-400"
                  title="Favorite selected"
                >
                  <Star className="w-5 h-5" />
                </button>
                <button
                  onClick={() => handleDeleteMedia(Array.from(selectedIds))}
                  className="p-2 rounded-full text-[var(--text-secondary)] hover:bg-rose-500/10 hover:text-rose-500 transition-colors"
                  title="Delete selected media"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
                <button
                  onClick={() => setSelectedIds(new Set())}
                  className="p-2 rounded-full text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                  title="Clear selection"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Google Photos Large Floating Search Bar */}
              <div className="relative flex-1 max-w-2xl">
                <Search className="w-5 h-5 text-[var(--text-secondary)] absolute left-4 top-3" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={`Search in "${currentChannel?.name || "Library"}"...`}
                  className="w-full bg-[var(--bg-secondary)] hover:bg-[var(--bg-hover)] focus:bg-[var(--bg-surface)] border border-transparent focus:border-[var(--border-color)] rounded-full pl-12 pr-10 py-2.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none shadow-sm transition-colors"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-3.5 top-3 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Right Action Icons (Google Photos Style) */}
              <div className="flex items-center gap-2 ml-4">
                {/* Sync Channel Button */}
                <button
                  onClick={() => selectedChannelId && handleSyncChannel(selectedChannelId)}
                  disabled={!selectedChannelId || isSyncing}
                  title={isSyncing ? "Syncing with Telegram..." : `Sync "${currentChannel?.name || "Library"}" from Telegram`}
                  className="p-2.5 rounded-full text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-blue-500 transition-colors disabled:opacity-40"
                >
                  <RefreshCw className={`w-5 h-5 ${isSyncing ? "animate-spin text-blue-500" : ""}`} />
                </button>

                {/* Upload Button */}
                <button
                  onClick={() => setShowUploader(true)}
                  disabled={!selectedChannelId}
                  title="Upload photos & videos"
                  className="p-2.5 rounded-full text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-40"
                >
                  <Plus className="w-5 h-5" />
                </button>

                {/* Theme Toggle (Sun/Moon) */}
                <button
                  onClick={toggleTheme}
                  title={isDarkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
                  className="p-2.5 rounded-full text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
                >
                  {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
                </button>

                {/* Settings Gear */}
                <button
                  onClick={() => setShowSettings(true)}
                  title="Settings & Turbo Cache"
                  className="p-2.5 rounded-full text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
                >
                  <Settings className="w-5 h-5" />
                </button>

                {/* Profile Circle Avatar */}
                <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-xs ml-1 shadow-sm select-none cursor-pointer">
                  {user?.displayName ? user.displayName.charAt(0).toUpperCase() : "S"}
                </div>
              </div>
            </>
          )}
        </header>

        {/* Gallery Content Area */}
        <div className="flex-1 overflow-y-auto relative">
          {loadingMedia && mediaItems.length === 0 ? (
            <div className="flex items-center justify-center h-80 text-[var(--text-tertiary)]">
              <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
            </div>
          ) : (
            <MasonryGrid
              items={filteredItems}
              selectedIds={selectedIds}
              onItemClick={(item) => setActiveViewerItem(item)}
              onToggleFavorite={handleToggleFavorite}
              onToggleSelect={handleToggleSelect}
              onSelectDay={handleSelectDay}
              loading={loadingMedia}
              hasMore={!!nextCursor}
              onLoadMore={() => nextCursor && fetchMedia(nextCursor)}
              onSync={() => selectedChannelId && handleSyncChannel(selectedChannelId)}
              isSyncing={isSyncing}
              onOpenUploader={() => setShowUploader(true)}
            />
          )}

          {/* Right Floating Timeline Scrubber */}
          <TimelineScrubber
            years={availableYears}
            onSelectYear={handleScrollToYear}
          />
        </div>
      </main>

      {/* Lightbox / Video Player */}
      {activeViewerItem && (
        <MediaViewer
          item={activeViewerItem}
          items={filteredItems}
          channelId={selectedChannelId || ""}
          onClose={() => setActiveViewerItem(null)}
          onNavigate={(nextItem) => setActiveViewerItem(nextItem)}
          onToggleFavorite={handleToggleFavorite}
          onItemUpdated={() => fetchMedia()}
          onDelete={(id) => handleDeleteMedia([id])}
        />
      )}

      {/* Uploader Modal */}
      {showUploader && selectedChannelId && (
        <UploaderModal
          channelId={selectedChannelId}
          channelName={currentChannel?.name || "Channel"}
          onClose={() => setShowUploader(false)}
          onUploadComplete={() => {
            setShowUploader(false);
            fetchMedia();
            fetchChannels();
          }}
        />
      )}

      {/* Settings Modal (Light/Dark + Turbo Mode) */}
      {showSettings && (
        <SettingsModal
          isDarkMode={isDarkMode}
          onToggleTheme={toggleTheme}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* Channel Picker Modal */}
      {showChannelPicker && (
        <ChannelPickerModal
          onClose={() => setShowChannelPicker(false)}
          onSelectAndAddChannel={handleSelectAndAddChannel}
          onRemoveChannel={handleRemoveChannel}
          activeChannelIds={new Set(channels.map((c) => c.id))}
        />
      )}

      {/* Real-time Dev Engine Telemetry HUD */}
      <DevLogHUD />
    </div>
  );
}
