import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Alert,
  ActivityIndicator,
  Platform,
  PermissionsAndroid,
  Animated,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { launchImageLibrary, Asset } from 'react-native-image-picker';
import {
  CloudUpload,
  Play,
  Pause,
  RotateCcw,
  Trash2,
  Image as ImageIcon,
  Video as VideoIcon,
  CheckCircle2,
  AlertCircle,
  Zap,
  Clock,
  Plus,
} from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  BackupManager,
  BackupItem,
  BackupStats,
  BackupListenerPayload,
  NativeBackgroundService,
  formatUploadFileSize,
} from '../services/backup';
import { getStoredActiveChannel } from '../services/secureStorage';
import { apiFetch } from '../services/api';

export function BulkUploadScreen() {
  const insets = useSafeAreaInsets();
  const [queue, setQueue] = useState<BackupItem[]>([]);
  const [activeItems, setActiveItems] = useState<BackupItem[]>([]);
  const [stats, setStats] = useState<BackupStats>({
    total: 0,
    completed: 0,
    failed: 0,
    pending: 0,
    inProgress: 0,
    bytesUploaded: 0,
    totalBytes: 0,
    speedFormatted: '0 KB/s',
    speedBytesPerSec: 0,
    etaFormatted: '--',
    activeWorkers: 0,
  });
  const [isSyncing, setIsSyncing] = useState(false);
  const [activeChannel, setActiveChannel] = useState<{ id: string; name: string } | null>(null);
  const [isPicking, setIsPicking] = useState(false);

  // Modern non-blocking animated toast
  const [toast, setToast] = useState<{ message: string; type?: 'success' | 'info' | 'error' } | null>(null);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTranslateY = useRef(new Animated.Value(24)).current;
  const toastTimeoutRef = useRef<any>(null);

  const showToast = useCallback((message: string, type: 'success' | 'info' | 'error' = 'success') => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToast({ message, type });

    toastOpacity.setValue(0);
    toastTranslateY.setValue(24);

    Animated.parallel([
      Animated.timing(toastOpacity, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }),
      Animated.spring(toastTranslateY, {
        toValue: 0,
        friction: 8,
        tension: 60,
        useNativeDriver: true,
      }),
    ]).start();

    toastTimeoutRef.current = setTimeout(() => {
      Animated.timing(toastOpacity, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }).start(() => setToast(null));
    }, 2600);
  }, [toastOpacity, toastTranslateY]);

  // Load active channel
  useEffect(() => {
    async function loadChannel() {
      try {
        const stored = await getStoredActiveChannel();
        if (stored) {
          setActiveChannel(stored);
        } else {
          // Fetch from API
          const res = await apiFetch('/api/channels');
          if (res.ok) {
            const data = await res.json();
            const chs = data.channels || [];
            if (chs.length > 0) {
              setActiveChannel(chs[0]);
            }
          }
        }
      } catch (err) {
        console.warn('[BulkUploadScreen] Load channel error:', err);
      }
    }
    loadChannel();
  }, []);

  // Subscribe to BackupManager real-time queue events
  useEffect(() => {
    const unsubscribe = BackupManager.subscribe((payload: BackupListenerPayload) => {
      setQueue(payload.queue);
      setStats(payload.stats);
      setIsSyncing(payload.isSyncing);
      setActiveItems(payload.activeItems || []);
    });

    return unsubscribe;
  }, []);

  // Request Android permissions for media library & notifications
  const requestMediaPermissions = async (): Promise<boolean> => {
    if (Platform.OS !== 'android') return true;

    try {
      if (Platform.Version >= 33) {
        // Request notification permission for background service progress
        try {
          await PermissionsAndroid.request(
            'android.permission.POST_NOTIFICATIONS' as any
          );
        } catch {}

        const grantedImages = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES
        );
        const grantedVideo = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.READ_MEDIA_VIDEO
        );
        return (
          grantedImages === PermissionsAndroid.RESULTS.GRANTED ||
          grantedVideo === PermissionsAndroid.RESULTS.GRANTED
        );
      } else {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE
        );
        return granted === PermissionsAndroid.RESULTS.GRANTED;
      }
    } catch (err) {
      console.warn('[BulkUploadScreen] Permission request error:', err);
      return false;
    }
  };

  // Launch device photo & video library picker
  const handlePickMedia = async () => {
    if (!activeChannel?.id) {
      showToast('Please select a Telegram channel first', 'info');
      return;
    }

    const hasPermission = await requestMediaPermissions();
    if (!hasPermission) {
      showToast('Storage permission required to select media', 'error');
      return;
    }

    try {
      setIsPicking(true);
      const result = await launchImageLibrary({
        mediaType: 'mixed',
        selectionLimit: 0, // 0 allows multi-selection
        includeExtra: true,
      });

      if (result.didCancel) return;

      if (result.errorCode) {
        showToast(result.errorMessage || 'Failed to open media library', 'error');
        return;
      }

      if (result.assets && result.assets.length > 0) {
        const validAssets: Asset[] = result.assets.filter((a) => !!a.uri);
        const skipped = await BackupManager.addAssets(
          validAssets.map((a) => ({
            uri: a.uri!,
            fileName: a.fileName || `media_${Date.now()}.${a.type?.includes('video') ? 'mp4' : 'jpg'}`,
            fileSize: a.fileSize || 0,
            type: a.type || 'image/jpeg',
            width: a.width,
            height: a.height,
            duration: a.duration,
          })),
          activeChannel.id,
          true
        );

        const addedCount = validAssets.length - skipped;
        if (skipped > 0) {
          showToast(`Uploading ${addedCount} new ${addedCount === 1 ? 'item' : 'items'} (${skipped} already backed up)`, 'info');
        } else {
          showToast(`Uploading ${validAssets.length} ${validAssets.length === 1 ? 'item' : 'items'} to cloud`, 'success');
        }

        // 1-time subtle background battery optimization reminder on Android
        if (Platform.OS === 'android') {
          try {
            const tipShown = await AsyncStorage.getItem('@aetheroll/battery_tip_shown');
            if (!tipShown) {
              await AsyncStorage.setItem('@aetheroll/battery_tip_shown', 'true');
              const isIgnored = await NativeBackgroundService.isBatteryOptimizationIgnored();
              if (!isIgnored) {
                setTimeout(() => {
                  showToast('Tip: Turn on Background Uploads in Settings to sync while screen is locked', 'info');
                }, 3200);
              }
            }
          } catch {}
        }
      }
    } catch (err: any) {
      showToast(err?.message || 'Could not select media', 'error');
    } finally {
      setIsPicking(false);
    }
  };

  const handleToggleSync = async () => {
    if (queue.length === 0) {
      showToast('Select photos or videos to start cloud backup', 'info');
      return;
    }

    if (isAllCompleted) {
      showToast('All items are backed up. Tap "Add More" to queue more media.', 'success');
      return;
    }

    if (isSyncing) {
      BackupManager.pauseSync();
    } else {
      // Ensure notification permission is requested
      if (Platform.OS === 'android' && Platform.Version >= 33) {
        try {
          await PermissionsAndroid.request(
            'android.permission.POST_NOTIFICATIONS' as any
          );
        } catch {}
      }
      BackupManager.startSync();
    }
  };

  const handleRetryFailed = () => {
    BackupManager.retryFailed();
  };

  const handleClearCompleted = () => {
    BackupManager.clearCompleted();
  };

  const handleRemoveItem = (id: string) => {
    BackupManager.removeItem(id);
  };

  const overallProgressPct =
    stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;
  const isAllCompleted = stats.total > 0 && stats.completed === stats.total;

  const renderQueueItem = useCallback(
    ({ item }: { item: BackupItem }) => {
      const isItemUploading = item.status === 'uploading';
      const isFailed = item.status === 'failed';
      const isCompleted = item.status === 'completed';
      const isVideo = item.mimeType?.includes('video');

      return (
        <View style={styles.itemCard}>
          <View style={styles.itemHeader}>
            <View style={styles.itemNameContainer}>
              {isVideo ? (
                <VideoIcon size={16} color="#4F46E5" />
              ) : (
                <ImageIcon size={16} color="#059669" />
              )}
              <Text style={styles.itemName} numberOfLines={1}>
                {item.fileName}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.removeItemBtn}
              onPress={() => handleRemoveItem(item.id)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Trash2 size={15} color="#94A3B8" />
            </TouchableOpacity>
          </View>

          <View style={styles.itemMetaRow}>
            <Text style={styles.itemSizeText}>
              {isItemUploading && item.uploadedBytes !== undefined
                ? `${formatUploadFileSize(Math.min(item.uploadedBytes, item.fileSize || item.uploadedBytes))} / ${formatUploadFileSize(item.fileSize)}`
                : formatUploadFileSize(item.fileSize)}
            </Text>

            <View style={styles.statusBadgeRow}>
              {isCompleted && <CheckCircle2 size={13} color="#16A34A" />}
              {isFailed && <AlertCircle size={13} color="#DC2626" />}
              {isItemUploading && <ActivityIndicator size="small" color="#2563EB" />}

              <Text
                style={[
                  styles.statusBadgeText,
                  isCompleted && styles.statusBadgeCompleted,
                  isItemUploading && styles.statusBadgeUploading,
                  isFailed && styles.statusBadgeFailed,
                ]}
              >
                {isItemUploading && item.progress >= 99
                  ? 'FINALIZING'
                  : item.status.toUpperCase()}
              </Text>
              {isItemUploading && item.progress < 99 && (
                <Text style={styles.itemProgressPct}>{item.progress}%</Text>
              )}
            </View>
          </View>

          {isFailed && item.error && (
            <Text style={styles.itemErrorText} numberOfLines={2}>
              {item.error}
            </Text>
          )}

          {isItemUploading && (
            <View style={styles.progressBarTrack}>
              <View
                style={[styles.progressBarFill, { width: `${Math.max(4, item.progress)}%` }]}
              />
            </View>
          )}
        </View>
      );
    },
    []
  );

  return (
    <View style={styles.container}>
      {/* Control Banner Card - only rendered when queue has active items */}
      {queue.length > 0 && (
        <View style={styles.controlBox}>
          {/* Overall Progress Stat Bar */}
          <View style={styles.overallStatsBox}>
            <View style={styles.overallStatsHeader}>
              <View style={styles.statusTitleRow}>
                <Text style={styles.overallStatsTitle}>
                  {isSyncing ? 'Syncing to Telegram' : isAllCompleted ? 'Backup Complete' : 'Backup Paused'}
                </Text>
                {isSyncing && stats.activeWorkers > 0 && (
                  <View style={styles.activePill}>
                    <Zap size={11} color="#2563EB" />
                    <Text style={styles.activePillText}>{stats.activeWorkers} workers</Text>
                  </View>
                )}
              </View>

              <Text style={styles.overallStatsPct}>
                {stats.completed}/{stats.total} ({overallProgressPct}%)
              </Text>
            </View>

            <View style={styles.overallProgressBarTrack}>
              <View
                style={[
                  styles.overallProgressBarFill,
                  { width: `${overallProgressPct}%` },
                  isAllCompleted && { backgroundColor: '#16A34A' },
                ]}
              />
            </View>

            {/* Live Metrics Row: Speed, ETA, Bytes */}
            <View style={styles.metricsRow}>
              <View style={styles.metricItem}>
                <Zap size={12} color={isAllCompleted ? '#16A34A' : '#059669'} />
                <Text style={styles.metricText}>
                  {isSyncing && stats.speedBytesPerSec > 0 ? stats.speedFormatted : isAllCompleted ? 'Complete' : 'Paused'}
                </Text>
              </View>

              <View style={styles.metricItem}>
                <Clock size={12} color="#64748B" />
                <Text style={styles.metricText}>ETA: {stats.etaFormatted}</Text>
              </View>

              <View style={styles.metricItem}>
                <Text style={styles.bytesText}>
                  {formatUploadFileSize(stats.bytesUploaded)} / {formatUploadFileSize(stats.totalBytes)}
                </Text>
              </View>
            </View>
          </View>

          {/* Action Buttons Row */}
          <View style={styles.bannerRow}>
            <TouchableOpacity
              style={styles.pickMediaBtn}
              onPress={handlePickMedia}
              disabled={isPicking}
              activeOpacity={0.7}
            >
              {isPicking ? (
                <ActivityIndicator size="small" color="#1E293B" />
              ) : (
                <View style={styles.btnContentRow}>
                  <Plus size={15} color="#1E293B" />
                  <Text style={styles.pickMediaText}>Add More</Text>
                </View>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.syncBtn,
                isSyncing
                  ? styles.syncBtnActive
                  : isAllCompleted
                  ? styles.syncBtnCompleted
                  : styles.syncBtnPaused,
              ]}
              onPress={handleToggleSync}
              activeOpacity={0.7}
            >
              <View style={styles.btnContentRow}>
                {isSyncing ? (
                  <>
                    <Pause size={15} color="#FFFFFF" />
                    <Text style={styles.syncBtnText}>Pause Sync</Text>
                  </>
                ) : isAllCompleted ? (
                  <>
                    <CheckCircle2 size={15} color="#FFFFFF" />
                    <Text style={styles.syncBtnText}>All Uploaded</Text>
                  </>
                ) : (
                  <>
                    <Play size={15} color="#FFFFFF" />
                    <Text style={styles.syncBtnText}>Resume Sync</Text>
                  </>
                )}
              </View>
            </TouchableOpacity>
          </View>

          {/* Secondary Actions: Retry / Clear */}
          {(stats.failed > 0 || stats.completed > 0) && (
            <View style={styles.secondaryActionsRow}>
              {stats.failed > 0 && (
                <TouchableOpacity style={styles.secondaryActionBtn} onPress={handleRetryFailed}>
                  <RotateCcw size={12} color="#DC2626" />
                  <Text style={styles.retryActionText}>Retry Failed ({stats.failed})</Text>
                </TouchableOpacity>
              )}

              {stats.completed > 0 && (
                <TouchableOpacity style={styles.secondaryActionBtn} onPress={handleClearCompleted}>
                  <Trash2 size={12} color="#2563EB" />
                  <Text style={styles.clearActionText}>Clear Completed ({stats.completed})</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      )}

      {/* Queue List / Empty State */}
      {queue.length === 0 ? (
        <View style={styles.emptyContainer}>
          <View style={styles.emptyCloudIcon}>
            <CloudUpload size={28} color="#2563EB" />
          </View>
          <Text style={styles.emptyTitle}>No Media in Backup Queue</Text>
          <Text style={styles.emptySubtitle}>
            Select photos and videos to back them up to your Telegram cloud vault.
          </Text>
          <TouchableOpacity
            style={styles.emptySelectBtn}
            onPress={handlePickMedia}
            activeOpacity={0.8}
            disabled={isPicking}
          >
            {isPicking ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <View style={styles.btnContentRow}>
                <Plus size={16} color="#FFFFFF" />
                <Text style={styles.emptySelectBtnText}>Select Photos & Videos</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={queue}
          keyExtractor={(item) => item.id}
          renderItem={renderQueueItem}
          contentContainerStyle={[
            styles.listContainer,
            { paddingBottom: insets.bottom + 90 },
          ]}
          ListHeaderComponent={
            <View style={styles.listHeaderRow}>
              <Text style={styles.sectionHeader}>
                Upload Queue ({queue.length} {queue.length === 1 ? 'item' : 'items'})
              </Text>
              {activeItems.length > 0 && (
                <Text style={styles.nowUploadingText}>
                  {activeItems.length} active
                </Text>
              )}
            </View>
          }
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Modern Non-Blocking Toast Pill */}
      {toast && (
        <Animated.View
          style={[
            styles.toastContainer,
            {
              bottom: insets.bottom + 16,
              opacity: toastOpacity,
              transform: [{ translateY: toastTranslateY }],
            },
          ]}
          pointerEvents="none"
        >
          <View style={styles.toastPill}>
            {toast.type === 'success' && <CheckCircle2 size={18} color="#34D399" />}
            {toast.type === 'info' && <AlertCircle size={18} color="#60A5FA" />}
            {toast.type === 'error' && <AlertCircle size={18} color="#F87171" />}
            <Text style={styles.toastText}>{toast.message}</Text>
          </View>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  controlBox: {
    margin: 16,
    padding: 14,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  overallStatsBox: {
    marginBottom: 14,
  },
  overallStatsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  statusTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  overallStatsTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  activePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  activePillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#2563EB',
  },
  overallStatsPct: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#2563EB',
  },
  overallProgressBarTrack: {
    height: 7,
    backgroundColor: '#F1F5F9',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 8,
  },
  overallProgressBarFill: {
    height: '100%',
    backgroundColor: '#2563EB',
    borderRadius: 4,
  },
  metricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 2,
  },
  metricItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metricText: {
    fontSize: 11.5,
    color: '#475569',
    fontWeight: '600',
  },
  bytesText: {
    fontSize: 11.5,
    color: '#64748B',
    fontWeight: '500',
  },
  bannerRow: {
    flexDirection: 'row',
    gap: 8,
  },
  btnContentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  pickMediaBtn: {
    flex: 1,
    backgroundColor: '#F1F5F9',
    borderRadius: 10,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  pickMediaText: {
    color: '#1E293B',
    fontSize: 12.5,
    fontWeight: '600',
  },
  syncBtn: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  syncBtnActive: {
    backgroundColor: '#D97706',
  },
  syncBtnPaused: {
    backgroundColor: '#2563EB',
  },
  syncBtnCompleted: {
    backgroundColor: '#16A34A',
  },
  syncBtnDisabled: {
    backgroundColor: '#94A3B8',
    opacity: 0.7,
  },
  syncBtnText: {
    color: '#FFFFFF',
    fontSize: 12.5,
    fontWeight: '600',
  },
  secondaryActionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 10,
  },
  secondaryActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  retryActionText: {
    fontSize: 11.5,
    color: '#DC2626',
    fontWeight: '700',
  },
  clearActionText: {
    fontSize: 11.5,
    color: '#2563EB',
    fontWeight: '700',
  },
  listContainer: {
    paddingHorizontal: 16,
  },
  listHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    marginTop: 4,
  },
  sectionHeader: {
    color: '#0F172A',
    fontSize: 13.5,
    fontWeight: '700',
  },
  nowUploadingText: {
    fontSize: 11.5,
    color: '#2563EB',
    fontWeight: '700',
  },
  itemCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  itemNameContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginRight: 8,
  },
  itemName: {
    color: '#0F172A',
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  removeItemBtn: {
    padding: 4,
  },
  itemMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 2,
  },
  itemSizeText: {
    color: '#64748B',
    fontSize: 11.5,
    fontWeight: '500',
  },
  statusBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statusBadgeText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#64748B',
  },
  statusBadgeCompleted: {
    color: '#16A34A',
  },
  statusBadgeUploading: {
    color: '#2563EB',
  },
  statusBadgeFailed: {
    color: '#DC2626',
  },
  itemProgressPct: {
    fontSize: 11,
    color: '#2563EB',
    fontWeight: '700',
  },
  itemErrorText: {
    fontSize: 11,
    color: '#DC2626',
    marginTop: 4,
  },
  progressBarTrack: {
    height: 5,
    backgroundColor: '#F1F5F9',
    borderRadius: 3,
    marginTop: 8,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#2563EB',
    borderRadius: 3,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingBottom: 60,
  },
  emptyCloudIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 12.5,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 18,
  },
  emptySelectBtn: {
    backgroundColor: '#2563EB',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
    shadowColor: '#2563EB',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  emptySelectBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  toastContainer: {
    position: 'absolute',
    left: 20,
    right: 20,
    alignItems: 'center',
    zIndex: 999,
  },
  toastPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 10,
    gap: 10,
    maxWidth: '92%',
  },
  toastText: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '600',
  },
});
