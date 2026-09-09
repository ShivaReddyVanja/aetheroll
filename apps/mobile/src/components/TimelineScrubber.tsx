import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  PanResponder,
  Animated,
} from 'react-native';

export interface TimelineSection {
  title: string;
  year: string;
  monthYear: string;
  itemCount: number;
}

interface TimelineScrubberProps {
  sections: Array<{ title: string; data: any[] }>;
  scrollProgress: number; // 0 to 1
  isListScrolling: boolean;
  onScrubToSection: (sectionIndex: number, label: string) => void;
}

export function TimelineScrubber({
  sections,
  scrollProgress,
  isListScrolling,
  onScrubToSection,
}: TimelineScrubberProps) {
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [activeDateLabel, setActiveDateLabel] = useState<string>('');
  const [scrubberY, setScrubberY] = useState(0);

  const opacityAnim = useRef(new Animated.Value(0)).current;
  const hideTimerRef = useRef<any>(null);
  const trackHeightRef = useRef<number>(300);
  const trackLayoutRef = useRef<{ top: number; height: number }>({ top: 70, height: 300 });

  // Parse sections to extract unique years & month/year labels
  const timelineData = useMemo(() => {
    const list: TimelineSection[] = [];

    sections.forEach((sec) => {
      let year = '';
      let monthYear = sec.title;

      try {
        const d = new Date(sec.title);
        if (!isNaN(d.getTime())) {
          year = d.getFullYear().toString();
          monthYear = d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
        } else {
          const match = sec.title.match(/\b(20\d{2}|19\d{2})\b/);
          if (match) {
            year = match[1];
            monthYear = sec.title;
          }
        }
      } catch {
        year = '';
      }

      list.push({
        title: sec.title,
        year,
        monthYear,
        itemCount: sec.data?.length || 0,
      });
    });

    return list;
  }, [sections]);

  // Cumulative item starts for accurate timeline mapping
  const { totalItems, sectionStarts } = useMemo(() => {
    let running = 0;
    const starts: number[] = [];
    timelineData.forEach((sec) => {
      starts.push(running);
      running += Math.max(1, sec.itemCount);
    });
    return { totalItems: Math.max(1, running), sectionStarts: starts };
  }, [timelineData]);

  const getSectionIndexAtRatio = (ratio: number) => {
    const clampedRatio = Math.max(0, Math.min(1, ratio));
    const targetItem = Math.min(Math.floor(clampedRatio * totalItems), totalItems - 1);
    for (let i = timelineData.length - 1; i >= 0; i--) {
      if (targetItem >= (sectionStarts[i] || 0)) {
        return i;
      }
    }
    return 0;
  };

  // Unique years with their weighted position fraction along the track
  const uniqueYears = useMemo(() => {
    const map = new Map<string, number>();
    timelineData.forEach((sec, idx) => {
      if (sec.year && !map.has(sec.year)) {
        map.set(sec.year, idx);
      }
    });
    return Array.from(map.entries()).map(([year, sectionIdx]) => {
      const fraction = totalItems > 0 ? (sectionStarts[sectionIdx] || 0) / totalItems : 0;
      return {
        year,
        sectionIdx,
        fraction,
      };
    });
  }, [timelineData, totalItems, sectionStarts]);

  // Fade in / out controls
  const showScrubber = () => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    Animated.timing(opacityAnim, {
      toValue: 1,
      duration: 150,
      useNativeDriver: true,
    }).start();
  };

  const scheduleHide = () => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
    }
    hideTimerRef.current = setTimeout(() => {
      Animated.timing(opacityAnim, {
        toValue: 0,
        duration: 350,
        useNativeDriver: true,
      }).start();
    }, 1200);
  };

  useEffect(() => {
    if (isListScrolling) {
      showScrubber();
    } else if (!isScrubbing) {
      scheduleHide();
    }
  }, [isListScrolling]);

  // Keep activeDateLabel updated during normal scrolling as well
  useEffect(() => {
    if (!isScrubbing && timelineData.length > 0) {
      const idx = getSectionIndexAtRatio(scrollProgress);
      const activeSec = timelineData[idx];
      if (activeSec) {
        setActiveDateLabel(activeSec.monthYear || activeSec.title || '');
      }
    }
  }, [scrollProgress, isScrubbing, timelineData, totalItems]);

  // Map Y touch coordinate to exact section index based on weight
  const handleTouchAtY = (pageY: number) => {
    const trackTop = trackLayoutRef.current.top;
    const trackHeight = trackLayoutRef.current.height;

    if (timelineData.length === 0 || trackHeight <= 0) return;

    const relativeY = Math.max(0, Math.min(pageY - trackTop, trackHeight));
    const ratio = relativeY / trackHeight;
    const targetIdx = getSectionIndexAtRatio(ratio);

    const activeSec = timelineData[targetIdx];
    const label = activeSec?.monthYear || activeSec?.title || '';

    setScrubberY(relativeY);
    setActiveDateLabel(label);
    onScrubToSection(targetIdx, label);
  };

  // PanResponder attached ONLY to the knob handle (not the whole screen or rail)
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (evt) => {
          setIsScrubbing(true);
          showScrubber();
          handleTouchAtY(evt.nativeEvent.pageY);
        },
        onPanResponderMove: (evt) => {
          handleTouchAtY(evt.nativeEvent.pageY);
        },
        onPanResponderRelease: () => {
          setIsScrubbing(false);
          scheduleHide();
        },
        onPanResponderTerminate: () => {
          setIsScrubbing(false);
          scheduleHide();
        },
      }),
    [timelineData, totalItems, sectionStarts, onScrubToSection]
  );

  if (timelineData.length <= 1) {
    return null;
  }

  // Calculate thumb position when not actively scrubbing
  const trackHeight = trackHeightRef.current || 300;
  const effectiveThumbY = isScrubbing
    ? scrubberY
    : Math.max(0, Math.min(scrollProgress * trackHeight, trackHeight));

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.container, { opacity: opacityAnim }]}
    >
      {/* Right Rail Container (Passes touches through to photos) */}
      <View
        pointerEvents="box-none"
        style={styles.railArea}
        onLayout={(e) => {
          const { y, height } = e.nativeEvent.layout;
          trackLayoutRef.current = { top: y || 70, height: height || 300 };
          trackHeightRef.current = height;
        }}
      >
        {/* Subtle Year Markers (Non-interactive) */}
        <View style={styles.yearMarkersContainer} pointerEvents="none">
          {uniqueYears.map(({ year, fraction }) => {
            const topPos = fraction * trackHeight;
            return (
              <View
                key={year}
                style={[
                  styles.yearPill,
                  { top: Math.max(0, Math.min(topPos, trackHeight - 20)) },
                ]}
              >
                <Text style={styles.yearPillText}>{year}</Text>
              </View>
            );
          })}
        </View>

        {/* Draggable Knob & Callout Bubble */}
        <View
          pointerEvents="box-none"
          style={[
            styles.thumbHandleWrapper,
            { top: Math.max(0, Math.min(effectiveThumbY - 24, trackHeight - 52)) },
          ]}
        >
          {/* Google Photos Date Callout Bubble */}
          {isScrubbing && activeDateLabel ? (
            <View style={styles.popoutDateBubble} pointerEvents="none">
              <Text style={styles.popoutDateText}>{activeDateLabel}</Text>
            </View>
          ) : null}

          {/* Draggable Tab Handle (Sticks flush to right edge) */}
          <View
            style={styles.knobTouchTarget}
            {...panResponder.panHandlers}
          >
            <View style={[styles.thumbPill, isScrubbing && styles.thumbPillActive]}>
              <View style={styles.arrowContainer}>
                <Text style={styles.arrowIcon}>▲</Text>
                <View style={styles.arrowSpacer} />
                <Text style={styles.arrowIcon}>▼</Text>
              </View>
            </View>
          </View>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 90,
  },
  railArea: {
    position: 'absolute',
    right: 0,
    top: 60,
    bottom: 80,
    width: 50,
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  yearMarkersContainer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 36,
    width: 44,
  },
  yearPill: {
    position: 'absolute',
    right: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  yearPillText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#4B5563',
  },
  thumbHandleWrapper: {
    position: 'absolute',
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 98,
  },
  popoutDateBubble: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
  },
  popoutDateText: {
    color: '#1F2937',
    fontSize: 12,
    fontWeight: '700',
  },
  knobTouchTarget: {
    paddingVertical: 6,
    paddingLeft: 10,
    paddingRight: 0,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  thumbPill: {
    width: 32,
    height: 48,
    borderTopLeftRadius: 24,
    borderBottomLeftRadius: 24,
    borderTopRightRadius: 0,
    borderBottomRightRadius: 0,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderRightWidth: 0,
    borderColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: -2, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 5,
    elevation: 6,
  },
  thumbPillActive: {
    backgroundColor: '#F3F4F6',
    borderColor: '#D1D5DB',
    transform: [{ scale: 1.08 }],
  },
  arrowContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingRight: 2,
  },
  arrowIcon: {
    color: '#5F6368',
    fontSize: 9,
    lineHeight: 9,
    fontWeight: '700',
  },
  arrowSpacer: {
    height: 3,
  },
});
