"use client";

import React, { useState, useEffect } from "react";
import { X, ChevronLeft, ChevronRight, Heart, Download, Info, Trash2, Play, Pause } from "lucide-react";
import { MediaItem } from "./MediaCard";
import { TagDrawer } from "./TagDrawer";
import { getApiBaseUrl } from "@/lib/config";

interface MediaViewerProps {
  item: MediaItem;
  items: MediaItem[];
  channelId: string;
  onClose: () => void;
  onNavigate: (item: MediaItem) => void;
  onToggleFavorite: (id: string, e: React.MouseEvent) => void;
  onItemUpdated: () => void;
  onDelete?: (id: string) => void;
}

export function MediaViewer({
  item,
  items,
  channelId,
  onClose,
  onNavigate,
  onToggleFavorite,
  onItemUpdated,
  onDelete,
}: MediaViewerProps) {
  const [showTagDrawer, setShowTagDrawer] = useState(false);

  const currentIndex = items.findIndex((i) => i.id === item.id);
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < items.length - 1;

  const handlePrev = () => {
    if (hasPrev) onNavigate(items[currentIndex - 1]);
  };

  const handleNext = () => {
    if (hasNext) onNavigate(items[currentIndex + 1]);
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && hasPrev) handlePrev();
      if (e.key === "ArrowRight" && hasNext) handleNext();
      if (e.key === "i" || e.key === "I") setShowTagDrawer((prev) => !prev);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentIndex, hasPrev, hasNext]);

  const isVideo = item.file_type === "video";
  const isFavorite = !!item.is_favorite;

  return (
    <div className="fixed inset-0 z-50 bg-black/95 backdrop-blur-md flex">
      {/* Main Lightbox Content */}
      <div className="flex-1 flex flex-col h-full relative overflow-hidden">
        {/* Top Control Bar */}
        <header className="h-16 px-4 flex items-center justify-between z-20 bg-gradient-to-b from-black/80 to-transparent">
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="p-2 rounded-full text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
            <div className="text-xs text-slate-400">
              {currentIndex + 1} of {items.length}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Favorite Toggle */}
            <button
              onClick={(e) => onToggleFavorite(item.id, e)}
              className={`p-2 rounded-full transition-colors ${
                isFavorite
                  ? "text-rose-500 bg-white/10"
                  : "text-slate-300 hover:text-white hover:bg-white/10"
              }`}
            >
              <Heart className={`w-5 h-5 ${isFavorite ? "fill-rose-500 text-rose-500" : ""}`} />
            </button>

            {/* Download Original Button */}
            <a
              href={`/api/stream?media_id=${item.id}`}
              download
              target="_blank"
              rel="noreferrer"
              className="p-2 rounded-full text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
            >
              <Download className="w-5 h-5" />
            </a>

            {/* Info / Tag Drawer Toggle */}
            <button
              onClick={() => setShowTagDrawer((prev) => !prev)}
              className={`p-2 rounded-full transition-colors ${
                showTagDrawer
                  ? "text-blue-400 bg-blue-500/20"
                  : "text-slate-300 hover:text-white hover:bg-white/10"
              }`}
            >
              <Info className="w-5 h-5" />
            </button>

            {/* Delete Button */}
            {onDelete && (
              <button
                onClick={() => onDelete(item.id)}
                title="Delete photo / video"
                className="p-2 rounded-full text-slate-300 hover:text-rose-400 hover:bg-rose-500/20 transition-colors"
              >
                <Trash2 className="w-5 h-5" />
              </button>
            )}
          </div>
        </header>

        {/* Media Canvas Stage */}
        <div className="flex-1 flex items-center justify-center relative p-4 select-none">
          {isVideo ? (
            <video
              key={item.id}
              src={`${getApiBaseUrl()}/api/stream?media_id=${item.id}`}
              poster={`${getApiBaseUrl()}/api/media/${item.id}/thumbnail`}
              controls
              autoPlay
              playsInline
              preload="auto"
              onCanPlay={(e) => {
                const playPromise = e.currentTarget.play();
                if (playPromise !== undefined) {
                  playPromise.catch(() => {});
                }
              }}
              className="max-h-[85vh] max-w-[90vw] rounded-lg shadow-2xl object-contain bg-black"
            />
          ) : (
            <img
              key={item.id}
              src={`${getApiBaseUrl()}/api/stream?media_id=${item.id}`}
              alt="Full Media"
              className="max-h-[85vh] max-w-[90vw] rounded-lg shadow-2xl object-contain transition-opacity duration-300"
            />
          )}

          {/* Left / Right Nav Arrows */}
          {hasPrev && (
            <button
              onClick={handlePrev}
              className="absolute left-4 p-3 rounded-full bg-black/40 hover:bg-black/80 text-white transition-all hover:scale-110 active:scale-95"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
          )}
          {hasNext && (
            <button
              onClick={handleNext}
              className="absolute right-4 p-3 rounded-full bg-black/40 hover:bg-black/80 text-white transition-all hover:scale-110 active:scale-95"
            >
              <ChevronRight className="w-6 h-6" />
            </button>
          )}
        </div>
      </div>

      {/* Side Tagging / Inspector Drawer */}
      {showTagDrawer && (
        <TagDrawer
          item={item}
          channelId={channelId}
          onClose={() => setShowTagDrawer(false)}
          onItemUpdated={onItemUpdated}
        />
      )}
    </div>
  );
}
