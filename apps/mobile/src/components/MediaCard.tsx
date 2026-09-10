import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Animated,
} from 'react-native';
import { getMediaThumbnailUrl, getAuthImageHeaders } from '../services/api';

const { width } = Dimensions.get('window');
// Guarantee exactly 3 columns with 2px gap (2 gaps * 2px = 4px)
const COLUMN_WIDTH = Math.floor((width - 4) / 3);

export interface MediaItemData {
  id: string;
  telegramMessageId: number;
  fileType: 'photo' | 'video';
  fileSizeBytes: number;
  width: number;
  height: number;
  durationSeconds?: number;
  blurHash?: string;
  isFavorite?: boolean;
  capturedAt: string | Date;
}

interface MediaCardProps {
  item: MediaItemData;
  isSelected?: boolean;
  isSelectionMode?: boolean;
  onPress: (item: MediaItemData) => void;
  onLongPress?: (item: MediaItemData) => void;
  onToggleFavorite?: (id: string) => void;
}

function MediaCardComponent({
  item,
  isSelected = false,
  isSelectionMode = false,
  onPress,
  onLongPress,
  onToggleFavorite,
}: MediaCardProps) {
  const [hasError, setHasError] = useState(false);

  const imageUri = useMemo(
    () => getMediaThumbnailUrl(item.id),
    [item.id]
  );

  // Smooth Google Photos spring animations for selection
  const scaleAnim = useRef(new Animated.Value(isSelected ? 0.90 : 1.0)).current;
  const checkScaleAnim = useRef(new Animated.Value(isSelected ? 1.0 : (isSelectionMode ? 0.85 : 0))).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scaleAnim, {
        toValue: isSelected ? 0.90 : 1.0,
        friction: 8,
        tension: 140,
        useNativeDriver: true,
      }),
      Animated.spring(checkScaleAnim, {
        toValue: isSelected ? 1.0 : (isSelectionMode ? 0.85 : 0),
        friction: 7,
        tension: 130,
        useNativeDriver: true,
      }),
    ]).start();
  }, [isSelected, isSelectionMode]);

  const formatDuration = (sec?: number) => {
    if (!sec) return '';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <TouchableOpacity
      activeOpacity={0.9}
      delayLongPress={220}
      style={styles.container}
      onPress={() => onPress(item)}
      onLongPress={() => onLongPress?.(item)}
    >
      <Animated.View
        style={[
          styles.imageWrapper,
          {
            transform: [{ scale: scaleAnim }],
          },
        ]}
      >
        {!hasError ? (
          <Image
            source={{
              uri: imageUri,
              headers: getAuthImageHeaders(),
            }}
            style={styles.image}
            resizeMode="cover"
            onError={() => setHasError(true)}
          />
        ) : (
          <View style={styles.fallback}>
            <Text style={styles.fallbackText}>
              {item.fileType === 'video' ? '▶' : '◫'}
            </Text>
          </View>
        )}

        {/* Video Duration Badge */}
        {item.fileType === 'video' && (
          <View style={styles.videoBadge}>
            <Text style={styles.videoBadgeText}>
              {formatDuration(item.durationSeconds) || '0:00'} ▶
            </Text>
          </View>
        )}

        {/* Favorite Star Badge */}
        {item.isFavorite && !isSelectionMode && (
          <TouchableOpacity
            style={styles.starBadge}
            onPress={() => onToggleFavorite?.(item.id)}
            activeOpacity={0.7}
          >
            <Text style={styles.starText}>★</Text>
          </TouchableOpacity>
        )}

        {/* Selected Highlight Overlay (Border + Tint) */}
        {isSelected && <View style={styles.selectedOverlay} pointerEvents="none" />}
      </Animated.View>

      {/* Google Photos Checkbox Circle with spring pop-in */}
      {(isSelectionMode || isSelected) && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.checkCircle,
            isSelected ? styles.checkCircleSelected : styles.checkCircleUnselected,
            {
              transform: [{ scale: checkScaleAnim }],
            },
          ]}
        >
          {isSelected && <Text style={styles.checkMark}>✓</Text>}
        </Animated.View>
      )}
    </TouchableOpacity>
  );
}

// Strict shallow comparison to prevent unnecessary re-renders across the grid
export const MediaCard = React.memo(MediaCardComponent, (prev, next) => {
  return (
    prev.item.id === next.item.id &&
    prev.isSelected === next.isSelected &&
    prev.isSelectionMode === next.isSelectionMode &&
    prev.item.isFavorite === next.item.isFavorite &&
    prev.item.fileType === next.item.fileType &&
    prev.onPress === next.onPress &&
    prev.onLongPress === next.onLongPress &&
    prev.onToggleFavorite === next.onToggleFavorite
  );
});

const styles = StyleSheet.create({
  container: {
    width: COLUMN_WIDTH,
    height: COLUMN_WIDTH,
    backgroundColor: '#000000',
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageWrapper: {
    width: '100%',
    height: '100%',
    backgroundColor: '#1E1E1E',
    borderRadius: 8,
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  selectedOverlay: {
    ...StyleSheet.absoluteFill,
    borderRadius: 8,
    borderWidth: 3,
    borderColor: '#1A73E8',
    backgroundColor: 'rgba(26, 115, 232, 0.22)',
  },
  fallback: {
    flex: 1,
    backgroundColor: '#1E1E1E',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fallbackText: {
    fontSize: 22,
    color: '#5F6368',
    fontWeight: '700',
  },
  videoBadge: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  videoBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
  starBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    width: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
  },
  starText: {
    color: '#FBBF24',
    fontSize: 12,
    fontWeight: '900',
  },
  checkCircle: {
    position: 'absolute',
    top: 8,
    left: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  checkCircleUnselected: {
    borderWidth: 2,
    borderColor: '#FFFFFF',
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 2,
    elevation: 3,
  },
  checkCircleSelected: {
    backgroundColor: '#1A73E8',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    shadowColor: '#1A73E8',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 4,
    elevation: 4,
  },
  checkMark: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },
});
