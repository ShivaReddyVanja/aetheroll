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

  // Unique years with their first corresponding section index
  const uniqueYears = useMemo(() => {
    const map = new Map<string, number>();
    timelineData.forEach((sec, idx) => {
      if (sec.year && !map.has(sec.year)) {
        map.set(sec.year, idx);
      }
    });
    return Array.from(map.entries()).map(([year, sectionIdx]) => ({
      year,
      sectionIdx,
    }));
  }, [timelineData]);

  // Show scrubber on scroll or scrub
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
    }, 1500);
  };

  useEffect(() => {
    if (isListScrolling) {
      showScrubber();
    } else if (!isScrubbing) {
      scheduleHide();
    }
  }, [isListScrolling]);

  // Map Y touch position inside track to section index
  const handleTouchAtY = (pageY: number, trackTop: number, trackHeight: number) => {
    if (timelineData.length === 0 || trackHeight <= 0) return;

    const relativeY = Math.max(0, Math.min(pageY - trackTop, trackHeight));
    const ratio = relativeY / trackHeight;
    const targetIdx = Math.min(
      Math.floor(ratio * timelineData.length),
      timelineData.length - 1
    );

    const activeSec = timelineData[targetIdx];
    const label = activeSec?.monthYear || activeSec?.title || '';

    setScrubberY(relativeY);
    setActiveDateLabel(label);
    onScrubToSection(targetIdx, label);
  };

  const trackLayoutRef = useRef<{ top: number; height: number }>({ top: 60, height: 300 });

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (evt) => {
          setIsScrubbing(true);
          showScrubber();
          handleTouchAtY(
            evt.nativeEvent.pageY,
            trackLayoutRef.current.top,
            trackLayoutRef.current.height
          );
        },
        onPanResponderMove: (evt) => {
          handleTouchAtY(
            evt.nativeEvent.pageY,
            trackLayoutRef.current.top,
            trackLayoutRef.current.height
          );
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
    [timelineData, onScrubToSection]
  );

  if (timelineData.length <= 1) {
    return null;
  }

  // Calculate thumb position when not actively scrubbing with touch
  const effectiveThumbY = isScrubbing
    ? scrubberY
    : Math.max(0, Math.min(scrollProgress * (trackLayoutRef.current.height || 300), trackLayoutRef.current.height || 300));

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.container, { opacity: opacityAnim }]}
    >
      {/* Floating Center Date Banner when scrubbing */}
      {isScrubbing && activeDateLabel ? (
        <View pointerEvents="none" style={styles.floatingCenterBubble}>
          <Text style={styles.floatingCenterText}>{activeDateLabel}</Text>
        </View>
      ) : null}

      {/* Right Rail Scrubber Area */}
      <View
        style={styles.railArea}
        onLayout={(e) => {
          const { height } = e.nativeEvent.layout;
          trackLayoutRef.current = { top: 60, height };
          trackHeightRef.current = height;
        }}
        {...panResponder.panHandlers}
      >
        {/* Year Pills along the rail */}
        <View style={styles.yearMarkersContainer} pointerEvents="none">
          {uniqueYears.map(({ year, sectionIdx }) => {
            const fraction = timelineData.length > 0 ? sectionIdx / timelineData.length : 0;
            const topPos = fraction * (trackHeightRef.current || 300);
            return (
              <View
                key={year}
                style={[
                  styles.yearPill,
                  { top: Math.max(0, Math.min(topPos, (trackHeightRef.current || 300) - 20)) },
                ]}
              >
                <Text style={styles.yearPillText}>{year}</Text>
              </View>
            );
          })}
        </View>

        {/* Draggable Thumb Indicator */}
        <View
          style={[
            styles.thumbHandleWrapper,
            { top: Math.max(0, effectiveThumbY - 14) },
          ]}
          pointerEvents="none"
        >
          {/* Active Month-Year Popout Callout (next to thumb) */}
          {isScrubbing && activeDateLabel ? (
            <View style={styles.popoutDateBubble}>
              <Text style={styles.popoutDateText}>{activeDateLabel}</Text>
            </View>
          ) : null}

          {/* Draggable Pill Handle with ↕ Chevrons */}
          <View style={[styles.thumbPill, isScrubbing && styles.thumbPillActive]}>
            <Text style={styles.thumbChevron}>↕</Text>
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
  floatingCenterBubble: {
    position: 'absolute',
    top: 60,
    alignSelf: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 6,
    zIndex: 95,
  },
  floatingCenterText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1F2937',
  },
  railArea: {
    position: 'absolute',
    right: 0,
    top: 50,
    bottom: 85,
    width: 75,
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  yearMarkersContainer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 8,
    width: 48,
  },
  yearPill: {
    position: 'absolute',
    right: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#D1D5DB',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2,
  },
  yearPillText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#374151',
  },
  thumbHandleWrapper: {
    position: 'absolute',
    right: 4,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 98,
  },
  popoutDateBubble: {
    backgroundColor: '#1A73E8',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginRight: 6,
    shadowColor: '#1A73E8',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  popoutDateText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  thumbPill: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#D1D5DB',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  thumbPillActive: {
    backgroundColor: '#E8F0FE',
    borderColor: '#1A73E8',
    transform: [{ scale: 1.1 }],
  },
  thumbChevron: {
    color: '#374151',
    fontSize: 13,
    fontWeight: '900',
    lineHeight: 15,
  },
});
