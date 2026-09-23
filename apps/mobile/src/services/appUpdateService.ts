import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeModules, Platform, DeviceEventEmitter, EmitterSubscription } from 'react-native';
import { getApiBaseUrl } from './api';

const DISMISSED_UPDATE_VERSION_KEY = '@aetheroll/dismissed_update_version_code';

export interface AndroidRelease {
  version: string;
  versionCode: number;
  publishedAt: string;
  sha256: string;
  sizeBytes: number;
  releaseNotes: string[];
  minSupportedVersionCode?: number;
}

export interface AppVersionInfo {
  versionName: string;
  versionCode: number;
}

export interface UpdateProgressEvent {
  percent: number;
  bytesWritten: number;
  totalBytes: number;
}

export function subscribeToUpdateProgress(
  onProgress: (event: UpdateProgressEvent) => void,
  onStatus?: (status: string | null) => void,
): () => void {
  const subscriptions: EmitterSubscription[] = [];

  subscriptions.push(
    DeviceEventEmitter.addListener('onAppUpdateProgress', onProgress),
  );

  if (onStatus) {
    subscriptions.push(
      DeviceEventEmitter.addListener('onAppUpdateStatus', onStatus),
    );
  }

  return () => {
    subscriptions.forEach((sub) => sub.remove());
  };
}

interface AppUpdateNativeModule {
  getVersionCode(): Promise<number>;
  getAppVersionInfo?(): Promise<AppVersionInfo>;
  downloadAndInstall(downloadUrl: string, expectedSha256: string): Promise<void>;
}

function nativeUpdater(): AppUpdateNativeModule | null {
  return (NativeModules.AppUpdateModule as AppUpdateNativeModule | undefined) || null;
}

export async function getAppVersionInfo(): Promise<AppVersionInfo> {
  if (Platform.OS !== 'android') {
    return { versionName: '1.0.0', versionCode: 1 };
  }

  const updater = nativeUpdater();
  if (!updater) {
    return { versionName: '1.0.0', versionCode: 1 };
  }

  if (typeof updater.getAppVersionInfo === 'function') {
    try {
      const info = await updater.getAppVersionInfo();
      if (info && info.versionName) {
        return info;
      }
    } catch {
      // fallback to getVersionCode
    }
  }

  try {
    const code = await updater.getVersionCode();
    return { versionName: '1.0.0', versionCode: code };
  } catch {
    return { versionName: '1.0.0', versionCode: 1 };
  }
}

export interface CheckUpdateOptions {
  ignoreDismissed?: boolean;
}

export async function checkForAndroidUpdate(options?: CheckUpdateOptions): Promise<AndroidRelease | null> {
  if (Platform.OS !== 'android') return null;

  const updater = nativeUpdater();
  if (!updater) return null;

  const [currentVersionCode, response] = await Promise.all([
    updater.getVersionCode(),
    fetch(`${getApiBaseUrl()}/api/releases/android/latest`, {
      headers: { Accept: 'application/json' },
    }),
  ]);

  if (!response.ok) return null;
  const release = await response.json() as AndroidRelease;
  if (!Number.isInteger(release.versionCode) || release.versionCode <= currentVersionCode) return null;

  if (options?.ignoreDismissed) {
    return release;
  }

  const dismissedVersion = Number(await AsyncStorage.getItem(DISMISSED_UPDATE_VERSION_KEY));
  if (dismissedVersion === release.versionCode && !release.minSupportedVersionCode) return null;
  if (release.minSupportedVersionCode && currentVersionCode < release.minSupportedVersionCode) return release;
  return dismissedVersion === release.versionCode ? null : release;
}

export async function dismissAndroidUpdate(versionCode: number): Promise<void> {
  await AsyncStorage.setItem(DISMISSED_UPDATE_VERSION_KEY, String(versionCode));
}

export async function downloadAndInstallAndroidUpdate(release: AndroidRelease): Promise<void> {
  const updater = nativeUpdater();
  if (!updater) throw new Error('In-app updates are unavailable in this build.');
  await updater.downloadAndInstall(
    `${getApiBaseUrl()}/api/releases/android/latest/download`,
    release.sha256,
  );
}
