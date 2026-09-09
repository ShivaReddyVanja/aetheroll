import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Modal,
  TouchableWithoutFeedback,
  ActivityIndicator,
  StatusBar,
  FlatList,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Video, { VideoRef } from 'react-native-video';
import {
  X,
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
  Star,
  ExternalLink,
  Activity,
} from 'lucide-react-native';
import { getMediaStreamUrl, getMediaThumbnailUrl, getSessionToken } from '../services/api';
import { MediaItemData } from '../components/MediaCard';
import { NativeBackgroundService } from '../services/backup/nativeBackgroundService';
import { telemetryService } from '../services/telemetryService';
import { videoPrefetchService } from '../services/videoPrefetchService';
import { StreamTelemetryModal } from '../components/StreamTelemetryModal';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface MediaViewerScreenProps {
  item: MediaItemData | null;
  items: MediaItemData[];
  onClose: () => void;
  onToggleFavorite?: (id: string) => void;
}

export function MediaViewerScreen({ item, items, onClose, onToggleFavorite }: MediaViewerScreenProps) {
  if (!item) return null;

  const insets = useSafeAreaInsets();
  const initialIdx = items.findIndex((i) => i.id === item.id);
  const [currentIndex, setCurrentIndex] = useState(initialIdx >= 0 ? initialIdx : 0);
  const activeItem = items[currentIndex] || item;

  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(activeItem.durationSeconds || 0);
  const [isBuffering, setIsBuffering] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [showControls, setShowControls] = useState(true);
  const [skipFeedback, setSkipFeedback] = useState<'+10s' | '-10s' | null>(null);

  const [showTelemetryModal, setShowTelemetryModal] = useState(false);
  const [streamDiagnosticPill, setStreamDiagnosticPill] = useState<string | null>(null);

  const flatListRef = useRef<FlatList<MediaItemData>>(null);
  const videoRef = useRef<VideoRef>(null);
  const scrubberWidthRef = useRef<number>(SCREEN_WIDTH - 48);
  const lastTapRef = useRef<number>(0);
  const tapTimerRef = useRef<any>(null);

  const isVideo = activeItem.fileType === 'video';

  useEffect(() => {
    setCurrentTime(0);
    setDuration(activeItem.durationSeconds || 0);
    setIsPlaying(true);
    setIsBuffering(false);

    let isMounted = true;
    setStreamDiagnosticPill('Probing Edge Stream...');
    telemetryService.connectToRemoteStream();

    telemetryService.addLog({
      category: 'STREAM',
      level: 'info',
      message: `📱 [Mobile App] Stream requested for ${activeItem.id.slice(0, 8)}... (${isVideo ? 'Video' : 'Photo'})`,
      meta: { mediaId: activeItem.id, isVideo, size: activeItem.fileSizeBytes },
    });

    telemetryService.probeStream(activeItem.id, 'bytes=0-1024').then((res) => {
      if (!isMounted) return;
      if (res.success) {
        const cacheTag = res.edgeCache === 'HIT' ? 'HIT ⚡ 2ms' : '206 OK';
        setStreamDiagnosticPill(`${res.status} • ${cacheTag} (${res.latencyMs}ms)`);
      } else {
        setStreamDiagnosticPill(`Stream Err ${res.status || 'Net'}`);
      }
    });

    if (isVideo && activeItem.fileSizeBytes) {
      videoPrefetchService.prefetchInitialChunks(activeItem.id, activeItem.fileSizeBytes);
    }

    return () => {
      isMounted = false;
      videoPrefetchService.cancelAll();
    };
  }, [currentIndex, activeItem.id]);

  useEffect(() => {
    return () => {
      telemetryService.disconnectRemoteStream();
    };
  }, []);

  // Auto-hide controls after 4 seconds when playing
  useEffect(() => {
    if (isPlaying && showControls && isVideo) {
      const timer = setTimeout(() => {
        setShowControls(false);
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [isPlaying, showControls, isVideo]);

  const formatDuration = (sec?: number) => {
    if (!sec || sec <= 0) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const handleSkip = (seconds: number) => {
    const nextTime = Math.max(0, Math.min(duration || 999999, currentTime + seconds));
    setCurrentTime(nextTime);
    videoRef.current?.seek(nextTime);
    triggerSkip(seconds > 0 ? '+10s' : '-10s');
    setShowControls(true);
  };

  const handleTap = (evt: any) => {
    const now = Date.now();
    const DOUBLE_TAP_DELAY = 300;
    const touchX = evt.nativeEvent.locationX;

    if (now - lastTapRef.current < DOUBLE_TAP_DELAY) {
      if (tapTimerRef.current) clearTimeout(tapTimerRef.current);

      if (touchX > SCREEN_WIDTH / 2) {
        handleSkip(10);
      } else {
        handleSkip(-10);
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
    setShowControls(true);
  };

  const handleScrubberPress = (evt: any) => {
    if (!duration || duration <= 0) return;
    const clickX = evt.nativeEvent.locationX;
    const totalW = scrubberWidthRef.current || (SCREEN_WIDTH - 48);
    const progressFraction = Math.max(0, Math.min(1, clickX / totalW));
    const targetTime = progressFraction * duration;
    setCurrentTime(targetTime);
    videoRef.current?.seek(targetTime);
    setShowControls(true);
  };

  const handleMomentumScrollEnd = (e: any) => {
    const offsetX = e.nativeEvent.contentOffset.x;
    const nextIdx = Math.round(offsetX / SCREEN_WIDTH);
    if (nextIdx !== currentIndex && nextIdx >= 0 && nextIdx < items.length) {
      setCurrentIndex(nextIdx);
    }
  };

  const renderSlide = useCallback(
    ({ item: slideItem, index }: { item: MediaItemData; index: number }) => {
      const isCurrent = index === currentIndex;
      const slideIsVideo = slideItem.fileType === 'video';

      return (
        <TouchableWithoutFeedback onPress={handleTap}>
          <View style={styles.slide}>
            {!slideIsVideo ? (
              <Image
                source={{ uri: getMediaStreamUrl(slideItem.id) }}
                style={styles.fullImage}
                resizeMode="contain"
              />
            ) : isCurrent ? (
              <View style={styles.videoWrapper}>
                <Video
                  ref={videoRef}
                  source={{
                    uri: getMediaStreamUrl(slideItem.id),
                    headers: getSessionToken()
                      ? {
                          Authorization: `Bearer ${getSessionToken()}`,
                          'x-tg-session': getSessionToken()!,
                        }
                      : undefined,
                    bufferConfig: {
                      minBufferMs: 25000,
                      maxBufferMs: 60000,
                      bufferForPlaybackMs: 1500,
                      bufferForPlaybackAfterRebufferMs: 3000,
                      backBufferDurationMs: 30000,
                      maxHeapAllocationPercent: 0.8,
                      minBackBufferMemoryReservePercent: 0.1,
                      minBufferMemoryReservePercent: 0.2,
                    },
                  }}
                  style={styles.fullVideo}
                  resizeMode="contain"
                  paused={!isPlaying}
                  muted={isMuted}
                  rate={playbackRate}
                  poster={getMediaThumbnailUrl(slideItem.id)}
                  bufferConfig={{
                    minBufferMs: 25000,
                    maxBufferMs: 60000,
                    bufferForPlaybackMs: 1500,
                    bufferForPlaybackAfterRebufferMs: 3000,
                    backBufferDurationMs: 30000,
                    maxHeapAllocationPercent: 0.8,
                    minBackBufferMemoryReservePercent: 0.1,
                    minBufferMemoryReservePercent: 0.2,
                  }}
                  preferredForwardBufferDuration={30}
                  automaticallyWaitsToMinimizeStalling={true}
                  onLoad={(data) => {
                    if (data.duration && data.duration > 0) {
                      setDuration(data.duration);
                    }
                    telemetryService.addLog({
                      category: 'EXOPLAYER',
                      level: 'success',
                      message: `🎬 [ExoPlayer Load] Duration: ${data.duration?.toFixed(1)}s, Res: ${data.naturalSize?.width || '?'}x${data.naturalSize?.height || '?'}`,
                      meta: data,
                    });
                  }}
                  onProgress={(data) => {
                    setCurrentTime(data.currentTime);
                    const dur = data.seekableDuration || duration || slideItem.durationSeconds || 0;
                    if (dur > 0 && slideItem.fileSizeBytes) {
                      videoPrefetchService.updatePlaybackProgress(
                        slideItem.id,
                        data.currentTime,
                        dur,
                        slideItem.fileSizeBytes
                      );
                    }
                  }}
                  onBuffer={({ isBuffering: buffering }) => {
                    setIsBuffering(buffering);
                    telemetryService.addLog({
                      category: 'EXOPLAYER',
                      level: buffering ? 'warn' : 'info',
                      message: buffering ? '⏳ [ExoPlayer] Buffering edge stream chunk...' : '▶ [ExoPlayer] Buffer ready, playing',
                    });
                  }}
                  onEnd={() => {
                    setIsPlaying(false);
                    videoRef.current?.seek(0);
                    setCurrentTime(0);
                    setShowControls(true);
                  }}
                  onError={(err) => {
                    console.warn('[MediaViewerScreen] Video playback error:', err);
                    telemetryService.addLog({
                      category: 'ERROR',
                      level: 'error',
                      message: `❌ [ExoPlayer Error] ${JSON.stringify(err)}`,
                      meta: err,
                    });
                  }}
                  playInBackground={false}
                />

                {isBuffering && (
                  <View style={styles.centerSpinnerOverlay} pointerEvents="none">
                    <ActivityIndicator size="large" color="#3B82F6" />
                  </View>
                )}

                {/* Center Play Button when Paused */}
                {!isPlaying && showControls && (
                  <TouchableOpacity
                    style={styles.centerPlayButton}
                    activeOpacity={0.85}
                    onPress={() => setIsPlaying(true)}
                  >
                    <Play size={34} color="#FFFFFF" fill="#FFFFFF" style={{ marginLeft: 3 }} />
                  </TouchableOpacity>
                )}
              </View>
            ) : (
              <View style={styles.videoWrapper}>
                <Image
                  source={{ uri: getMediaThumbnailUrl(slideItem.id) }}
                  style={styles.fullImage}
                  resizeMode="contain"
                />
                <View style={styles.centerPlayButton} pointerEvents="none">
                  <Play size={34} color="#FFFFFF" fill="#FFFFFF" style={{ marginLeft: 3 }} />
                </View>
              </View>
            )}
          </View>
        </TouchableWithoutFeedback>
      );
    },
    [currentIndex, isPlaying, isMuted, playbackRate, isBuffering, showControls, duration]
  );

  const progressPercent = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;

  return (
    <Modal visible animationType="fade" transparent={false} onRequestClose={onClose}>
      <StatusBar barStyle="light-content" />
      <View style={styles.container}>
        {/* Top Navigation Bar with Gradient Vignette */}
        <View
          style={[
            styles.topBarContainer,
            { paddingTop: insets.top + 8 },
            !showControls && styles.hidden,
          ]}
        >
          <TouchableOpacity
            style={styles.frostedIconButton}
            activeOpacity={0.7}
            onPress={onClose}
          >
            <X size={20} color="#FFFFFF" strokeWidth={2.2} />
          </TouchableOpacity>

          <View style={styles.counterPill}>
            <Text style={styles.counterText}>
              {currentIndex + 1} / {items.length}
            </Text>
          </View>

          <View style={styles.topRight}>
            {/* Live Stream Telemetry HUD Button */}
            <TouchableOpacity
              style={styles.frostedIconButton}
              activeOpacity={0.7}
              onPress={() => setShowTelemetryModal(true)}
            >
              <Activity size={18} color="#38BDF8" strokeWidth={2.2} />
            </TouchableOpacity>

            {onToggleFavorite && (
              <TouchableOpacity
                style={styles.frostedIconButton}
                activeOpacity={0.7}
                onPress={() => onToggleFavorite(activeItem.id)}
              >
                <Star
                  size={19}
                  color={activeItem.isFavorite ? '#FBBF24' : '#FFFFFF'}
                  fill={activeItem.isFavorite ? '#FBBF24' : 'transparent'}
                  strokeWidth={2}
                />
              </TouchableOpacity>
            )}

            {isVideo && (
              <TouchableOpacity
                style={styles.frostedIconButton}
                activeOpacity={0.7}
                onPress={() =>
                  NativeBackgroundService.openVideoPlayer(
                    getMediaStreamUrl(activeItem.id),
                    `Video ${activeItem.id}`
                  )
                }
              >
                <ExternalLink size={18} color="#FFFFFF" strokeWidth={2.2} />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Floating Stream Diagnostic Pill */}
        {streamDiagnosticPill && (
          <TouchableOpacity
            style={[
              styles.streamDiagnosticPill,
              { top: insets.top + 60 },
              !showControls && styles.hidden,
            ]}
            activeOpacity={0.8}
            onPress={() => setShowTelemetryModal(true)}
          >
            <View style={styles.telemetryPulseDot} />
            <Text style={styles.streamDiagnosticText}>{streamDiagnosticPill}</Text>
            <Activity size={12} color="#38BDF8" strokeWidth={2.2} />
          </TouchableOpacity>
        )}

        {/* Horizontal Swiping Photo/Video Paging FlatList */}
        <FlatList
          ref={flatListRef}
          data={items}
          keyExtractor={(it) => it.id}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={initialIdx >= 0 ? initialIdx : 0}
          getItemLayout={(_, index) => ({
            length: SCREEN_WIDTH,
            offset: SCREEN_WIDTH * index,
            index,
          })}
          onScrollToIndexFailed={(info) => {
            setTimeout(() => {
              flatListRef.current?.scrollToIndex({ index: info.index, animated: false });
            }, 50);
          }}
          onMomentumScrollEnd={handleMomentumScrollEnd}
          renderItem={renderSlide}
          windowSize={3}
          maxToRenderPerBatch={2}
          removeClippedSubviews={true}
        />

        {/* Skip Feedback Overlay (YouTube Style) */}
        {skipFeedback && (
          <View
            style={[
              styles.skipOverlay,
              skipFeedback === '+10s' ? styles.skipRight : styles.skipLeft,
            ]}
          >
            {skipFeedback === '+10s' ? (
              <RotateCw size={24} color="#60A5FA" strokeWidth={2.2} />
            ) : (
              <RotateCcw size={24} color="#60A5FA" strokeWidth={2.2} />
            )}
            <Text style={styles.skipText}>{skipFeedback}</Text>
          </View>
        )}

        {/* Bottom Video Controls Bar with Scrubber Knob & Controls */}
        {isVideo && (
          <View
            style={[
              styles.bottomBarContainer,
              { paddingBottom: insets.bottom + 16 },
              !showControls && styles.hidden,
            ]}
          >
            {/* Scrubber Row: Time + Interactive Progress Track + Draggable Thumb */}
            <View style={styles.scrubberSection}>
              <View style={styles.timeRow}>
                <Text style={styles.timeTextBold}>{formatDuration(currentTime)}</Text>
                <Text style={styles.timeTextDim}>{formatDuration(duration)}</Text>
              </View>

              <TouchableOpacity
                style={styles.scrubberTouchArea}
                activeOpacity={1}
                onPress={handleScrubberPress}
                onLayout={(e) => {
                  scrubberWidthRef.current = e.nativeEvent.layout.width;
                }}
              >
                <View style={styles.scrubberTrack}>
                  <View style={[styles.scrubberFill, { width: `${progressPercent}%` }]} />
                </View>
                {/* Modern Glowing Thumb Knob */}
                <View
                  style={[
                    styles.scrubberThumb,
                    { left: `${progressPercent}%` },
                  ]}
                />
              </TouchableOpacity>
            </View>

            {/* Bottom Action Controls Row (Google Photos Style) */}
            <View style={styles.controlsRow}>
              <View style={styles.controlsLeft}>
                {/* Play / Pause Pill Button */}
                <TouchableOpacity
                  style={styles.playPauseBtn}
                  activeOpacity={0.8}
                  onPress={() => setIsPlaying(!isPlaying)}
                >
                  {isPlaying ? (
                    <Pause size={20} color="#FFFFFF" fill="#FFFFFF" />
                  ) : (
                    <Play size={20} color="#FFFFFF" fill="#FFFFFF" style={{ marginLeft: 2 }} />
                  )}
                </TouchableOpacity>

                {/* Rewind 10s */}
                <TouchableOpacity
                  style={styles.actionIconBtn}
                  activeOpacity={0.7}
                  onPress={() => handleSkip(-10)}
                >
                  <RotateCcw size={20} color="#CBD5E1" strokeWidth={2} />
                </TouchableOpacity>

                {/* Fast Forward 10s */}
                <TouchableOpacity
                  style={styles.actionIconBtn}
                  activeOpacity={0.7}
                  onPress={() => handleSkip(10)}
                >
                  <RotateCw size={20} color="#CBD5E1" strokeWidth={2} />
                </TouchableOpacity>

                {/* Mute / Unmute Button */}
                <TouchableOpacity
                  style={styles.actionIconBtn}
                  activeOpacity={0.7}
                  onPress={() => setIsMuted(!isMuted)}
                >
                  {isMuted ? (
                    <VolumeX size={20} color="#F87171" strokeWidth={2} />
                  ) : (
                    <Volume2 size={20} color="#CBD5E1" strokeWidth={2} />
                  )}
                </TouchableOpacity>
              </View>

              {/* Speed Rate Pill (Right) */}
              <TouchableOpacity
                style={styles.speedPill}
                activeOpacity={0.75}
                onPress={cycleSpeed}
              >
                <Text style={styles.speedPillText}>{playbackRate}x</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Stream Telemetry & Real-Time Log Modal */}
        <StreamTelemetryModal
          visible={showTelemetryModal}
          onClose={() => setShowTelemetryModal(false)}
          mediaId={activeItem.id}
          isVideo={isVideo}
          playerState={{
            isBuffering,
            isPlaying,
            currentTime,
            duration,
          }}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  topBarContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 30,
    paddingHorizontal: 16,
    paddingBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  hidden: {
    opacity: 0,
  },
  frostedIconButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  counterPill: {
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
  },
  counterText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  topRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  slide: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000000',
  },
  stage: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  fullImage: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
  },
  videoWrapper: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000000',
  },
  fullVideo: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
  },
  centerSpinnerOverlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    alignItems: 'center',
  },
  centerPlayButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'absolute',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 10,
  },
  skipOverlay: {
    position: 'absolute',
    top: '42%',
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  skipLeft: {
    left: 36,
  },
  skipRight: {
    right: 36,
  },
  skipText: {
    color: '#60A5FA',
    fontSize: 15,
    fontWeight: '700',
  },
  bottomBarContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 30,
    paddingHorizontal: 20,
    paddingTop: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
  },
  scrubberSection: {
    width: '100%',
    marginBottom: 12,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  timeTextBold: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  timeTextDim: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '500',
  },
  scrubberTouchArea: {
    height: 28,
    justifyContent: 'center',
    position: 'relative',
  },
  scrubberTrack: {
    height: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  scrubberFill: {
    height: '100%',
    backgroundColor: '#3B82F6',
    borderRadius: 2,
  },
  scrubberThumb: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#FFFFFF',
    position: 'absolute',
    top: 7,
    marginLeft: -7,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 3,
    elevation: 5,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  controlsLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  playPauseBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#2563EB',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 6,
  },
  actionIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  speedPill: {
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  speedPillText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  streamDiagnosticPill: {
    position: 'absolute',
    alignSelf: 'center',
    zIndex: 25,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.35)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  streamDiagnosticText: {
    color: '#E2E8F0',
    fontSize: 11,
    fontFamily: 'monospace',
    fontWeight: '600',
  },
  telemetryPulseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
});
