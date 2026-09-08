import AsyncStorage from '@react-native-async-storage/async-storage';
import { BackupItem } from './types';

const QUEUE_STORAGE_KEY = '@aetheroll_backup_queue_v2';
const COMPLETED_HISTORY_KEY = '@aetheroll_backup_completed_v1';

export class QueueStorage {
  private static cachedQueue: BackupItem[] | null = null;
  private static completedUrisSet: Set<string> | null = null;

  /**
   * Load the persistent queue from durable storage.
   * Resets any stale in-flight 'uploading' items to 'pending' so no task is permanently orphaned.
   */
  static async loadQueue(): Promise<BackupItem[]> {
    try {
      if (this.cachedQueue) {
        return [...this.cachedQueue];
      }

      const raw = await AsyncStorage.getItem(QUEUE_STORAGE_KEY);
      let items: BackupItem[] = [];
      if (raw) {
        const parsed = JSON.parse(raw);
        items = Array.isArray(parsed) ? parsed : [];
      }

      // Reset any interrupted uploading items back to pending
      let modified = false;
      items = items.map((item) => {
        if (item.status === 'uploading') {
          modified = true;
          return { ...item, status: 'pending', progress: 0, speedFormatted: undefined };
        }
        return item;
      });

      if (modified) {
        await AsyncStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(items));
      }

      this.cachedQueue = items;
      return [...items];
    } catch (err) {
      console.warn('[QueueStorage] Failed to load queue:', err);
      return [];
    }
  }

  /**
   * Save queue atomically to storage and memory cache.
   * cachedQueue is updated ONLY after the disk write succeeds to prevent divergence.
   */
  static async saveQueue(queue: BackupItem[]): Promise<void> {
    try {
      await AsyncStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue));
      // Update in-memory cache only after confirmed disk write
      this.cachedQueue = [...queue];
    } catch (err) {
      console.warn('[QueueStorage] Failed to save queue:', err);
      // Do NOT update cachedQueue — keep it reflecting last known good disk state
    }
  }

  /**
   * Add new items, filtering out items already in the active queue OR already completed.
   * Pre-hydrates completedUrisSet so the dedup check is always accurate regardless of
   * call order — fixes the bug where addItems() called before isUriCompleted() bypasses
   * the completion ledger entirely.
   */
  static async addItems(items: BackupItem[]): Promise<BackupItem[]> {
    // Ensure completedUrisSet is loaded before filtering
    if (!this.completedUrisSet) {
      try {
        const raw = await AsyncStorage.getItem(COMPLETED_HISTORY_KEY);
        const list: string[] = raw ? JSON.parse(raw) : [];
        this.completedUrisSet = new Set(list);
      } catch {
        this.completedUrisSet = new Set();
      }
    }

    const current = await this.loadQueue();
    const existingUris = new Set(current.map((it) => it.uri));

    const newItems: BackupItem[] = [];
    for (const it of items) {
      if (existingUris.has(it.uri)) continue;
      if (this.completedUrisSet.has(it.uri)) continue;
      newItems.push(it);
    }

    if (newItems.length === 0) return current;

    const updated = [...current, ...newItems];
    await this.saveQueue(updated);
    return updated;
  }

  /**
   * Update a single item by ID
   */
  static async updateItem(id: string, updates: Partial<BackupItem>): Promise<BackupItem[]> {
    const current = await this.loadQueue();
    const updated = current.map((item) => (item.id === id ? { ...item, ...updates } : item));
    await this.saveQueue(updated);

    // If item completed, record in completed history for deduplication
    if (updates.status === 'completed') {
      const completedItem = updated.find((i) => i.id === id);
      if (completedItem?.uri) {
        await this.recordCompletedUri(completedItem.uri);
      }
    }

    return updated;
  }

  /**
   * Batch update multiple items at once
   */
  static async updateItemsBatch(updatesMap: Map<string, Partial<BackupItem>>): Promise<BackupItem[]> {
    const current = await this.loadQueue();
    const updated = current.map((item) => {
      const update = updatesMap.get(item.id);
      return update ? { ...item, ...update } : item;
    });
    await this.saveQueue(updated);
    return updated;
  }

  /**
   * Remove item from queue
   */
  static async removeItem(id: string): Promise<BackupItem[]> {
    const current = await this.loadQueue();
    const updated = current.filter((item) => item.id !== id);
    await this.saveQueue(updated);
    return updated;
  }

  /**
   * Clear all completed items from active queue
   */
  static async clearCompleted(): Promise<BackupItem[]> {
    const current = await this.loadQueue();
    const updated = current.filter((item) => item.status !== 'completed');
    await this.saveQueue(updated);
    return updated;
  }

  /**
   * Check if a media URI has already been backed up in the past
   */
  static async isUriCompleted(uri: string): Promise<boolean> {
    try {
      if (!this.completedUrisSet) {
        const raw = await AsyncStorage.getItem(COMPLETED_HISTORY_KEY);
        const list: string[] = raw ? JSON.parse(raw) : [];
        this.completedUrisSet = new Set(list);
      }
      return this.completedUrisSet.has(uri);
    } catch {
      return false;
    }
  }

  private static async recordCompletedUri(uri: string): Promise<void> {
    try {
      if (!this.completedUrisSet) {
        const raw = await AsyncStorage.getItem(COMPLETED_HISTORY_KEY);
        const list: string[] = raw ? JSON.parse(raw) : [];
        this.completedUrisSet = new Set(list);
      }
      this.completedUrisSet.add(uri);
      // Keep last 10,000 completed URIs
      const arr = Array.from(this.completedUrisSet).slice(-10000);
      await AsyncStorage.setItem(COMPLETED_HISTORY_KEY, JSON.stringify(arr));
    } catch (err) {
      console.warn('[QueueStorage] Failed to record completed URI:', err);
    }
  }

  static async clearAll(): Promise<void> {
    try {
      this.cachedQueue = [];
      await AsyncStorage.removeItem(QUEUE_STORAGE_KEY);
    } catch (err) {
      console.warn('[QueueStorage] Failed to clear all:', err);
    }
  }
}
