export type BackupStatus = 'pending' | 'uploading' | 'completed' | 'failed' | 'paused';

export interface BackupItem {
  id: string;
  uri: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  status: BackupStatus;
  progress: number;
  error?: string;
  channelId: string;
  createdAt: number;
  completedAt?: number;
  telegramMessageId?: number;
}

export interface BackupStats {
  total: number;
  completed: number;
  failed: number;
  pending: number;
  inProgress: number;
  bytesUploaded: number;
  totalBytes: number;
}

export interface BackupListenerPayload {
  queue: BackupItem[];
  stats: BackupStats;
  isSyncing: boolean;
  currentItem?: BackupItem;
}
