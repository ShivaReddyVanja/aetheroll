import React, { useState, useEffect, useCallback } from 'react';
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
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { launchImageLibrary, Asset } from 'react-native-image-picker';
import {
  BackupManager,
  BackupItem,
  BackupStats,
  BackupListenerPayload,
} from '../services/backup';
import { getStoredActiveChannel } from '../services/secureStorage';
import { apiFetch } from '../services/api';

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export function BulkUploadScreen() {
  const insets = useSafeAreaInsets();
  const [queue, setQueue] = useState<BackupItem[]>([]);
  const [stats, setStats] = useState<BackupStats>({
    total: 0,
    completed: 0,
    failed: 0,
    pending: 0,
    inProgress: 0,
    bytesUploaded: 0,
    totalBytes: 0,
  });
  const [isSyncing, setIsSyncing] = useState(false);
  const [currentItem, setCurrentItem] = useState<BackupItem | undefined>();
  const [activeChannel, setActiveChannel] = useState<{ id: string; name: string } | null>(null);
  const [isPicking, setIsPicking] = useState(false);

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
      setCurrentItem(payload.currentItem);
    });

    return unsubscribe;
  }, []);

  // Request Android permissions for media library
  const requestMediaPermissions = async (): Promise<boolean> => {
    if (Platform.OS !== 'android') return true;

    try {
      if (Platform.Version >= 33) {
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
      Alert.alert('No Channel Selected', 'Please select a Telegram channel in the Photos tab first.');
      return;
    }

    const hasPermission = await requestMediaPermissions();
    if (!hasPermission) {
      Alert.alert(
        'Permission Required',
        'Storage/Media permission is required to select photos and videos for backup.'
      );
      return;
    }

    try {
      setIsPicking(true);
      const result = await launchImageLibrary({
        mediaType: 'mixed',
        selectionLimit: 0, // 0 allows multiple selection
        includeExtra: false,
      });

      if (result.didCancel) {
        return;
      }

      if (result.errorCode) {
        Alert.alert('Picker Error', result.errorMessage || 'Failed to open media library');
        return;
      }

      if (result.assets && result.assets.length > 0) {
        const validAssets: Asset[] = result.assets.filter((a) => !!a.uri);
        await BackupManager.addAssets(
          validAssets.map((a) => ({
            uri: a.uri!,
            fileName: a.fileName || `media_${Date.now()}.${a.type?.includes('video') ? 'mp4' : 'jpg'}`,
            fileSize: a.fileSize || 0,
            type: a.type || 'image/jpeg',
          })),
          activeChannel.id
        );

        Alert.alert(
          'Media Added',
          `Added ${validAssets.length} ${validAssets.length === 1 ? 'item' : 'items'} to the backup queue.`
        );
      }
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Could not select media');
    } finally {
      setIsPicking(false);
    }
  };

  const handleToggleSync = () => {
    if (queue.length === 0) {
      Alert.alert('Queue Empty', 'Please pick photos or videos to start cloud backup.');
      return;
    }

    if (isSyncing) {
      BackupManager.pauseSync();
    } else {
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

  const renderQueueItem = useCallback(
    ({ item }: { item: BackupItem }) => {
      const isItemUploading = item.status === 'uploading';
      const isFailed = item.status === 'failed';
      const isCompleted = item.status === 'completed';

      return (
        <View style={styles.itemCard}>
          <View style={styles.itemHeader}>
            <View style={styles.itemNameContainer}>
              <Text style={styles.itemTypeIcon}>
                {item.mimeType.includes('video') ? '▶' : '▤'}
              </Text>
              <Text style={styles.itemName} numberOfLines={1}>
                {item.fileName}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.removeItemBtn}
              onPress={() => handleRemoveItem(item.id)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.removeItemText}>✕</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.itemMetaRow}>
            <Text style={styles.itemSizeText}>{formatBytes(item.fileSize)}</Text>
            <View style={styles.statusBadgeRow}>
              <Text
                style={[
                  styles.statusBadgeText,
                  isCompleted && styles.statusBadgeCompleted,
                  isItemUploading && styles.statusBadgeUploading,
                  isFailed && styles.statusBadgeFailed,
                ]}
              >
                {item.status.toUpperCase()}
              </Text>
              {isItemUploading && (
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
                style={[styles.progressBarFill, { width: `${Math.max(5, item.progress)}%` }]}
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
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Backup & Sync</Text>
          <Text style={styles.subtitle}>
            {activeChannel ? `Target Vault: ${activeChannel.name}` : 'Automated Telegram Cloud Vault'}
          </Text>
        </View>
      </View>

      {/* Control Banner Card */}
      <View style={styles.controlBox}>
        {/* Overall Progress Stat Bar */}
        {stats.total > 0 && (
          <View style={styles.overallStatsBox}>
            <View style={styles.overallStatsHeader}>
              <Text style={styles.overallStatsTitle}>
                {isSyncing ? 'Syncing to Telegram...' : 'Backup Paused'}
              </Text>
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
            <View style={styles.bytesRow}>
              <Text style={styles.bytesText}>
                {formatBytes(stats.bytesUploaded)} of {formatBytes(stats.totalBytes)}
              </Text>
              {stats.failed > 0 && (
                <Text style={styles.failedCountText}>{stats.failed} failed</Text>
              )}
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
              <ActivityIndicator size="small" color="#1F1F1F" />
            ) : (
              <Text style={styles.pickMediaText}>+ Pick Photos & Videos</Text>
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
            <Text style={styles.syncBtnText}>
              {isSyncing ? 'Pause Backup' : 'Start Backup'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Helper Action Buttons */}
        <View style={styles.secondaryActionsRow}>
          {stats.failed > 0 && (
            <TouchableOpacity style={styles.secondaryActionBtn} onPress={handleRetryFailed}>
              <Text style={styles.retryActionText}>↻ Retry Failed ({stats.failed})</Text>
            </TouchableOpacity>
          )}

          {stats.completed > 0 && (
            <TouchableOpacity style={styles.secondaryActionBtn} onPress={handleClearCompleted}>
              <Text style={styles.clearActionText}>Clear Completed ({stats.completed})</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Pacer / FLOOD_WAIT Guard Banner */}
        <View style={styles.pacerInfo}>
          <Text style={styles.pacerText}>
            Telegram FLOOD_WAIT Pacer: Adaptive 3.0s pacing enabled
          </Text>
        </View>
      </View>

      {/* Queue List / Empty State */}
      {queue.length === 0 ? (
        <View style={styles.emptyContainer}>
          <View style={styles.emptyCloudIcon}>
            <Text style={styles.emptyIconText}>☁</Text>
          </View>
          <Text style={styles.emptyTitle}>No Media in Backup Queue</Text>
          <Text style={styles.emptySubtitle}>
            Tap "+ Pick Photos & Videos" above to select local media from your device. Files will be queued and securely backed up to your Telegram channel vault.
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
              {currentItem && (
                <Text style={styles.nowUploadingText}>
                  Uploading: {currentItem.fileName}
                </Text>
              )}
            </View>
          }
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F3F4',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1F1F1F',
  },
  subtitle: {
    fontSize: 12,
    color: '#5F6368',
    marginTop: 2,
    fontWeight: '500',
  },
  controlBox: {
    margin: 16,
    padding: 14,
    backgroundColor: '#F8F9FA',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  overallStatsBox: {
    marginBottom: 12,
  },
  overallStatsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  overallStatsTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1F1F1F',
  },
  overallStatsPct: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1A73E8',
  },
  overallProgressBarTrack: {
    height: 6,
    backgroundColor: '#E8EAED',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 4,
  },
  overallProgressBarFill: {
    height: '100%',
    backgroundColor: '#1A73E8',
  },
  bytesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  bytesText: {
    fontSize: 11,
    color: '#5F6368',
  },
  failedCountText: {
    fontSize: 11,
    color: '#DC2626',
    fontWeight: '600',
  },
  bannerRow: {
    flexDirection: 'row',
    gap: 10,
  },
  pickMediaBtn: {
    flex: 1.1,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#DADCE0',
  },
  pickMediaText: {
    color: '#1F1F1F',
    fontSize: 13,
    fontWeight: '600',
  },
  syncBtn: {
    flex: 0.9,
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  syncBtnActive: {
    backgroundColor: '#F59E0B',
  },
  syncBtnPaused: {
    backgroundColor: '#1A73E8',
  },
  syncBtnDisabled: {
    backgroundColor: '#9AA0A6',
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
    marginTop: 8,
  },
  secondaryActionBtn: {
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  retryActionText: {
    fontSize: 11,
    color: '#DC2626',
    fontWeight: '700',
  },
  clearActionText: {
    fontSize: 11,
    color: '#1A73E8',
    fontWeight: '600',
  },
  pacerInfo: {
    marginTop: 10,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: '#E8F0FE',
    borderRadius: 8,
  },
  pacerText: {
    color: '#1967D2',
    fontSize: 10.5,
    textAlign: 'center',
    fontWeight: '500',
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
    color: '#1F1F1F',
    fontSize: 13,
    fontWeight: '700',
  },
  nowUploadingText: {
    fontSize: 11,
    color: '#1A73E8',
    fontWeight: '600',
  },
  itemCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
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
  itemTypeIcon: {
    fontSize: 11,
    color: '#5F6368',
  },
  itemName: {
    color: '#1F1F1F',
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  removeItemBtn: {
    padding: 4,
  },
  removeItemText: {
    fontSize: 12,
    color: '#9AA0A6',
    fontWeight: '700',
  },
  itemMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  itemSizeText: {
    color: '#5F6368',
    fontSize: 11,
  },
  statusBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#5F6368',
  },
  statusBadgeCompleted: {
    color: '#137333',
  },
  statusBadgeUploading: {
    color: '#1A73E8',
  },
  statusBadgeFailed: {
    color: '#DC2626',
  },
  itemProgressPct: {
    fontSize: 10,
    color: '#1A73E8',
    fontWeight: '700',
  },
  itemErrorText: {
    fontSize: 11,
    color: '#DC2626',
    marginTop: 4,
  },
  progressBarTrack: {
    height: 4,
    backgroundColor: '#E8EAED',
    borderRadius: 2,
    marginTop: 8,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#1A73E8',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
    paddingBottom: 80,
  },
  emptyCloudIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#E8F0FE',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyIconText: {
    fontSize: 32,
    color: '#1A73E8',
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1F1F1F',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 13,
    color: '#5F6368',
    textAlign: 'center',
    lineHeight: 19,
  },
});
