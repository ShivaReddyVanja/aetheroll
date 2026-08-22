"use client";

import React, { useRef, useEffect, useState } from "react";
import { Play, Check, Star, MapPin, User, Loader2, Image as ImageIcon } from "lucide-react";
import { drawBlurHashToCanvas } from "@/lib/blurhash";
import { getApiBaseUrl, getMediaStreamUrl, getMediaThumbnailUrl } from "@/lib/config";

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
  latitude?: number | null;
  longitude?: number | null;
  altitude?: number | null;
  is_favorite?: number | boolean;
  uploader_name?: string;
  people?: Array<{ id: string; name: string }>;
  locations?: Array<{ id: string; name: string }>;
  events?: Array<{ id: string; name: string }>;
  tags?: Array<{ id: string; name: string; color?: string | null }>;
  trips?: Array<{ id: string; name: string }>;
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
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hoverTimerRef = useRef<NodeJS.Timeout | null>(null);

  const [isVisible, setIsVisible] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [customThumb, setCustomThumb] = useState<string | null>(null);
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  const [isVideoReady, setIsVideoReady] = useState(false);
  const hasCapturedRef = useRef(false);

  // Viewport IntersectionObserver: Only mount/fetch image when card is within 300px of screen
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    if (typeof IntersectionObserver === "undefined") {
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "300px 0px" }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Capture video frame on hardware GPU and backfill to R2
  const captureAndBackfill = (videoEl: HTMLVideoElement) => {
    if (hasCapturedRef.current || !videoEl || videoEl.videoWidth === 0) return;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = videoEl.videoWidth || 400;
      canvas.height = videoEl.videoHeight || 300;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      if (dataUrl && dataUrl.length > 100) {
        hasCapturedRef.current = true;
        setCustomThumb(dataUrl);
        setImageLoaded(true);
        setImageError(false);

        // Fire-and-forget backfill to R2 & Edge Cache
        fetch(`/api/media/${item.id}/thumbnail`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageBase64: dataUrl }),
        }).catch(() => {});
      }
    } catch {}
  };

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

  useEffect(() => {
    if (isPlayingPreview && videoRef.current) {
      videoRef.current.muted = true;
      videoRef.current.defaultMuted = true;
      const playPromise = videoRef.current.play();
      if (playPromise !== undefined) {
        playPromise.catch(() => {});
      }
    }
  }, [isPlayingPreview]);

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
      setIsVideoReady(false);
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
      ref={containerRef}
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

      {/* 2. Static Thumbnail Image - Only mounted/requested once within viewport margin */}
      {isVisible && !imageError && (
        <img
          src={customThumb || getMediaThumbnailUrl(item.id)}
          alt="Media"
          loading="lazy"
          decoding="async"
          onLoad={() => setImageLoaded(true)}
          onError={() => setImageError(true)}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
            imageLoaded && (!isPlayingPreview || !isVideoReady) ? "opacity-100" : isVideoReady ? "opacity-0" : "opacity-100"
          }`}
        />
      )}

      {isVisible && imageError && (
        /* Fallback UI when thumbnail image failed */
        <div className="absolute inset-0 w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-slate-400 p-3 select-none">
          {isVideo ? (
            <div className="flex flex-col items-center gap-2">
              <div className="w-11 h-11 rounded-full bg-blue-600/20 border border-blue-500/30 text-blue-400 flex items-center justify-center shadow-lg">
                <Play className="w-5 h-5 ml-0.5 fill-current" />
              </div>
              <span className="text-[11px] font-medium text-slate-300">
                {item.duration_seconds ? formatDuration(item.duration_seconds) : "Video"}
              </span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <div className="w-11 h-11 rounded-full bg-emerald-600/20 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shadow-lg">
                <ImageIcon className="w-5 h-5" />
              </div>
              <span className="text-[11px] font-medium text-slate-300">Photo</span>
            </div>
          )}
        </div>
      )}

      {/* 3. Live Video Hover Stream (4 seconds loop with zero black flash) */}
      {isVideo && isPlayingPreview && (
        <video
          ref={(el) => {
            (videoRef as any).current = el;
            if (el) {
              el.muted = true;
              el.defaultMuted = true;
            }
          }}
          src={getMediaStreamUrl(item.id)}
          poster={customThumb || getMediaThumbnailUrl(item.id)}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          onCanPlay={(e) => {
            e.currentTarget.muted = true;
            e.currentTarget.play().catch(() => {});
            setIsVideoReady(true);
            captureAndBackfill(e.currentTarget);
          }}
          onPlaying={(e) => {
            setIsVideoReady(true);
            captureAndBackfill(e.currentTarget);
          }}
          onLoadedData={(e) => {
            setIsVideoReady(true);
            captureAndBackfill(e.currentTarget);
          }}
          onTimeUpdate={(e) => {
            if (e.currentTarget.currentTime > 4) {
              e.currentTarget.currentTime = 0;
            }
          }}
          className={`absolute inset-0 w-full h-full object-cover z-0 transition-opacity duration-300 ${
            isVideoReady ? "opacity-100" : "opacity-0"
          }`}
        />
      )}

      {/* 4. Loading Spinner while Video is Buffering on Hover */}
      {isVideo && isPlayingPreview && !isVideoReady && (
        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
          <div className="w-10 h-10 rounded-full bg-black/60 backdrop-blur-md flex items-center justify-center shadow-lg border border-white/10">
            <Loader2 className="w-5 h-5 text-white animate-spin" />
          </div>
        </div>
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

      {/* Video Badge / Duration / Loading Indicator */}
      {isVideo && (
        <div
          className={`absolute top-2.5 right-2.5 flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/60 backdrop-blur-sm text-white text-[11px] font-medium tracking-wide transition-opacity z-10 ${
            isPlayingPreview && isVideoReady ? "opacity-30" : "opacity-100"
          }`}
        >
          {isPlayingPreview && !isVideoReady ? (
            <>
              <span>Loading</span>
              <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />
            </>
          ) : (
            <>
              <span>{item.duration_seconds ? formatDuration(item.duration_seconds) : "Video"}</span>
              <Play className="w-3 h-3 fill-white" />
            </>
          )}
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
