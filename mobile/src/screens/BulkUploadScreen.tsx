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
  Layers,
  Battery,
} from 'lucide-react-native';
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
  const [isBatteryOptimized, setIsBatteryOptimized] = useState(false);
  const [dismissBatteryBanner, setDismissBatteryBanner] = useState(false);

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

  // Check battery optimization status on Android
  useEffect(() => {
    async function checkBattery() {
      if (Platform.OS === 'android') {
        const isIgnored = await NativeBackgroundService.isBatteryOptimizationIgnored();
        setIsBatteryOptimized(!isIgnored);
      }
    }
    checkBattery();
  }, [isSyncing]);

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
          activeChannel.id
        );

        const addedCount = validAssets.length - skipped;
        if (skipped > 0) {
          showToast(`Added ${addedCount} new ${addedCount === 1 ? 'item' : 'items'} (${skipped} skipped)`, 'info');
        } else {
          showToast(`Added ${validAssets.length} ${validAssets.length === 1 ? 'item' : 'items'} to backup queue`, 'success');
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

  const handleRequestBatteryOptimization = async () => {
    await NativeBackgroundService.requestIgnoreBatteryOptimization();
    const isIgnored = await NativeBackgroundService.isBatteryOptimizationIgnored();
    setIsBatteryOptimized(!isIgnored);
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
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* Top Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Backup & Sync</Text>
          <Text style={styles.subtitle}>
            {activeChannel ? `Vault: ${activeChannel.name}` : 'Aetheroll Telegram Cloud Vault'}
          </Text>
        </View>
      </View>

      {/* Battery Optimization Exemption Banner on Android */}
      {Platform.OS === 'android' && isBatteryOptimized && !dismissBatteryBanner && (
        <View style={styles.batteryBanner}>
          <View style={styles.batteryBannerLeft}>
            <View style={styles.batteryIconBox}>
              <Battery size={16} color="#D97706" />
            </View>
            <View style={styles.batteryTextContainer}>
              <Text style={styles.batteryTitle}>Unrestricted Background Battery</Text>
              <Text style={styles.batterySubtitle}>
                Allow uploads to run continuously even when screen is locked.
              </Text>
            </View>
          </View>

          <View style={styles.batteryActionRow}>
            <TouchableOpacity
              style={styles.batteryAllowBtn}
              onPress={handleRequestBatteryOptimization}
              activeOpacity={0.7}
            >
              <Text style={styles.batteryAllowText}>Allow</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.batteryDismissBtn}
              onPress={() => setDismissBatteryBanner(true)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.batteryDismissText}>✕</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Control Banner Card */}
      <View style={styles.controlBox}>
        {/* Overall Progress Stat Bar */}
        {stats.total > 0 && (
          <View style={styles.overallStatsBox}>
            <View style={styles.overallStatsHeader}>
              <View style={styles.statusTitleRow}>
                <Text style={styles.overallStatsTitle}>
                  {isSyncing ? 'Syncing to Telegram' : 'Backup Paused'}
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
                ]}
              />
            </View>

            {/* Live Metrics Row: Speed, ETA, Bytes */}
            <View style={styles.metricsRow}>
              <View style={styles.metricItem}>
                <Zap size={12} color="#059669" />
                <Text style={styles.metricText}>
                  {isSyncing && stats.speedBytesPerSec > 0 ? stats.speedFormatted : 'Idle'}
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
        )}

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
                <Plus size={16} color="#1E293B" />
                <Text style={styles.pickMediaText}>Select Media</Text>
              </View>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.syncBtn,
              isSyncing ? styles.syncBtnActive : styles.syncBtnPaused,
              queue.length === 0 && styles.syncBtnDisabled,
            ]}
            onPress={handleToggleSync}
            activeOpacity={0.7}
          >
            <View style={styles.btnContentRow}>
              {isSyncing ? (
                <Pause size={16} color="#FFFFFF" />
              ) : (
                <Play size={16} color="#FFFFFF" />
              )}
              <Text style={styles.syncBtnText}>
                {isSyncing ? 'Pause Sync' : 'Start Sync'}
              </Text>
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

        {/* Adaptive Dynamic Sliding Window Info */}
        <View style={styles.pacerInfo}>
          <Layers size={13} color="#2563EB" />
          <Text style={styles.pacerText}>
            Dynamic Sliding Window: Adaptive parallel streaming + durable state
          </Text>
        </View>
      </View>

      {/* Queue List / Empty State */}
      {queue.length === 0 ? (
        <View style={styles.emptyContainer}>
          <View style={styles.emptyCloudIcon}>
            <CloudUpload size={32} color="#2563EB" />
          </View>
          <Text style={styles.emptyTitle}>No Media in Backup Queue</Text>
          <Text style={styles.emptySubtitle}>
            Tap "Select Media" above to queue photos and videos. Your progress is saved durably so you can safely pause and resume anytime.
          </Text>
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
                  {activeItems.length} active in window
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.4,
  },
  subtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
    fontWeight: '500',
  },
  batteryBanner: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 12,
    backgroundColor: '#FEF3C7',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#FDE68A',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  batteryBannerLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginRight: 8,
  },
  batteryIconBox: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#FDE68A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  batteryTextContainer: {
    flex: 1,
  },
  batteryTitle: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#92400E',
  },
  batterySubtitle: {
    fontSize: 11,
    color: '#B45309',
    marginTop: 1,
  },
  batteryActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  batteryAllowBtn: {
    backgroundColor: '#D97706',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  batteryAllowText: {
    color: '#FFFFFF',
    fontSize: 11.5,
    fontWeight: '700',
  },
  batteryDismissBtn: {
    padding: 4,
  },
  batteryDismissText: {
    fontSize: 12,
    color: '#B45309',
    fontWeight: '700',
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
    gap: 10,
  },
  btnContentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  pickMediaBtn: {
    flex: 1.1,
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  pickMediaText: {
    color: '#1E293B',
    fontSize: 13,
    fontWeight: '700',
  },
  syncBtn: {
    flex: 0.9,
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  syncBtnActive: {
    backgroundColor: '#D97706',
  },
  syncBtnPaused: {
    backgroundColor: '#2563EB',
  },
  syncBtnDisabled: {
    backgroundColor: '#94A3B8',
    opacity: 0.7,
  },
  syncBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
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
  pacerInfo: {
    marginTop: 12,
    paddingVertical: 7,
    paddingHorizontal: 10,
    backgroundColor: '#EFF6FF',
    borderRadius: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pacerText: {
    color: '#1D4ED8',
    fontSize: 11,
    fontWeight: '600',
    flex: 1,
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
    paddingHorizontal: 36,
    paddingBottom: 80,
  },
  emptyCloudIcon: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 19,
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
