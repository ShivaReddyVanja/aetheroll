export interface ActiveSessionEntry {
  client: any;
  qrImage?: string;
  token?: Buffer;
  tokenBuffer?: Buffer;
  qrUrl?: string;
  expires?: number;
  authenticatedUser?: any;
  sessionToken?: string;
  error?: string;
}

export interface UserClientEntry {
  client: any;
  lastUsed: number;
}

export interface UploadSessionState {
  userId: string;
  fileId: any;
  totalParts: number;
  uploadedParts: Set<number>;
  fileName: string;
  fileSize: number;
  channelId: string;
  isBig: boolean;
  isVideo: boolean;
  mimeType: string;
  expiresAt: number;
  inboundQueue: Map<number, Buffer>;
  dispatchedParts: Set<number>;
  workerWaiters: Set<() => void>;
  backpressureWaiters: Set<() => void>;
  fatalError: Error | null;
  abortController: AbortController;
  workersRunning: boolean;
}

export interface MediaLocationCacheEntry {
  fileLocation: any;
  dcId?: number;
  expires: number;
}

export interface PrefetchedChunkEntry {
  buffer: Buffer;
  expires: number;
}

export interface SegmentCacheEntry {
  buffer: Buffer;
  expires: number;
  lastUsed: number;
}

export interface LogEntry {
  id: string;
  timestamp: number;
  category: "EDGE_CACHE" | "STREAM" | "PREFETCH" | "UPLOAD" | "MTPROTO" | "RAM" | "AUTH";
  level: "info" | "success" | "warn" | "error";
  message: string;
  meta?: any;
}

export const TYPES_VERSION = 1;
