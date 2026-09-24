import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  Modal,
  ActivityIndicator,
  StatusBar,
  FlatList,
  Platform,
  PanResponder,
  Animated,
  Easing,
  GestureResponderEvent,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
  Maximize2,
  Minimize2,
} from 'lucide-react-native';
import { getMediaStreamUrl, getMediaThumbnailUrl, getAuthImageHeaders } from '../services/api';
import { MediaItemData } from '../components/MediaCard';
import { NativeBackgroundService } from '../services/backup/nativeBackgroundService';
import { videoPrefetchService } from '../services/videoPrefetchService';
import { StreamingStrategyRouter, VideoStreamSource } from '../services/streaming';

interface MediaViewerSlideProps {
  item: MediaItemData;
  windowWidth: number;
  windowHeight: number;
  isCurrent: boolean;
  isPlaying: boolean;
  isMuted: boolean;
  playbackRate: number;
  isBuffering: boolean;
  videoRef?: React.RefObject<VideoRef | null>;
  onTap: (evt: GestureResponderEvent, isVideo: boolean) => void;
  onLoad: (data: any) => void;
  onProgress: (data: any) => void;
  onBuffer: (e: { isBuffering: boolean }) => void;
  onEnd: () => void;
  onError: (err: any) => void;
}

const MediaViewerSlide = React.memo(
  function MediaViewerSlideComponent({
    item,
    windowWidth,
    windowHeight,
    isCurrent,
    isPlaying,
    isMuted,
    playbackRate,
    isBuffering,
    videoRef,
    onTap,
    onLoad,
    onProgress,
    onBuffer,
    onEnd,
    onError,
  }: MediaViewerSlideProps) {
    const isVideo = item.fileType === 'video';
    const [videoSource, setVideoSource] = useState<VideoStreamSource | null>(null);

    useEffect(() => {
      if (!isCurrent || !isVideo) return;
      let isMounted = true;

      StreamingStrategyRouter.resolveVideoSourceAsync(item)
        .then((src) => {
          if (isMounted) {
            console.log(`[MediaViewer] 🎬 Loading video player for #${item.id} -> ${src.uri} (${src.isDirect ? 'Direct MTProto/Local' : 'Cloudflare Edge'})`);
            setVideoSource(src);
          }
        })
        .catch((err) => {
          console.warn('[MediaViewerSlide] Direct stream resolution error:', err);
          if (isMounted) {
            const fallback = StreamingStrategyRouter.getCloudflareStreamSource(item.id);
            console.log(`[MediaViewer] ⚡ Fallback video player for #${item.id} -> ${fallback.uri}`);
            setVideoSource(fallback);
          }
        });

      return () => {
        isMounted = false;
      };
    }, [isCurrent, isVideo, item]);

    if (!isVideo) {
      return (
        <View style={[styles.slide, { width: windowWidth, height: windowHeight }]}>
          <Image
            source={{
              uri: getMediaStreamUrl(item.id),
              headers: getAuthImageHeaders(),
            }}
            style={[styles.fullImage, { width: windowWidth, height: windowHeight }]}
            resizeMode="contain"
          />
          <Pressable
            style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0, 0, 0, 0.001)' }]}
            onPress={(e) => onTap(e, false)}
          />
        </View>
      );
    }

    if (!isCurrent) {
      return (
        <View style={[styles.slide, { width: windowWidth, height: windowHeight }]}>
          <Image
            source={{
              uri: getMediaThumbnailUrl(item.id),
              headers: getAuthImageHeaders(),
            }}
            style={[styles.fullImage, { width: windowWidth, height: windowHeight }]}
            resizeMode="contain"
          />
          <View style={styles.centerPlayButton} pointerEvents="none">
            <Play size={34} color="#FFFFFF" fill="#FFFFFF" style={{ marginLeft: 3 }} />
          </View>
          <Pressable
            style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0, 0, 0, 0.001)' }]}
            onPress={(e) => onTap(e, true)}
          />
        </View>
      );
    }

    if (!videoSource) {
      return (
        <View style={[styles.slide, { width: windowWidth, height: windowHeight }]}>
          <Image
            source={{
              uri: getMediaThumbnailUrl(item.id),
              headers: getAuthImageHeaders(),
            }}
            style={[styles.fullImage, { width: windowWidth, height: windowHeight }]}
            resizeMode="contain"
          />
          <View style={styles.centerSpinnerOverlay} pointerEvents="none">
            <ActivityIndicator size="large" color="#3B82F6" />
          </View>
        </View>
      );
    }

    return (
      <View style={[styles.slide, { width: windowWidth, height: windowHeight }]}>
        <Video
          ref={videoRef as any}
          source={{
            uri: videoSource.uri,
            headers: videoSource.headers,
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
          style={[styles.fullVideo, { width: windowWidth, height: windowHeight }]}
          resizeMode="contain"
          paused={!isPlaying}
          muted={isMuted}
          rate={playbackRate}
          poster={getMediaThumbnailUrl(item.id)}
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
          onLoad={onLoad}
          onProgress={onProgress}
          onBuffer={onBuffer}
          onEnd={onEnd}
          onError={onError}
          playInBackground={false}
        />

        {isBuffering && (
          <View style={styles.centerSpinnerOverlay} pointerEvents="none">
            <ActivityIndicator size="large" color="#3B82F6" />
          </View>
        )}

        {/* Full slide touch overlay sitting directly on top of native Video view */}
        <Pressable
          style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0, 0, 0, 0.001)' }]}
          onPress={(e) => onTap(e, true)}
        />
      </View>
    );
  },
  (prev, next) => {
    return (
      prev.item.id === next.item.id &&
      prev.windowWidth === next.windowWidth &&
      prev.windowHeight === next.windowHeight &&
      prev.isCurrent === next.isCurrent &&
      prev.isPlaying === next.isPlaying &&
      prev.isMuted === next.isMuted &&
      prev.playbackRate === next.playbackRate &&
      prev.isBuffering === next.isBuffering
    );
  }
);

