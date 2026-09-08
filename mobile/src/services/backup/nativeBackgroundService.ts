import { NativeModules, Platform } from 'react-native';

const { BackupServiceModule } = NativeModules;

export class NativeBackgroundService {
  private static isRunning = false;
  private static lastUpdateTimestamp = 0;
  private static readonly UPDATE_THROTTLE_MS = 600;

  /**
   * Query the native layer to reconcile isRunning flag with actual Android service state.
   * Call this on app launch / JS bridge restart to prevent ghost service scenarios where
   * the JS flag was reset (hot reload / OOM) but the native service is still alive.
   */
  static async syncState(): Promise<void> {
    if (Platform.OS !== 'android' || !BackupServiceModule) return;
    try {
      const running: boolean = await BackupServiceModule.isServiceRunning();
      this.isRunning = running;
      if (!running) {
        this.lastUpdateTimestamp = 0;
      }
    } catch {
      // If native doesn't have isServiceRunning yet, leave isRunning as-is
    }
  }

  static async start(title = 'Aetheroll Cloud Vault', message = 'Starting backup sync...'): Promise<boolean> {
    if (Platform.OS !== 'android' || !BackupServiceModule) {
      return false;
    }

    try {
      this.isRunning = true;
      await BackupServiceModule.startService(title, message);
      return true;
    } catch (err) {
      console.warn('[NativeBackgroundService] Failed to start foreground service:', err);
      this.isRunning = false;
      return false;
    }
  }

  static async updateProgress(
    title: string,
    message: string,
    progress: number,
    max = 100,
    indeterminate = false,
    force = false
  ): Promise<void> {
    if (Platform.OS !== 'android' || !BackupServiceModule || !this.isRunning) {
      return;
    }

    const now = Date.now();
    if (!force && now - this.lastUpdateTimestamp < this.UPDATE_THROTTLE_MS) {
      return;
    }
    this.lastUpdateTimestamp = now;

    try {
      await BackupServiceModule.updateProgress(
        title,
        message,
        Math.max(0, Math.min(progress, max)),
        max,
        indeterminate
      );
    } catch (err) {
      console.warn('[NativeBackgroundService] Failed to update progress notification:', err);
    }
  }

  static async stop(): Promise<void> {
    if (Platform.OS !== 'android' || !BackupServiceModule) {
      return;
    }

    // NOTE: We do NOT gate on isRunning here. If the JS bridge restarts (hot reload, OOM
    // kill of JS thread), isRunning resets to false while the native service keeps running.
    // Always passing the stop command through is safe — the native service is idempotent.
    try {
      this.isRunning = false;
      this.lastUpdateTimestamp = 0;
      await BackupServiceModule.stopService();
    } catch (err) {
      console.warn('[NativeBackgroundService] Failed to stop foreground service:', err);
    }
  }

  static async isBatteryOptimizationIgnored(): Promise<boolean> {
    if (Platform.OS !== 'android' || !BackupServiceModule) {
      return true;
    }

    try {
      return await BackupServiceModule.isIgnoringBatteryOptimizations();
    } catch {
      return true;
    }
  }

  static async requestIgnoreBatteryOptimization(): Promise<boolean> {
    if (Platform.OS !== 'android' || !BackupServiceModule) {
      return false;
    }

    try {
      return await BackupServiceModule.requestIgnoreBatteryOptimizations();
    } catch (err) {
      console.warn('[NativeBackgroundService] Failed to request battery optimization ignore:', err);
      return false;
    }
  }
}


