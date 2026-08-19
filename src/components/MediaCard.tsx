"use client";

import React, { useRef, useEffect, useState } from "react";
import { Play, Check, Star, MapPin, User } from "lucide-react";
import { drawBlurHashToCanvas } from "@/lib/blurhash";

export interface MediaItem {
  id: string;
  channel_id: string;
  telegram_message_id: number;
  file_type: "photo" | "video";
  mime_type: string;
  file_size_bytes: number;
  width: number;
  height: number;
  duration_seconds: number | null;
  blur_hash: string;
  thumbnail_r2_key?: string | null;
  captured_at: string;
  is_favorite?: number | boolean;
  uploader_name?: string;
  people?: Array<{ id: string; name: string }>;
  locations?: Array<{ id: string; name: string }>;
  events?: Array<{ id: string; name: string }>;
}

interface MediaCardProps {
  item: MediaItem;
  isSelected?: boolean;
  onClick: (item: MediaItem) => void;
  onToggleFavorite: (id: string, e: React.MouseEvent) => void;
  onToggleSelect?: (id: string, e: React.MouseEvent) => void;
}

export function MediaCard({
  item,
  isSelected,
  onClick,
  onToggleFavorite,
  onToggleSelect,
}: MediaCardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hoverTimerRef = useRef<NodeJS.Timeout | null>(null);

  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);

  // Draw initial BlurHash canvas placeholder
  useEffect(() => {
    if (canvasRef.current && item.blur_hash) {
      drawBlurHashToCanvas(canvasRef.current, item.blur_hash, 32, 32);
    }
  }, [item.blur_hash]);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
      }
    };
  }, []);

  const handleMouseEnter = () => {
    if (item.file_type !== "video") return;

    // Strict 300ms intent delay
    hoverTimerRef.current = setTimeout(() => {
      setIsPlayingPreview(true);
    }, 300);
  };

  const handleMouseLeave = () => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }

    if (isPlayingPreview) {
      setIsPlayingPreview(false);
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.currentTime = 0;
        videoRef.current.src = "";
        videoRef.current.load();
      }
    }
  };

  const formatDuration = (sec: number | null) => {
    if (!sec) return "";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  const isVideo = item.file_type === "video";
  const isFavorite = !!item.is_favorite;

  return (
    <div
      onClick={() => onClick(item)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`group relative cursor-pointer overflow-hidden rounded-md bg-[var(--card-bg)] transition-all duration-150 select-none h-44 sm:h-52 md:h-60 flex-shrink-0 ${
        isSelected ? "ring-4 ring-blue-500 ring-offset-2 scale-[0.98]" : "hover:brightness-95"
      }`}
      style={{
        aspectRatio: `${Math.max(item.width, 100)} / ${Math.max(item.height, 100)}`,
      }}
    >
      {/* 1. BlurHash Background Canvas */}
      <canvas
        ref={canvasRef}
        className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
          imageLoaded ? "opacity-0" : "opacity-100"
        }`}
      />

      {/* 2. Static Thumbnail Image */}
      {!imageError && (
        <img
          src={`/api/media/${item.id}/thumbnail`}
          alt="Media"
          loading="lazy"
          onLoad={() => setImageLoaded(true)}
          onError={() => setImageError(true)}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-200 ${
            imageLoaded && !isPlayingPreview ? "opacity-100" : isPlayingPreview ? "opacity-0" : "opacity-0"
          }`}
        />
      )}

      {/* 3. Live Video Hover Stream (4 seconds loop) */}
      {isVideo && isPlayingPreview && (
        <video
          ref={videoRef}
          src={`/api/stream?media_id=${item.id}`}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          onTimeUpdate={(e) => {
            if (e.currentTarget.currentTime > 4) {
              e.currentTarget.currentTime = 0;
            }
          }}
          className="absolute inset-0 w-full h-full object-cover z-0 transition-opacity duration-300"
        />
      )}

      {/* Top Left Selection Checkmark (Google Photos Style) */}
      <div
        onClick={(e) => {
          e.stopPropagation();
          onToggleSelect?.(item.id, e);
        }}
        className={`absolute top-2 left-2 z-20 transition-opacity duration-150 ${
          isSelected
            ? "opacity-100"
            : "opacity-0 group-hover:opacity-100"
        }`}
      >
        <div
          className={`w-6 h-6 rounded-full flex items-center justify-center transition-all ${
            isSelected
              ? "bg-blue-600 text-white shadow-md"
              : "bg-black/50 text-white/80 hover:bg-black/80 hover:text-white backdrop-blur-sm"
          }`}
        >
          <Check className="w-3.5 h-3.5 stroke-[3]" />
        </div>
      </div>

      {/* Top Right Action (Favorite Star) */}
      <div className="absolute top-2 right-2 z-20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1.5">
        <button
          onClick={(e) => onToggleFavorite(item.id, e)}
          className={`p-1.5 rounded-full transition-transform active:scale-90 ${
            isFavorite
              ? "text-amber-400 bg-black/60"
              : "text-white/80 hover:text-white bg-black/40 hover:bg-black/70"
          }`}
        >
          <Star className={`w-3.5 h-3.5 ${isFavorite ? "fill-amber-400 text-amber-400" : ""}`} />
        </button>
      </div>

      {/* Video Badge / Duration (Google Photos Top-Right / Bottom-Right) */}
      {isVideo && (
        <div
          className={`absolute top-2.5 right-2.5 flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/60 backdrop-blur-sm text-white text-[11px] font-medium tracking-wide transition-opacity z-10 ${
            isPlayingPreview ? "opacity-30" : "opacity-100"
          }`}
        >
          <span>{item.duration_seconds ? formatDuration(item.duration_seconds) : "Video"}</span>
          <Play className="w-3 h-3 fill-white" />
        </div>
      )}

      {/* Bottom Info on Hover */}
      <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/80 via-black/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity text-[11px] text-white flex items-center justify-between z-10 pointer-events-none">
        <div className="truncate text-[10px] text-white/90 font-medium">
          {item.locations?.[0]?.name || item.events?.[0]?.name || ""}
        </div>
      </div>
    </div>
  );
}
