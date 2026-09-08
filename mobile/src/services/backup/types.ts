export type BackupStatus = 'pending' | 'uploading' | 'completed' | 'failed' | 'paused';

export interface BackupItem {
  id: string;
  uri: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  status: BackupStatus;
  progress: number; // 0 to 100
  uploadedBytes?: number;
  speedFormatted?: string;
  error?: string;
  channelId: string;
  createdAt: number;
  completedAt?: number;
  telegramMessageId?: number;
  mediaId?: string;
  attempts?: number;
  lastAttemptAt?: number;
}

export interface BackupStats {
  total: number;
  completed: number;
  failed: number;
  pending: number;
  inProgress: number;
  bytesUploaded: number;
  totalBytes: number;
  speedFormatted: string;
  speedBytesPerSec: number;
  etaFormatted: string;
  activeWorkers: number;
}

export interface BackupListenerPayload {
  queue: BackupItem[];
  stats: BackupStats;
  isSyncing: boolean;
  activeItems: BackupItem[];
  currentItem?: BackupItem;
}
