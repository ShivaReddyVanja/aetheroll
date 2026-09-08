import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet, Dimensions } from 'react-native';

const { width } = Dimensions.get('window');
const COLUMN_WIDTH = (width - 24) / 2;

export function MediaCardSkeleton() {
  const pulseAnim = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 0.8,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.3,
          duration: 800,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, [pulseAnim]);

  return (
    <View style={styles.skeletonContainer}>
      <Animated.View style={[styles.skeletonBlock, { opacity: pulseAnim }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  skeletonContainer: {
    width: COLUMN_WIDTH,
    height: COLUMN_WIDTH * 1.2,
    margin: 4,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#1e293b',
  },
  skeletonBlock: {
    flex: 1,
    backgroundColor: '#334155',
  },
});
