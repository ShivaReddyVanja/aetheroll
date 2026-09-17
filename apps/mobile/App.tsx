import React, { useEffect } from 'react';
import { Alert, StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GalleryScreen } from './src/screens/GalleryScreen';
import {
  checkForAndroidUpdate,
  dismissAndroidUpdate,
  downloadAndInstallAndroidUpdate,
} from './src/services/appUpdateService';

export default function App() {
  useEffect(() => {
    checkForAndroidUpdate()
      .then((release) => {
        if (!release) return;
        const mandatory = !!release.minSupportedVersionCode;
        Alert.alert(
          `Aetheroll ${release.version} is available`,
          release.releaseNotes.join('\n') || 'A new version is ready to install.',
          [
            ...(!mandatory ? [{ text: 'Later', onPress: () => dismissAndroidUpdate(release.versionCode) }] : []),
            {
              text: 'Download',
              onPress: () => downloadAndInstallAndroidUpdate(release).catch((error) => {
                Alert.alert('Update unavailable', error?.message || 'Please try again later.');
              }),
            },
          ],
        );
      })
      .catch(() => {});
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      <GalleryScreen />
    </SafeAreaProvider>
  );
}
