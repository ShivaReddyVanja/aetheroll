import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeModules, Platform } from 'react-native';
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

interface AppUpdateNativeModule {
  getVersionCode(): Promise<number>;
  downloadAndInstall(downloadUrl: string, expectedSha256: string): Promise<void>;
}

function nativeUpdater(): AppUpdateNativeModule | null {
  return NativeModules.AppUpdateModule as AppUpdateNativeModule | undefined || null;
}

export async function checkForAndroidUpdate(): Promise<AndroidRelease | null> {
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
