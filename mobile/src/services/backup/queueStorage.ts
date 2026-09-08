import AsyncStorage from '@react-native-async-storage/async-storage';
import { BackupItem } from './types';

const QUEUE_STORAGE_KEY = '@aetheroll_backup_queue_v1';

export class QueueStorage {
  static async loadQueue(): Promise<BackupItem[]> {
    try {
      const raw = await AsyncStorage.getItem(QUEUE_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      console.warn('[QueueStorage] Failed to load queue:', err);
      return [];
    }
  }

  static async saveQueue(queue: BackupItem[]): Promise<void> {
    try {
      await AsyncStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue));
    } catch (err) {
      console.warn('[QueueStorage] Failed to save queue:', err);
    }
  }

  static async addItems(items: BackupItem[]): Promise<BackupItem[]> {
    const current = await this.loadQueue();
    // Prevent duplicate URIs if already queued
    const existingUris = new Set(current.map((it) => it.uri));
    const newItems = items.filter((it) => !existingUris.has(it.uri));
    const updated = [...current, ...newItems];
    await this.saveQueue(updated);
    return updated;
  }

  static async updateItem(id: string, updates: Partial<BackupItem>): Promise<BackupItem[]> {
    const current = await this.loadQueue();
    const updated = current.map((item) => (item.id === id ? { ...item, ...updates } : item));
    await this.saveQueue(updated);
    return updated;
  }

  static async removeItem(id: string): Promise<BackupItem[]> {
    const current = await this.loadQueue();
    const updated = current.filter((item) => item.id !== id);
    await this.saveQueue(updated);
    return updated;
  }

  static async clearCompleted(): Promise<BackupItem[]> {
    const current = await this.loadQueue();
    const updated = current.filter((item) => item.status !== 'completed');
    await this.saveQueue(updated);
    return updated;
  }

  static async clearAll(): Promise<void> {
    try {
      await AsyncStorage.removeItem(QUEUE_STORAGE_KEY);
    } catch (err) {
      console.warn('[QueueStorage] Failed to clear all:', err);
    }
  }
}
