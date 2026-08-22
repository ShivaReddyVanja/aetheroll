"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Sidebar, Channel, UserProfile } from "@/components/Sidebar";
import { BottomNav } from "@/components/BottomNav";
import { MasonryGrid } from "@/components/MasonryGrid";
import { MediaItem } from "@/components/MediaCard";
import { MediaViewer } from "@/components/MediaViewer";
import { QRCodeModal } from "@/components/QRCodeModal";
import { UploaderModal } from "@/components/UploaderModal";
import { SettingsModal } from "@/components/SettingsModal";
import { TimelineScrubber } from "@/components/TimelineScrubber";
import { ChannelPickerModal } from "@/components/ChannelPickerModal";
import { BulkActionBar } from "@/components/BulkActionBar";
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
  Trash2,
  Tag,
  Compass,
  Calendar,
  User,
  MapPin,
  Menu,
} from "lucide-react";

export default function GalleryPage() {
  // Theme state
  const [isDarkMode, setIsDarkMode] = useState(true);

  // Mobile sidebar drawer state
  const [sidebarOpen, setSidebarOpen] = useState(false);

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
    "all" | "photos" | "videos" | "favorites" | "people" | "places" | "events" | "trips" | "tags"
  >("all");

  // Sub-filter selection (e.g. specific person/trip/event/tag chosen inside collections)
  const [selectedSubFilter, setSelectedSubFilter] = useState<{
    type: "person" | "trip" | "event" | "tag" | null;
    id: string | null;
    name: string | null;
  }>({ type: null, id: null, name: null });

  // Collections list items for the chips bar
  const [collectionItems, setCollectionItems] = useState<Array<{ id: string; name: string; color?: string; media_count?: number }>>([]);

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

  // 3. Load sub-collection list when filter changes
  useEffect(() => {
    if (!selectedChannelId) return;
    setSelectedSubFilter({ type: null, id: null, name: null });

    if (activeFilter === "people") {
      apiFetch(`/api/tags/people?channel_id=${selectedChannelId}`)
        .then((r) => r.json())
        .then((d) => setCollectionItems(d.people || []))
        .catch(() => {});
    } else if (activeFilter === "trips") {
      apiFetch(`/api/trips?channel_id=${selectedChannelId}`)
        .then((r) => r.json())
        .then((d) => setCollectionItems(d.trips || []))
        .catch(() => {});
    } else if (activeFilter === "events") {
      apiFetch(`/api/tags/events?channel_id=${selectedChannelId}`)
        .then((r) => r.json())
        .then((d) => setCollectionItems(d.events || []))
        .catch(() => {});
    } else if (activeFilter === "tags") {
      apiFetch(`/api/tags/user-tags?channel_id=${selectedChannelId}`)
        .then((r) => r.json())
        .then((d) => setCollectionItems(d.tags || []))
        .catch(() => {});
    } else {
      setCollectionItems([]);
    }
  }, [activeFilter, selectedChannelId]);

  // Helper to dynamically calculate 2 screens worth of batch size based on viewport
  const getDynamicBatchLimit = () => {
    if (typeof window === "undefined") return 48;
    const cols = Math.max(2, Math.floor(window.innerWidth / 240));
    const rows = Math.max(3, Math.ceil(window.innerHeight / 220));
    return Math.min(100, Math.max(24, cols * rows * 2));
  };

  const inFlightFetchRef = React.useRef(false);

  // 4. Fetch Media Items (with Dynamic Viewport Batching & Backend Filters)
  const fetchMedia = useCallback(
    async (cursor?: string) => {
      if (!selectedChannelId || inFlightFetchRef.current) return;
      inFlightFetchRef.current = true;
      setLoadingMedia(true);

      try {
        const batchLimit = getDynamicBatchLimit();
        let url = `/api/media?channel_id=${selectedChannelId}&limit=${batchLimit}`;
        if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;
        if (activeFilter === "photos") url += `&file_type=photo`;
        if (activeFilter === "videos") url += `&file_type=video`;
        if (activeFilter === "favorites") url += `&favorites_only=true`;
        if (activeFilter === "places") url += `&has_geo=true`;

        if (selectedSubFilter.type === "person" && selectedSubFilter.id) {
          url += `&person_id=${encodeURIComponent(selectedSubFilter.id)}`;
        }
        if (selectedSubFilter.type === "trip" && selectedSubFilter.id) {
          url += `&trip_id=${encodeURIComponent(selectedSubFilter.id)}`;
        }
        if (selectedSubFilter.type === "event" && selectedSubFilter.id) {
          url += `&event_id=${encodeURIComponent(selectedSubFilter.id)}`;
        }
        if (selectedSubFilter.type === "tag" && selectedSubFilter.id) {
          url += `&tag_id=${encodeURIComponent(selectedSubFilter.id)}`;
        }
        const res = await apiFetch(url);
        const data = await res.json();

        if (data.items) {
          const items: MediaItem[] = data.items;

          if (cursor) {
            setMediaItems((prev) => {
              const existingIds = new Set(prev.map((i) => i.id));
              const newItems = items.filter((i) => !existingIds.has(i.id));
              return [...prev, ...newItems];
            });
          } else {
            setMediaItems(items);
          }
          setNextCursor(data.nextCursor || null);
        }
      } catch (e) {
        console.error("Failed to load media:", e);
      } finally {
        inFlightFetchRef.current = false;
        setLoadingMedia(false);
      }
    },
    [selectedChannelId, activeFilter, selectedSubFilter]
  );

  useEffect(() => {
    if (selectedChannelId) {
      fetchMedia();
    }
  }, [selectedChannelId, activeFilter, selectedSubFilter, fetchMedia]);

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
        i.tags?.some((t) => t.name.toLowerCase().includes(q)) ||
        i.trips?.some((tr) => tr.name.toLowerCase().includes(q)) ||
        i.events?.some((e) => e.name.toLowerCase().includes(q)) ||
        i.locations?.some((l) => l.name.toLowerCase().includes(q)) ||
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
        onSelectFilter={(filter) => {
          setActiveFilter(filter);
          setSelectedSubFilter({ type: null, id: null, name: null });
        }}
        onOpenUploader={() => setShowUploader(true)}
        onSyncChannel={handleSyncChannel}
        onOpenTurboSettings={() => setShowSettings(true)}
        isSyncing={isSyncing}
        onLogout={handleLogout}
        isDarkMode={isDarkMode}
        onToggleTheme={toggleTheme}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      {/* Main Gallery Workspace */}
      <main className="flex-1 flex flex-col h-full overflow-hidden bg-[var(--bg-primary)] relative min-w-0">
        {/* ── Header: responsive for mobile + desktop ── */}
        <header className="h-14 md:h-16 px-3 md:px-6 flex items-center justify-between z-20 flex-shrink-0 gap-2">

          {selectedIds.size > 0 ? (
            /* ── Selection mode bar (same on all screen sizes) ── */
            <div className="w-full h-11 rounded-full bg-[var(--bg-secondary)] border border-[var(--border-color)] px-4 flex items-center justify-between shadow-md animate-fadeIn">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setSelectedIds(new Set())}
                  className="p-1 rounded-full text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                  title="Clear selection"
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
                    selectedIds.forEach((id) =>
                      handleToggleFavorite(id, { stopPropagation: () => {} } as any)
                    );
                  }}
                  className="p-2 rounded-full text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-amber-400 transition-colors"
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
              </div>
            </div>
          ) : (
            <>
              {/* ── Mobile: Hamburger ── */}
              <button
                onClick={() => setSidebarOpen(true)}
                className="md:hidden p-2.5 rounded-full text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] flex-shrink-0"
                aria-label="Open menu"
              >
                <Menu className="w-5 h-5" />
              </button>

              {/* ── Search Bar ── */}
              <div className="relative flex-1 min-w-0">
                <Search className="w-4 h-4 md:w-5 md:h-5 text-[var(--text-secondary)] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={`Search in "${currentChannel?.name || "Library"}"...`}
                  className="w-full bg-[var(--bg-secondary)] hover:bg-[var(--bg-hover)] focus:bg-[var(--bg-surface)] border border-transparent focus:border-[var(--border-color)] rounded-full pl-10 pr-9 py-2 md:pl-12 md:pr-10 md:py-2.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none shadow-sm transition-colors"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* ── Right Action Icons ── */}
              <div className="flex items-center gap-1 md:gap-2 flex-shrink-0">
                {/* Sync — hidden on mobile to save space */}
                <button
                  onClick={() => selectedChannelId && handleSyncChannel(selectedChannelId)}
                  disabled={!selectedChannelId || isSyncing}
                  title={isSyncing ? "Syncing with Telegram..." : `Sync "${currentChannel?.name || "Library"}" from Telegram`}
                  className="hidden md:flex p-2.5 rounded-full text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-blue-500 transition-colors disabled:opacity-40"
                >
                  <RefreshCw className={`w-5 h-5 ${isSyncing ? "animate-spin text-blue-500" : ""}`} />
                </button>

                {/* Sync icon on mobile (icon only, no label) */}
                <button
                  onClick={() => selectedChannelId && handleSyncChannel(selectedChannelId)}
                  disabled={!selectedChannelId || isSyncing}
                  title="Sync from Telegram"
                  className="md:hidden p-2.5 rounded-full text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-blue-500 transition-colors disabled:opacity-40"
                >
                  <RefreshCw className={`w-4 h-4 ${isSyncing ? "animate-spin text-blue-500" : ""}`} />
                </button>

                {/* Upload */}
                <button
                  onClick={() => setShowUploader(true)}
                  disabled={!selectedChannelId}
                  title="Upload photos & videos"
                  className="p-2 md:p-2.5 rounded-full text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-40"
                >
                  <Plus className="w-5 h-5" />
                </button>

                {/* Theme toggle — desktop only */}
                <button
                  onClick={toggleTheme}
                  title={isDarkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
                  className="hidden md:flex p-2.5 rounded-full text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
                >
                  {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
                </button>

                {/* Settings — desktop only */}
                <button
                  onClick={() => setShowSettings(true)}
                  title="Settings & Turbo Cache"
                  className="hidden md:flex p-2.5 rounded-full text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
                >
                  <Settings className="w-5 h-5" />
                </button>

                {/* Profile avatar */}
                <div className="w-7 h-7 md:w-8 md:h-8 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-xs shadow-sm select-none cursor-pointer">
                  {user?.displayName ? user.displayName.charAt(0).toUpperCase() : "S"}
                </div>
              </div>
            </>
          )}
        </header>


        {/* Collections Sub-filter Filter Pills Header */}
        {(activeFilter === "people" ||
          activeFilter === "trips" ||
          activeFilter === "events" ||
          activeFilter === "tags" ||
          activeFilter === "places") && (
          <div className="px-6 py-2 border-b border-[var(--border-color)] bg-[var(--bg-surface)] flex items-center gap-2 overflow-x-auto select-none">
            <span className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mr-2 flex items-center gap-1.5">
              {activeFilter === "people" && <User className="w-3.5 h-3.5 text-blue-400" />}
              {activeFilter === "trips" && <Compass className="w-3.5 h-3.5 text-amber-500" />}
              {activeFilter === "events" && <Calendar className="w-3.5 h-3.5 text-purple-400" />}
              {activeFilter === "tags" && <Tag className="w-3.5 h-3.5 text-emerald-400" />}
              {activeFilter === "places" && <MapPin className="w-3.5 h-3.5 text-rose-400" />}
              <span>{activeFilter}</span>
            </span>

            {/* All Chip */}
            <button
              onClick={() => setSelectedSubFilter({ type: null, id: null, name: null })}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                selectedSubFilter.id === null
                  ? "bg-blue-600 text-white border-blue-600 font-semibold"
                  : "bg-[var(--bg-secondary)] border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              All {activeFilter}
            </button>

            {/* Individual Sub-filter Chips */}
            {collectionItems.map((item) => {
              const isSelected = selectedSubFilter.id === item.id;
              const subType =
                activeFilter === "people"
                  ? "person"
                  : activeFilter === "trips"
                  ? "trip"
                  : activeFilter === "events"
                  ? "event"
                  : "tag";

              return (
                <button
                  key={item.id}
                  onClick={() =>
                    setSelectedSubFilter(
                      isSelected
                        ? { type: null, id: null, name: null }
                        : { type: subType, id: item.id, name: item.name }
                    )
                  }
                  className={`px-3 py-1 rounded-full text-xs font-medium border flex items-center gap-1.5 transition-all ${
                    isSelected
                      ? "bg-blue-600 text-white border-blue-600 font-semibold shadow-sm"
                      : "bg-[var(--bg-secondary)] border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  {item.color && (
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: item.color }} />
                  )}
                  <span>{item.name}</span>
                  {item.media_count != null && (
                    <span className="text-[10px] opacity-70">({item.media_count})</span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Gallery Content Area */}
        <div className="flex-1 overflow-y-auto relative pb-16 md:pb-0">
          {channels.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-4">
              <div className="w-16 h-16 rounded-full bg-blue-500/10 text-blue-500 flex items-center justify-center mb-4 shadow-sm">
                <Plus className="w-8 h-8" />
              </div>
              <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-1">
                No libraries added yet
              </h2>
              <p className="text-xs text-[var(--text-secondary)] max-w-sm mb-6">
                Connect your Telegram Saved Messages or any Telegram channel or group to start browsing your photos and videos.
              </p>
              <button
                onClick={() => setShowChannelPicker(true)}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-full shadow-md transition-all flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                Add Library
              </button>
            </div>
          ) : loadingMedia && mediaItems.length === 0 ? (
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

        {/* Floating Bulk Action Bar */}
        <BulkActionBar
          selectedIds={selectedIds}
          channelId={selectedChannelId || ""}
          onClearSelection={() => setSelectedIds(new Set())}
          onActionComplete={() => {
            setSelectedIds(new Set());
            fetchMedia();
          }}
          onDeleteSelected={(ids) => handleDeleteMedia(ids)}
          onFavoriteSelected={(ids) => {
            ids.forEach((id) => handleToggleFavorite(id, { stopPropagation: () => {} } as any));
          }}
        />
      </main>

      {/* ── Mobile Bottom Navigation Bar ── */}
      <BottomNav
        activeFilter={activeFilter}
        onSelectFilter={(filter) => {
          setActiveFilter(filter);
          setSelectedSubFilter({ type: null, id: null, name: null });
        }}
        onOpenSidebar={() => setSidebarOpen(true)}
      />

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
