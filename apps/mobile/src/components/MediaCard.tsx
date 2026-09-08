import React, { useState } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { getMediaThumbnailUrl, getMediaStreamUrl } from '../services/api';

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

  const formatDuration = (sec?: number) => {
    if (!sec) return '';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      style={[
        styles.card,
        isSelected && styles.cardSelected,
      ]}
      onPress={() => onPress(item)}
      onLongPress={() => onLongPress?.(item)}
    >
      {!hasError ? (
        <Image
          source={{ uri: item.fileType === 'video' ? getMediaThumbnailUrl(item.id) : getMediaStreamUrl(item.id) }}
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

      {/* Selection Checkbox Overlay */}
      {isSelectionMode && (
        <View style={[styles.checkCircle, isSelected && styles.checkCircleSelected]}>
          {isSelected && <Text style={styles.checkMark}>✓</Text>}
        </View>
      )}
    </TouchableOpacity>
  );
}

export const MediaCard = React.memo(MediaCardComponent);

const styles = StyleSheet.create({
  card: {
    width: COLUMN_WIDTH,
    height: COLUMN_WIDTH,
    backgroundColor: '#F1F3F4',
    position: 'relative',
    overflow: 'hidden',
  },
  cardSelected: {
    opacity: 0.85,
    borderWidth: 2,
    borderColor: '#1A73E8',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  fallback: {
    flex: 1,
    backgroundColor: '#E8EAED',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fallbackText: {
    fontSize: 22,
    color: '#9AA0A6',
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
    top: 6,
    left: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkCircleSelected: {
    backgroundColor: '#1A73E8',
    borderColor: '#1A73E8',
  },
  checkMark: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
  },
});
