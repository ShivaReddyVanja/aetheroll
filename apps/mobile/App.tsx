import React from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GalleryScreen } from './src/screens/GalleryScreen';

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      <GalleryScreen />
    </SafeAreaProvider>
  );
}
