"use client";

import React, { useMemo } from "react";
import { MediaCard, MediaItem } from "./MediaCard";
import { Check, Image as ImageIcon, RefreshCw, Upload } from "lucide-react";

interface MasonryGridProps {
  items: MediaItem[];
  selectedIds?: Set<string>;
  onItemClick: (item: MediaItem) => void;
  onToggleFavorite: (id: string, e: React.MouseEvent) => void;
  onToggleSelect?: (id: string, e: React.MouseEvent) => void;
  onSelectDay?: (itemIds: string[]) => void;
  loading: boolean;
  onLoadMore?: () => void;
  hasMore?: boolean;
  onSync?: () => void;
  isSyncing?: boolean;
  onOpenUploader?: () => void;
}

export function MasonryGrid({
  items,
  selectedIds = new Set(),
  onItemClick,
  onToggleFavorite,
  onToggleSelect,
  onSelectDay,
  loading,
  onLoadMore,
  hasMore,
  onSync,
  isSyncing = false,
  onOpenUploader,
}: MasonryGridProps) {
  // Group items by date string (Google Photos format: "Mon, Oct 2, 2023")
  const dateGroups = useMemo(() => {
    const groups: { [key: string]: { dateLabel: string; year: number; items: MediaItem[] } } = {};

    for (const item of items) {
      const date = new Date(item.captured_at || Date.now());
      const now = new Date();

      const isToday =
        date.getDate() === now.getDate() &&
        date.getMonth() === now.getMonth() &&
        date.getFullYear() === now.getFullYear();

      const yesterday = new Date();
      yesterday.setDate(now.getDate() - 1);
      const isYesterday =
        date.getDate() === yesterday.getDate() &&
        date.getMonth() === yesterday.getMonth() &&
        date.getFullYear() === yesterday.getFullYear();

      let groupKey = "";
      if (isToday) {
        groupKey = "Today";
      } else if (isYesterday) {
        groupKey = "Yesterday";
      } else {
        groupKey = date.toLocaleDateString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
          year: "numeric",
        });
      }

      if (!groups[groupKey]) {
        groups[groupKey] = {
          dateLabel: groupKey,
          year: date.getFullYear(),
          items: [],
        };
      }
      groups[groupKey].items.push(item);
    }

    return Object.values(groups);
  }, [items]);

  if (items.length === 0 && !loading) {
    return (
      <div className="flex flex-col items-center justify-center h-96 text-[var(--text-tertiary)] space-y-4">
        <div className="w-16 h-16 rounded-full bg-[var(--bg-secondary)] flex items-center justify-center text-[var(--text-secondary)] shadow-sm">
          <ImageIcon className="w-8 h-8 stroke-[1.5]" />
        </div>
        <div className="text-center">
          <p className="text-base font-medium text-[var(--text-primary)]">No photos or videos yet</p>
          <p className="text-xs text-[var(--text-secondary)] mt-1">Upload media or sync from your Telegram channel.</p>
        </div>
        <div className="flex items-center gap-3 pt-2">
          {onSync && (
            <button
              onClick={onSync}
              disabled={isSyncing}
              className="flex items-center gap-2 px-4 py-2 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-sm transition-all disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? "animate-spin" : ""}`} />
              <span>{isSyncing ? "Syncing..." : "Sync from Telegram"}</span>
            </button>
          )}
          {onOpenUploader && (
            <button
              onClick={onOpenUploader}
              className="flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--bg-secondary)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] text-xs font-semibold border border-[var(--border-color)] transition-all"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Upload Media</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-7 max-w-[1700px] mx-auto pb-20">
      {dateGroups.map(({ dateLabel, year, items: groupItems }) => {
        const isAllDaySelected = groupItems.every((i) => selectedIds.has(i.id));

        return (
          <section key={dateLabel} id={`year-${year}`} className="space-y-2">
            {/* Google Photos Date Header with Checkmark Select */}
            <div className="group flex items-center gap-2.5 text-[var(--text-primary)] font-semibold text-sm py-2.5 mb-1 sticky top-0 bg-[var(--bg-primary)] z-10 select-none">
              <button
                onClick={() => onSelectDay?.(groupItems.map((i) => i.id))}
                className={`w-5 h-5 rounded-full flex items-center justify-center transition-all ${
                  isAllDaySelected
                    ? "bg-blue-600 text-white opacity-100"
                    : "border border-[var(--border-color)] opacity-0 group-hover:opacity-100 hover:border-blue-500 text-transparent"
                }`}
              >
                <Check className="w-3 h-3 stroke-[3]" />
              </button>
              <h3 className="tracking-tight">{dateLabel}</h3>
              <span className="text-xs font-normal text-[var(--text-tertiary)]">
                {groupItems.length} {groupItems.length === 1 ? "item" : "items"}
              </span>
            </div>

            {/* Google Photos Natural Aspect Ratio Horizontal Row Flow */}
            <div className="flex flex-wrap gap-1 sm:gap-1.5 items-start">
              {groupItems.map((item) => (
                <MediaCard
                  key={item.id}
                  item={item}
                  isSelected={selectedIds.has(item.id)}
                  onClick={onItemClick}
                  onToggleFavorite={onToggleFavorite}
                  onToggleSelect={onToggleSelect}
                />
              ))}
            </div>
          </section>
        );
      })}

      {/* Infinite Scroll / Load More */}
      {hasMore && (
        <div className="text-center py-8">
          <button
            onClick={onLoadMore}
            disabled={loading}
            className="px-6 py-2.5 rounded-full bg-[var(--bg-secondary)] hover:bg-[var(--bg-hover)] border border-[var(--border-color)] text-[var(--text-primary)] text-xs font-medium transition-all shadow-sm disabled:opacity-50"
          >
            {loading ? "Loading more..." : "Load More"}
          </button>
        </div>
      )}
    </div>
  );
}
