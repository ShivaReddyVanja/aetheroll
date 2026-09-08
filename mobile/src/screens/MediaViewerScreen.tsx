import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Modal,
  TouchableWithoutFeedback,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getMediaStreamUrl } from '../services/api';
import { MediaItemData } from '../components/MediaCard';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface MediaViewerScreenProps {
  item: MediaItemData | null;
  items: MediaItemData[];
  onClose: () => void;
  onToggleFavorite?: (id: string) => void;
}

export function MediaViewerScreen({ item, items, onClose, onToggleFavorite }: MediaViewerScreenProps) {
  if (!item) return null;

  const [currentIndex, setCurrentIndex] = useState(items.findIndex((i) => i.id === item.id));
  const activeItem = items[currentIndex] || item;

  const [isPlaying, setIsPlaying] = useState(true);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [showControls, setShowControls] = useState(true);
  const [skipFeedback, setSkipFeedback] = useState<'+10s' | '-10s' | null>(null);

  const lastTapRef = useRef<number>(0);
  const tapTimerRef = useRef<any>(null);

  const isVideo = activeItem.fileType === 'video';

  const handleTap = (evt: any) => {
    const now = Date.now();
    const DOUBLE_TAP_DELAY = 300;
    const touchX = evt.nativeEvent.locationX;

    if (now - lastTapRef.current < DOUBLE_TAP_DELAY) {
      if (tapTimerRef.current) clearTimeout(tapTimerRef.current);

      // Double tap registered
      if (touchX > SCREEN_WIDTH / 2) {
        // Fast forward +10s
        triggerSkip('+10s');
      } else {
        // Rewind -10s
        triggerSkip('-10s');
      }
    } else {
      tapTimerRef.current = setTimeout(() => {
        setShowControls((prev) => !prev);
      }, DOUBLE_TAP_DELAY);
    }
    lastTapRef.current = now;
  };

  const triggerSkip = (type: '+10s' | '-10s') => {
    setSkipFeedback(type);
    setTimeout(() => setSkipFeedback(null), 700);
  };

  const cycleSpeed = () => {
    const speeds = [1.0, 1.25, 1.5, 2.0];
    const nextIdx = (speeds.indexOf(playbackRate) + 1) % speeds.length;
    setPlaybackRate(speeds[nextIdx]);
  };

  const handlePrev = () => {
    if (currentIndex > 0) setCurrentIndex(currentIndex - 1);
  };

  const handleNext = () => {
    if (currentIndex < items.length - 1) setCurrentIndex(currentIndex + 1);
  };

  return (
    <Modal visible animationType="fade" transparent={false} onRequestClose={onClose}>
      <SafeAreaView style={styles.container}>
        {/* Top Navigation Bar */}
        <View style={[styles.topBar, !showControls && styles.hidden]}>
          <TouchableOpacity style={styles.iconButton} onPress={onClose}>
            <Text style={styles.iconText}>✕</Text>
          </TouchableOpacity>

          <Text style={styles.counterText}>
            {currentIndex + 1} of {items.length}
          </Text>

          <View style={styles.topRight}>
            {onToggleFavorite && (
              <TouchableOpacity
                style={styles.iconButton}
                onPress={() => onToggleFavorite(activeItem.id)}
              >
                <Text style={styles.iconText}>{activeItem.isFavorite ? '★' : '☆'}</Text>
              </TouchableOpacity>
            )}

            {isVideo && (
              <TouchableOpacity style={styles.speedButton} onPress={cycleSpeed}>
                <Text style={styles.speedText}>{playbackRate}x</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Media Stage */}
        <TouchableWithoutFeedback onPress={handleTap}>
          <View style={styles.stage}>
            {!isVideo ? (
              <Image
                source={{ uri: getMediaStreamUrl(activeItem.id) }}
                style={styles.fullImage}
                resizeMode="contain"
              />
            ) : (
              <View style={styles.videoPlaceholder}>
                <View style={styles.videoPlayCircle}>
                  <Text style={styles.videoPlayTriangle}>▶</Text>
                </View>
                <Text style={styles.videoNoticeTitle}>Streaming Video</Text>
                <Text style={styles.videoNoticeSub}>
                  {getMediaStreamUrl(activeItem.id).split('?')[0]}
                </Text>
              </View>
            )}

            {/* Skip Feedback Overlay */}
            {skipFeedback && (
              <View
                style={[
                  styles.skipOverlay,
                  skipFeedback === '+10s' ? styles.skipRight : styles.skipLeft,
                ]}
              >
                <Text style={styles.skipText}>{skipFeedback}</Text>
              </View>
            )}

            {/* Side Navigation Arrows */}
            {currentIndex > 0 && showControls && (
              <TouchableOpacity style={[styles.navArrow, styles.leftArrow]} onPress={handlePrev}>
                <Text style={styles.arrowText}>‹</Text>
              </TouchableOpacity>
            )}

            {currentIndex < items.length - 1 && showControls && (
              <TouchableOpacity style={[styles.navArrow, styles.rightArrow]} onPress={handleNext}>
                <Text style={styles.arrowText}>›</Text>
              </TouchableOpacity>
            )}
          </View>
        </TouchableWithoutFeedback>

        {/* Bottom Video Controls Bar */}
        {isVideo && (
          <View style={[styles.bottomBar, !showControls && styles.hidden]}>
            <TouchableOpacity
              style={styles.playPauseBtn}
              onPress={() => setIsPlaying(!isPlaying)}
            >
              <Text style={styles.playPauseText}>{isPlaying ? '⏸' : '▶'}</Text>
            </TouchableOpacity>

            <View style={styles.scrubberContainer}>
              <View style={styles.scrubberTrack}>
                <View style={[styles.scrubberFill, { width: '45%' }]} />
              </View>
              <Text style={styles.timeText}>01:15 / 02:40</Text>
            </View>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  topBar: {
    height: 56,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  hidden: {
    opacity: 0,
  },
  topRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconButton: {
    padding: 8,
  },
  iconText: {
    color: '#ffffff',
    fontSize: 20,
  },
  counterText: {
    color: '#94a3b8',
    fontSize: 13,
  },
  speedButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  speedText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  stage: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  fullImage: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT * 0.75,
  },
  videoPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  videoPlayCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  videoPlayTriangle: {
    color: '#ffffff',
    fontSize: 24,
    marginLeft: 3,
  },
  videoNoticeTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
  },
  videoNoticeSub: {
    color: '#64748b',
    fontSize: 11,
    marginTop: 4,
  },
  skipOverlay: {
    position: 'absolute',
    top: '40%',
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 30,
  },
  skipLeft: {
    left: 40,
  },
  skipRight: {
    right: 40,
  },
  skipText: {
    color: '#3b82f6',
    fontSize: 18,
    fontWeight: '800',
  },
  navArrow: {
    position: 'absolute',
    top: '45%',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  leftArrow: {
    left: 16,
  },
  rightArrow: {
    right: 16,
  },
  arrowText: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: '300',
    marginTop: -2,
  },
  bottomBar: {
    height: 64,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    zIndex: 20,
  },
  playPauseBtn: {
    padding: 10,
    marginRight: 12,
  },
  playPauseText: {
    color: '#ffffff',
    fontSize: 20,
  },
  scrubberContainer: {
    flex: 1,
  },
  scrubberTrack: {
    height: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  scrubberFill: {
    height: '100%',
    backgroundColor: '#2563eb',
  },
  timeText: {
    color: '#94a3b8',
    fontSize: 11,
    marginTop: 6,
  },
});