interface MediaViewerScreenProps {
  item: MediaItemData | null;
  items: MediaItemData[];
  onClose: () => void;
  onToggleFavorite?: (id: string) => void;
}

export function MediaViewerScreen({ item, items, onClose, onToggleFavorite }: MediaViewerScreenProps) {
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const isLandscape = windowWidth > windowHeight;

  const initialIdx = item ? items.findIndex((i) => i.id === item.id) : 0;
  const [currentIndex, setCurrentIndex] = useState(initialIdx >= 0 ? initialIdx : 0);
  const activeItem = items[currentIndex] || item;

  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(activeItem?.durationSeconds || 0);
  const [isBuffering, setIsBuffering] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [showControls, setShowControls] = useState(true);
  const [skipFeedback, setSkipFeedback] = useState<'+10s' | '-10s' | null>(null);

  const flatListRef = useRef<FlatList<MediaItemData>>(null);
  const videoRef = useRef<VideoRef | null>(null);
  const scrubberWidthRef = useRef<number>(windowWidth - 48);
  const durationRef = useRef<number>(activeItem?.durationSeconds || 0);
  const lastTapRef = useRef<{ time: number; x: number }>({ time: 0, x: 0 });

  // Orientation lifecycle: unlock orientation while viewing media, restore portrait on close
  useEffect(() => {
    NativeBackgroundService.unlockOrientation();
    return () => {
      NativeBackgroundService.lockToPortrait();
    };
  }, []);

  // When window width changes (rotation between portrait and landscape), re-align flatlist
  const isInitialMount = useRef(true);
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    flatListRef.current?.scrollToIndex({ index: currentIndex, animated: false });
  }, [windowWidth, currentIndex]);

  const toggleOrientation = useCallback(() => {
    if (isLandscape) {
      NativeBackgroundService.lockToPortrait();
    } else {
      NativeBackgroundService.lockToLandscape();
    }
  }, [isLandscape]);

  // Smooth 2D swipe-down to dismiss gesture animation
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const isDismissingRef = useRef(false);

  const isVideo = activeItem.fileType === 'video';

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        // Instant capture when dragging downwards and vertical movement dominates
        return (
          gestureState.dy > 5 &&
          Math.abs(gestureState.dy) > Math.abs(gestureState.dx) * 1.15
        );
      },
      onMoveShouldSetPanResponderCapture: (_, gestureState) => {
        return (
          gestureState.dy > 5 &&
          Math.abs(gestureState.dy) > Math.abs(gestureState.dx) * 1.15
        );
      },
      onPanResponderGrant: () => {
        translateY.setValue(0);
        translateX.setValue(0);
      },
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dy > 0) {
          translateY.setValue(gestureState.dy);
        } else {
          translateY.setValue(gestureState.dy * 0.25);
        }
        translateX.setValue(gestureState.dx * 0.6);
      },
      onPanResponderRelease: (_, gestureState) => {
        // Dismiss if dragged down more than 80px or flicked downwards with velocity
        if (gestureState.dy > 80 || gestureState.vy > 0.4) {
          isDismissingRef.current = true;
          Animated.parallel([
            Animated.timing(translateY, {
              toValue: windowHeight * 1.15,
              duration: 180,
              easing: Easing.out(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.timing(translateX, {
              toValue: gestureState.dx * 1.4,
              duration: 180,
              easing: Easing.out(Easing.quad),
              useNativeDriver: true,
            }),
          ]).start(() => {
            onClose();
          });
        } else {
          // Snappy spring back to full screen
          Animated.parallel([
            Animated.spring(translateY, {
              toValue: 0,
              damping: 18,
              mass: 0.5,
              stiffness: 240,
              useNativeDriver: true,
            }),
            Animated.spring(translateX, {
              toValue: 0,
              damping: 18,
              mass: 0.5,
              stiffness: 240,
              useNativeDriver: true,
            }),
          ]).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.parallel([
          Animated.spring(translateY, {
            toValue: 0,
            damping: 18,
            mass: 0.5,
            stiffness: 240,
            useNativeDriver: true,
          }),
          Animated.spring(translateX, {
            toValue: 0,
            damping: 18,
            mass: 0.5,
            stiffness: 240,
            useNativeDriver: true,
          }),
        ]).start();
      },
    })
  ).current;

  // Ultra-smooth native interpolations
  const rotate = translateX.interpolate({
    inputRange: [-windowWidth, windowWidth],
    outputRange: ['-10deg', '10deg'],
    extrapolate: 'clamp',
  });

  const backdropOpacity = translateY.interpolate({
    inputRange: [0, 200],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  const mediaScale = translateY.interpolate({
    inputRange: [0, 280],
    outputRange: [1, 0.76],
    extrapolate: 'clamp',
  });

  const controlsCombinedOpacity = translateY.interpolate({
    inputRange: [0, 50],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  useEffect(() => {
    durationRef.current = activeItem?.durationSeconds || 0;
    setDuration(activeItem?.durationSeconds || 0);
    setCurrentTime(0);
    setIsPlaying(true);
    setIsBuffering(false);

    if (isVideo && activeItem?.fileSizeBytes) {
      videoPrefetchService.prefetchInitialChunks(activeItem.id, activeItem.fileSizeBytes);
    }

    return () => {
      videoPrefetchService.cancelAll();
    };
  }, [currentIndex, activeItem?.id, isVideo, activeItem?.fileSizeBytes, activeItem?.durationSeconds]);

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

  const triggerSkip = useCallback((type: '+10s' | '-10s') => {
    setSkipFeedback(type);
    setTimeout(() => setSkipFeedback(null), 700);
  }, []);

  const handleSkip = useCallback((seconds: number) => {
    setCurrentTime((curr) => {
      const maxDur = durationRef.current || 999999;
      const nextTime = Math.max(0, Math.min(maxDur, curr + seconds));
      videoRef.current?.seek(nextTime);
      return nextTime;
    });
    triggerSkip(seconds > 0 ? '+10s' : '-10s');
    setShowControls(true);
  }, [triggerSkip]);

  const handleTap = useCallback((evt: GestureResponderEvent, isVideoItem: boolean) => {
    const now = Date.now();
    const pageX = evt.nativeEvent.pageX ?? evt.nativeEvent.locationX ?? windowWidth / 2;
    const timeSinceLastTap = now - lastTapRef.current.time;
    const DOUBLE_TAP_DELAY = 280;

    if (isVideoItem && timeSinceLastTap > 0 && timeSinceLastTap < DOUBLE_TAP_DELAY) {
      lastTapRef.current = { time: 0, x: 0 };
      if (pageX > windowWidth / 2) {
        handleSkip(10);
      } else {
        handleSkip(-10);
      }
      setShowControls(true);
    } else {
      lastTapRef.current = { time: now, x: pageX };
      setShowControls((prev) => !prev);
    }
  }, [handleSkip, windowWidth]);

  const cycleSpeed = () => {
    const speeds = [1.0, 1.25, 1.5, 2.0];
    const nextIdx = (speeds.indexOf(playbackRate) + 1) % speeds.length;
    setPlaybackRate(speeds[nextIdx]);
    setShowControls(true);
  };

  const handleScrubberPress = (evt: any) => {
    const dur = durationRef.current;
    if (!dur || dur <= 0) return;
    const clickX = evt.nativeEvent.locationX;
    const totalW = scrubberWidthRef.current || (windowWidth - (isLandscape ? 64 : 48));
    const progressFraction = Math.max(0, Math.min(1, clickX / totalW));
    const targetTime = progressFraction * dur;
    setCurrentTime(targetTime);
    videoRef.current?.seek(targetTime);
    setShowControls(true);
  };

  const handleMomentumScrollEnd = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetX = e.nativeEvent.contentOffset.x;
    const nextIdx = Math.round(offsetX / windowWidth);
    if (nextIdx >= 0 && nextIdx < items.length) {
      setCurrentIndex(nextIdx);
    }
  }, [items.length, windowWidth]);

  const handleVideoLoad = useCallback((data: any) => {
    if (data.duration && data.duration > 0) {
      setDuration(data.duration);
      durationRef.current = data.duration;
    }
  }, []);

  const handleVideoProgress = useCallback((data: any) => {
    setCurrentTime(data.currentTime);
    const dur = data.seekableDuration || durationRef.current || activeItem.durationSeconds || 0;
    if (dur > 0 && activeItem.fileSizeBytes) {
      videoPrefetchService.updatePlaybackProgress(
        activeItem.id,
        data.currentTime,
        dur,
        activeItem.fileSizeBytes
      );
    }
  }, [activeItem.id, activeItem.durationSeconds, activeItem.fileSizeBytes]);

  const handleVideoBuffer = useCallback(({ isBuffering: buffering }: { isBuffering: boolean }) => {
    setIsBuffering(buffering);
  }, []);

  const handleVideoEnd = useCallback(() => {
    setIsPlaying(false);
    videoRef.current?.seek(0);
    setCurrentTime(0);
    setShowControls(true);
  }, []);

  const handleVideoError = useCallback((err: any) => {
    console.warn('[MediaViewerScreen] Video playback error:', err);
  }, []);

  const renderSlideItem = useCallback(
    ({ item: slideItem, index }: { item: MediaItemData; index: number }) => {
      const isCurrent = index === currentIndex;
      return (
        <MediaViewerSlide
          item={slideItem}
          windowWidth={windowWidth}
          windowHeight={windowHeight}
          isCurrent={isCurrent}
          isPlaying={isPlaying}
          isMuted={isMuted}
          playbackRate={playbackRate}
          isBuffering={isBuffering}
          videoRef={isCurrent ? videoRef : undefined}
          onTap={handleTap}
          onLoad={handleVideoLoad}
          onProgress={handleVideoProgress}
          onBuffer={handleVideoBuffer}
          onEnd={handleVideoEnd}
          onError={handleVideoError}
        />
      );
    },
    [
      currentIndex,
      windowWidth,
      windowHeight,
      isPlaying,
      isMuted,
      playbackRate,
      isBuffering,
      handleTap,
      handleVideoLoad,
      handleVideoProgress,
      handleVideoBuffer,
      handleVideoEnd,
      handleVideoError,
    ]
  );

  const progressPercent = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;

  if (!item || !activeItem) return null;

  return (
    <Modal
      visible
      animationType="none"
      transparent={true}
      statusBarTranslucent={true}
      onRequestClose={onClose}
    >
      <StatusBar barStyle="light-content" />
      <View style={styles.container}>
        {/* Fading Dark Backdrop revealing Gallery underneath on drag */}
        <Animated.View
          style={[
            styles.backdrop,
            { opacity: backdropOpacity },
          ]}
        />

        {/* Media Carousel Container with Gesture Handlers & Smooth Transforms */}
        <Animated.View
          style={[
            styles.mediaContainer,
            {
              width: windowWidth,
              height: windowHeight,
              transform: [
                { translateY },
                { translateX },
                { scale: mediaScale },
                { rotate },
              ],
            },
          ]}
          {...panResponder.panHandlers}
        >
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
              length: windowWidth,
              offset: windowWidth * index,
              index,
            })}
            onScrollToIndexFailed={(info) => {
              setTimeout(() => {
                flatListRef.current?.scrollToIndex({ index: info.index, animated: false });
              }, 50);
            }}
            onMomentumScrollEnd={handleMomentumScrollEnd}
            renderItem={renderSlideItem}
            windowSize={3}
            maxToRenderPerBatch={2}
            initialNumToRender={2}
            removeClippedSubviews={Platform.OS === 'android'}
          />
        </Animated.View>

        {/* Center Play Button when Paused & Controls Visible */}
        {isVideo && !isPlaying && showControls && (
          <Animated.View
            style={[
              styles.centerPlayWrapper,
              {
                opacity: controlsCombinedOpacity,
                transform: [
                  { translateY },
                  { translateX },
                  { scale: mediaScale },
                  { rotate },
                ],
              },
            ]}
            pointerEvents="box-none"
          >
            <TouchableOpacity
              style={styles.centerPlayButton}
              activeOpacity={0.85}
              onPress={() => setIsPlaying(true)}
            >
              <Play size={34} color="#FFFFFF" fill="#FFFFFF" style={{ marginLeft: 3 }} />
            </TouchableOpacity>
          </Animated.View>
        )}

        {/* Top Navigation Bar */}
        <Animated.View
          pointerEvents={showControls ? 'box-none' : 'none'}
          style={[
            styles.topBarContainer,
            {
              paddingTop: insets.top + (isLandscape ? 6 : 8),
              paddingLeft: insets.left + 16,
              paddingRight: insets.right + 16,
              opacity: showControls ? controlsCombinedOpacity : 0,
            },
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
        </Animated.View>

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
          <Animated.View
            pointerEvents={showControls ? 'box-none' : 'none'}
            style={[
              styles.bottomBarContainer,
              {
                paddingBottom: insets.bottom + (isLandscape ? 10 : 16),
                paddingLeft: insets.left + 20,
                paddingRight: insets.right + 20,
                opacity: showControls ? controlsCombinedOpacity : 0,
              },
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

            {/* Bottom Action Controls Row */}
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

              <View style={styles.controlsRight}>
                {/* Speed Rate Pill (Right) */}
                <TouchableOpacity
                  style={styles.speedPill}
                  activeOpacity={0.75}
                  onPress={cycleSpeed}
                >
                  <Text style={styles.speedPillText}>{playbackRate}x</Text>
                </TouchableOpacity>

                {/* Fullscreen / Landscape Toggle Button */}
                <TouchableOpacity
                  style={styles.actionIconBtn}
                  activeOpacity={0.7}
                  onPress={toggleOrientation}
                >
                  {isLandscape ? (
                    <Minimize2 size={19} color="#CBD5E1" strokeWidth={2} />
                  ) : (
                    <Maximize2 size={19} color="#CBD5E1" strokeWidth={2} />
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </Animated.View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#000000',
  },
  mediaContainer: {
    flex: 1,
  },
  topBarContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 50,
    elevation: 50,
    paddingHorizontal: 16,
    paddingBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
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
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
    position: 'relative',
  },
  fullImage: {
    width: '100%',
    height: '100%',
  },
  fullVideo: {
    width: '100%',
    height: '100%',
  },
  centerSpinnerOverlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    alignItems: 'center',
  },
  centerPlayWrapper: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 30,
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
    zIndex: 40,
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
    zIndex: 50,
    elevation: 50,
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
  controlsRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
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
});
