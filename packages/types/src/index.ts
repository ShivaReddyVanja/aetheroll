export type MediaType = 'image' | 'video' | 'document';

export interface MediaItem {
  id: string;
  channel_id: string;
  telegram_message_id: number;
  original_telegram_message_id?: number | null;
  file_type: MediaType;
  file_size_bytes: number;
  original_file_size_bytes?: number | null;
  mime_type?: string | null;
  original_mime_type?: string | null;
  width?: number | null;
  height?: number | null;
  duration_seconds?: number | null;
  blurhash?: string | null;
  caption?: string | null;
  is_favorite: number;
  is_pinned?: number;
  is_archived?: number;
  media_group_id?: string | null;
  taken_at?: number | null;
  created_at?: string;
  updated_at?: string;
  transcode_status?: 'queued' | 'processing' | 'ready' | 'failed' | null;
  transcode_error?: string | null;
}

export interface MediaVariant {
  id: string;
  media_item_id: string;
  quality: '1080p' | '720p' | '480p' | '360p';
  telegram_message_id: number;
  file_size_bytes: number;
  width: number;
  height: number;
  bitrate_kbps?: number;
  mime_type: string;
  codec: string;
  created_at?: string;
}

export interface TelemetryLogEntry {
  id: string;
  timestamp: number;
  category: 'EDGE_CACHE' | 'STREAM' | 'PREFETCH' | 'UPLOAD' | 'MTPROTO' | 'EXOPLAYER' | 'SYSTEM' | 'ERROR' | 'RAM' | 'AUTH';
  level: 'info' | 'success' | 'warn' | 'error';
  message: string;
  meta?: any;
}

export const BRAND_NAME = "Aetheroll";
export const BRAND_TAGLINE = "Infinite Cloud Photo & Video Gallery";
export const BRAND_DESCRIPTION = "Unlimited, private, zero-knowledge cloud camera roll and media gallery";

export const PINWHEEL_FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32" fill="none">
  <path d="M12 2C9.24 2 7 4.24 7 7C7 9.76 9.24 12 12 12C12 9.24 14.24 7 17 7C19.76 7 22 4.76 22 2H12Z" fill="#EA4335"/>
  <path d="M22 12C22 9.24 19.76 7 17 7C14.24 7 12 9.24 12 12C12 14.76 14.24 17 17 17C17 19.76 19.24 22 22 22V12Z" fill="#FBBC05"/>
  <path d="M12 22C14.76 22 17 19.76 17 17C17 14.24 14.24 12 12 12C12 14.76 9.76 17 7 17C4.24 17 2 19.24 2 22H12Z" fill="#34A853"/>
  <path d="M2 12C2 14.76 4.24 17 7 17C9.76 17 12 14.76 12 12C12 9.24 9.76 7 7 7C7 4.24 4.24 2 2 2V12Z" fill="#4285F4"/>
</svg>`;
