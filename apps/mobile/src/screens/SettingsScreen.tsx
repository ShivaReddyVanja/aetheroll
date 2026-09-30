import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  TextInput,
  StatusBar,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ChevronRight,
  FolderHeart,
  RefreshCw,
  Smartphone,
  Sparkles,
  Download,
  Server,
  LogOut,
  CheckCircle2,
  Zap,
  Film,
  SlidersHorizontal,
  ArrowLeft,
  HardDrive,
  Lock,
} from 'lucide-react-native';
import { ChannelItem } from '../components/ChannelPickerSheet';
import { AppVersionInfo, AndroidRelease, subscribeToUpdateProgress } from '../services/appUpdateService';
import { getApiBaseUrl, setApiBaseUrl, getTierStatus } from '../services/api';
import { UploadStrategyRouter, UploadEngineMode } from '../services/backup';
import { StreamingStrategyRouter, StreamingEngineMode, NativeStreamServer } from '../services/streaming';
import { PremiumMembershipScreen } from './PremiumMembershipScreen';

export interface SettingsScreenProps {
  user: {
    id?: string | number;
    displayName?: string;
    username?: string;
    phone?: string;
    tier?: 'free' | 'premium' | 'admin';
    tierExpiresAt?: string | null;
    isTierHeld?: boolean;
    tierHoldReason?: string | null;
  } | null;
  activeChannel: ChannelItem | null;
  mediaCount: number;
  appVersion: AppVersionInfo;
  availableUpdate: AndroidRelease | null;
  isCheckingUpdate: boolean;
  isDownloadingUpdate: boolean;
  updateStatusMessage: string | null;
  isSyncing: boolean;
  onSelectChannel: () => void;
  onSync: () => void;
  onCheckForUpdates: () => void;
  onDownloadUpdate: (release: AndroidRelease) => void;
  onLogout: () => void;
  onUserUpdated?: (user: any) => void;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const val = parseFloat((bytes / Math.pow(k, i)).toFixed(1));
  return `${val} ${sizes[i]}`;
}

export function SettingsScreen({
  user,
  activeChannel,
  mediaCount,
  appVersion,
  availableUpdate,
  isCheckingUpdate,
  isDownloadingUpdate,
  updateStatusMessage,
  isSyncing,
  onSelectChannel,
  onSync,
  onCheckForUpdates,
  onDownloadUpdate,
  onLogout,
  onUserUpdated,
}: SettingsScreenProps) {
  const insets = useSafeAreaInsets();
  const [showAdvancedModal, setShowAdvancedModal] = useState(false);
  const [showServerModal, setShowServerModal] = useState(false);
  const [serverUrlInput, setServerUrlInput] = useState('');
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [liveStatusText, setLiveStatusText] = useState<string | null>(null);
  const [uploadEngineMode, setUploadEngineMode] = useState<UploadEngineMode>(UploadStrategyRouter.getEngineMode());
  const [showEngineModal, setShowEngineModal] = useState(false);
  const [showProModal, setShowProModal] = useState(false);
  const [streamingEngineMode, setStreamingEngineMode] = useState<StreamingEngineMode>(StreamingStrategyRouter.getEngineMode());
  const [showStreamingModal, setShowStreamingModal] = useState(false);
  const [streamCacheSize, setStreamCacheSize] = useState<number>(0);
  const [isClearingCache, setIsClearingCache] = useState(false);

  const isHeld = !!user?.isTierHeld;
  const isPro = (user?.tier === 'premium' || user?.tier === 'admin') && !isHeld;

  const refreshStreamCacheSize = useCallback(async () => {
    try {
      const sizeBytes = await NativeStreamServer.getStreamCacheSizeBytes();
      setStreamCacheSize(sizeBytes || 0);
    } catch {
      setStreamCacheSize(0);
    }
  }, []);

  useEffect(() => {
    UploadStrategyRouter.init().then(setUploadEngineMode);
    StreamingStrategyRouter.init().then((mode) => {
      setStreamingEngineMode(mode);
    });
    refreshStreamCacheSize();

    // Refresh live tier status from backend on open
    getTierStatus()
      .then((status) => {
        if (status.authenticated && status.tier !== undefined && onUserUpdated) {
          const updated = user
            ? {
                ...user,
                tier: status.tier,
                tierExpiresAt: status.tierExpiresAt,
                isTierHeld: status.isTierHeld,
                tierHoldReason: status.tierHoldReason,
              }
            : {
                tier: status.tier,
                tierExpiresAt: status.tierExpiresAt,
                isTierHeld: status.isTierHeld,
                tierHoldReason: status.tierHoldReason,
              };
          onUserUpdated(updated);
        }
      })
      .catch(() => {});
  }, [refreshStreamCacheSize]);

  useEffect(() => {
    // Only enforce fallback to direct mode once user profile and tier data has loaded
    if (user?.tier !== undefined && !isPro) {
      if (streamingEngineMode !== 'direct') {
        StreamingStrategyRouter.setEngineMode('direct').then(() => setStreamingEngineMode('direct'));
      }
      if (uploadEngineMode !== 'direct') {
        UploadStrategyRouter.setEngineMode('direct').then(() => setUploadEngineMode('direct'));
      }
    }
  }, [isPro, user?.tier, streamingEngineMode, uploadEngineMode]);

  useEffect(() => {
    if (showAdvancedModal) {
      refreshStreamCacheSize();
    }
  }, [showAdvancedModal, refreshStreamCacheSize]);

  // Sync input to current stored URL each time the modal opens
  useEffect(() => {
    if (showServerModal) {
      setServerUrlInput(getApiBaseUrl());
    }
  }, [showServerModal]);

  useEffect(() => {
    const unsubscribe = subscribeToUpdateProgress(
      (event) => {
        setDownloadProgress(event.percent);
      },
      (status) => {
        setLiveStatusText(status);
        if (!status) {
          setDownloadProgress(null);
        }
      },
    );
    return unsubscribe;
  }, []);

  const handleSaveServerUrl = () => {
    const trimmed = serverUrlInput.trim();
    if (trimmed) {
      setApiBaseUrl(trimmed);
      setShowServerModal(false);
      Alert.alert('Server Endpoint', 'Backend URL updated successfully.');
    }
  };

  const handleConfirmLogout = () => {
    Alert.alert(
      'Log Out',
      'Are you sure you want to log out of your Telegram Cloud account on this device?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Log Out', style: 'destructive', onPress: onLogout },
      ],
    );
  };

  const handleClearStreamCache = () => {
    if (isClearingCache || streamCacheSize <= 0) {
      Alert.alert('Stream Cache', 'There are currently no cached video chunks stored on this device.');
      return;
    }
    Alert.alert(
      'Clear Stream Cache',
      `This will delete ${formatBytes(streamCacheSize)} of temporarily cached video parts from this device. Future playback will fetch chunks directly from Telegram.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear Cache',
          style: 'destructive',
          onPress: async () => {
            setIsClearingCache(true);
            try {
              await NativeStreamServer.clearStreamCache();
              await refreshStreamCacheSize();
              Alert.alert('Cache Cleared', 'Video stream cache has been emptied successfully.');
            } catch (err: any) {
              Alert.alert('Error', err?.message || 'Failed to clear stream cache.');
            } finally {
              setIsClearingCache(false);
            }
          },
        },
      ]
    );
  };

  const avatarInitial = (user?.displayName || user?.username || 'U')
    .charAt(0)
    .toUpperCase();

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scrollContainer}
      showsVerticalScrollIndicator={false}
    >
      {/* Screen Title */}
      <View style={styles.titleContainer}>
        <Text style={styles.screenTitle}>Settings</Text>
        <Text style={styles.screenSubtitle}>Preferences & Cloud Account</Text>
      </View>

      {/* Hero Profile Banner */}
      <View style={styles.profileCard}>
        <View style={styles.avatarCircle}>
          <Text style={styles.avatarText}>{avatarInitial}</Text>
        </View>
        <View style={styles.profileInfo}>
          <Text style={styles.profileName} numberOfLines={1}>
            {user?.displayName || 'Telegram User'}
          </Text>
          <Text style={styles.profileSub} numberOfLines={1}>
            {user?.username ? `@${user.username}` : 'Telegram Cloud Account'}
          </Text>
          <View style={styles.statusPill}>
            <View style={styles.statusDot} />
            <Text style={styles.statusText}>Connected via MTProto</Text>
          </View>
        </View>
      </View>

      {/* Pro Membership Banner */}
      <TouchableOpacity
        style={[styles.proBannerCard, isHeld && { borderColor: '#FDE68A', backgroundColor: '#FFFDF5' }]}
        activeOpacity={0.8}
        onPress={() => setShowProModal(true)}
      >
        <View style={styles.proBannerLeft}>
          <View
            style={[
              styles.proIconCircle,
              isHeld ? { backgroundColor: '#F59E0B' } : isPro ? { backgroundColor: '#7C3AED' } : {},
            ]}
          >
            <Sparkles size={18} color="#FFFFFF" />
          </View>
          <View style={styles.proBannerTextCol}>
            <View style={styles.proTagRow}>
              <Text style={styles.proBannerTitle}>
                {isHeld ? 'Pro Access On Hold' : isPro ? 'Pro Membership Active' : 'Aetheroll Pro'}
              </Text>
              <View
                style={[
                  styles.proBadge,
                  isHeld && { backgroundColor: '#FFFBEB', borderColor: '#FDE68A' },
                  !isHeld && isPro && { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' },
                ]}
              >
                <Text
                  style={[
                    styles.proBadgeText,
                    isHeld && { color: '#D97706' },
                    !isHeld && isPro && { color: '#059669' },
                  ]}
                >
                  {isHeld ? '⏸ ON HOLD' : isPro ? '✓ ACTIVE' : '⚡ PRO'}
                </Text>
              </View>
            </View>
            <Text style={styles.proBannerSubtitle}>
              {isHeld
                ? (user?.tierHoldReason ? `Hold: ${user.tierHoldReason}` : 'Pro access paused. Tap for details.')
                : isPro
                ? 'All Pro features unlocked'
                : 'Tap to redeem code or upgrade'}
            </Text>
          </View>
        </View>
        <ChevronRight size={18} color={isHeld ? '#D97706' : '#9333EA'} />
      </TouchableOpacity>

      {/* Section 1: Cloud Storage & Sync */}
      <View style={styles.section}>
        <Text style={styles.sectionHeader}>Cloud Storage & Sync</Text>
        <View style={styles.groupCard}>
          {/* Active Photo Album */}
          <TouchableOpacity
            style={styles.rowItem}
            activeOpacity={0.7}
            onPress={onSelectChannel}
          >
            <View style={[styles.iconBox, { backgroundColor: '#EFF6FF' }]}>
              <FolderHeart size={18} color="#2563EB" />
            </View>
            <View style={styles.rowTextCol}>
              <Text style={styles.rowLabel}>Active Album</Text>
              <Text style={styles.rowSubtitle} numberOfLines={1}>
                {activeChannel?.name || 'Saved Messages (Private Cloud)'}
              </Text>
            </View>
            <View style={styles.albumRightRow}>
              <View style={styles.badgePill}>
                <Text style={styles.badgeText}>{mediaCount} items</Text>
              </View>
              <ChevronRight size={18} color="#94A3B8" />
            </View>
          </TouchableOpacity>

          <View style={styles.divider} />

          {/* Sync Now */}
          <TouchableOpacity
            style={styles.rowItem}
            activeOpacity={0.7}
            onPress={onSync}
            disabled={isSyncing}
          >
            <View style={[styles.iconBox, { backgroundColor: '#F0FDFA' }]}>
              {isSyncing ? (
                <ActivityIndicator size={16} color="#0D9488" />
              ) : (
                <RefreshCw size={18} color="#0D9488" />
              )}
            </View>
            <View style={styles.rowTextCol}>
              <Text style={styles.rowLabel}>Cloud Sync</Text>
              <Text style={styles.rowSubtitle}>
                {isSyncing ? 'Syncing with Telegram...' : 'Fetch latest photos & updates'}
              </Text>
            </View>
            <Text style={styles.actionLinkText}>
              {isSyncing ? 'Syncing' : 'Sync Now'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Section 2: Preferences & Advanced */}
      <View style={styles.section}>
        <Text style={styles.sectionHeader}>Preferences & Advanced</Text>
        <View style={styles.groupCard}>
          <TouchableOpacity
            style={styles.rowItem}
            activeOpacity={0.7}
            onPress={() => setShowAdvancedModal(true)}
          >
            <View style={[styles.iconBox, { backgroundColor: '#F5F3FF' }]}>
              <SlidersHorizontal size={18} color="#7C3AED" />
            </View>
            <View style={styles.rowTextCol}>
              <Text style={styles.rowLabel}>Advanced Settings</Text>
              <Text style={styles.rowSubtitle} numberOfLines={1}>
                Upload pipelines, streaming engine & network
              </Text>
            </View>
            <ChevronRight size={18} color="#94A3B8" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Section 3: Application & Updates */}
      <View style={styles.section}>
        <Text style={styles.sectionHeader}>Application & Updates</Text>
        <View style={styles.groupCard}>
          {/* Installed Version */}
          <View style={styles.rowItem}>
            <View style={[styles.iconBox, { backgroundColor: '#ECFDF5' }]}>
              <Smartphone size={18} color="#059669" />
            </View>
            <View style={styles.rowTextCol}>
              <Text style={styles.rowLabel}>Aetheroll for Android</Text>
              <Text style={styles.rowSubtitle}>
                v{appVersion.versionName} (Build {appVersion.versionCode})
              </Text>
            </View>
            {availableUpdate ? (
              <View style={[styles.badgePill, { backgroundColor: '#FEF3C7', borderColor: '#FDE68A' }]}>
                <Text style={[styles.badgeText, { color: '#B45309' }]}>Update</Text>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.checkButton}
                onPress={onCheckForUpdates}
                disabled={isCheckingUpdate}
                activeOpacity={0.7}
              >
                {isCheckingUpdate ? (
                  <ActivityIndicator size="small" color="#1A73E8" />
                ) : (
                  <RefreshCw size={13} color="#1A73E8" />
                )}
                <Text style={styles.checkButtonText}>Check</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Update Banner or Status */}
          {availableUpdate ? (
            <View style={styles.updateCard}>
              <View style={styles.updateCardHeader}>
                <Sparkles size={16} color="#047857" />
                <Text style={styles.updateCardTitle}>
                  New Release v{availableUpdate.version}
                </Text>
              </View>
              {availableUpdate.releaseNotes && availableUpdate.releaseNotes.length > 0 && (
                <Text style={styles.updateCardNotes} numberOfLines={3}>
                  {availableUpdate.releaseNotes.join('\n')}
                </Text>
              )}
              {isDownloadingUpdate && (
                <View style={styles.downloadProgressContainer}>
                  <View style={styles.downloadProgressBarBg}>
                    <View
                      style={[
                        styles.downloadProgressBarFill,
                        { width: `${downloadProgress !== null ? Math.max(downloadProgress, 5) : 10}%` },
                      ]}
                    />
                  </View>
                  <View style={styles.downloadProgressRow}>
                    <Text style={styles.downloadProgressStatus}>
                      {liveStatusText || 'Preparing update...'}
                    </Text>
                    {downloadProgress !== null && (
                      <Text style={styles.downloadProgressPercent}>
                        {downloadProgress}%
                      </Text>
                    )}
                  </View>
                </View>
              )}
              <TouchableOpacity
                style={[
                  styles.downloadButton,
                  isDownloadingUpdate && { opacity: 0.9 },
                ]}
                onPress={() => onDownloadUpdate(availableUpdate)}
                disabled={isDownloadingUpdate}
                activeOpacity={0.85}
              >
                {isDownloadingUpdate ? (
                  <>
                    <ActivityIndicator size="small" color="#FFFFFF" />
                    <Text style={styles.downloadButtonText}>
                      {liveStatusText
                        ? `${liveStatusText}${downloadProgress !== null ? ` (${downloadProgress}%)` : ''}`
                        : 'Downloading...'}
                    </Text>
                  </>
                ) : (
                  <>
                    <Download size={16} color="#FFFFFF" />
                    <Text style={styles.downloadButtonText}>
                      Download & Install Update
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          ) : updateStatusMessage ? (
            <View style={styles.statusMessageRow}>
              <CheckCircle2 size={15} color="#059669" />
              <Text style={styles.statusMessageText}>{updateStatusMessage}</Text>
            </View>
          ) : null}
        </View>
      </View>

      {/* Section 4: Account & Session */}
      <View style={styles.section}>
        <Text style={styles.sectionHeader}>Account</Text>
        <View style={styles.groupCard}>
          <TouchableOpacity
            style={styles.rowItem}
            activeOpacity={0.7}
            onPress={handleConfirmLogout}
          >
            <View style={[styles.iconBox, { backgroundColor: '#FEF2F2' }]}>
              <LogOut size={18} color="#DC2626" />
            </View>
            <View style={styles.rowTextCol}>
              <Text style={[styles.rowLabel, { color: '#DC2626' }]}>
                Log Out of Aetheroll
              </Text>
              <Text style={styles.rowSubtitle}>
                Clear credentials and session from this device
              </Text>
            </View>
            <ChevronRight size={18} color="#FCA5A5" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Footer Branding */}
      <View style={styles.footer}>
        <Text style={styles.footerTitle}>Aetheroll for Android</Text>
        <Text style={styles.footerSub}>
          Encrypted media cloud backup using Telegram MTProto API.
        </Text>
      </View>

      {/* Server Endpoint Edit Modal */}
      <Modal
        visible={showServerModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowServerModal(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setShowServerModal(false)}
        >
          <View
            style={styles.modalDialog}
            onStartShouldSetResponder={() => true}
          >
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Server Endpoint</Text>
              <TouchableOpacity
                style={styles.modalCloseBtn}
                onPress={() => setShowServerModal(false)}
              >
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.modalDesc}>
              Configure the backend API server URL for authentication and media sync.
            </Text>

            <TextInput
              style={styles.modalTextInput}
              value={serverUrlInput}
              onChangeText={setServerUrlInput}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="https://your-server.com"
              placeholderTextColor="#94A3B8"
            />

            <TouchableOpacity
              style={styles.modalSaveBtn}
              onPress={handleSaveServerUrl}
            >
              <Text style={styles.modalSaveBtnText}>Save & Apply</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

      {/* Upload Engine Selection Modal */}
      <Modal
        visible={showEngineModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowEngineModal(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setShowEngineModal(false)}
        >
          <View
            style={styles.modalDialog}
            onStartShouldSetResponder={() => true}
          >
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Upload Engine Pipeline</Text>
              <TouchableOpacity
                style={styles.modalCloseBtn}
                onPress={() => setShowEngineModal(false)}
              >
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.modalDesc}>
              Select how photos and videos are streamed from this device to Telegram cloud storage.
            </Text>

            {([
              {
                mode: 'direct' as UploadEngineMode,
                title: 'Direct Telegram MTProto (Default)',
                desc: 'Uploads 512KB parts directly to Telegram Data Centers for maximum throughput and zero server overhead.',
                isProOnly: false,
              },
              {
                mode: 'auto' as UploadEngineMode,
                title: 'Auto (Direct + Fallback) (Pro ⚡)',
                desc: 'Direct MTProto upload with automatic seamless fallback to Cloudflare proxy if blocked.',
                isProOnly: true,
              },
              {
                mode: 'cloudflare' as UploadEngineMode,
                title: 'Cloudflare Proxy (Pro ⚡)',
                desc: 'Routes chunked uploads through Cloudflare edge proxy for maximum speed and stability.',
                isProOnly: true,
              },
            ]).map((opt) => {
              const isSelected = uploadEngineMode === opt.mode;
              const isDisabled = opt.isProOnly && !isPro;
              return (
                <TouchableOpacity
                  key={opt.mode}
                  style={[
                    styles.engineOptionCard,
                    isSelected && styles.engineOptionCardSelected,
                    isDisabled && styles.engineOptionCardDisabled,
                  ]}
                  activeOpacity={isDisabled ? 0.9 : 0.7}
                  onPress={async () => {
                    if (isDisabled) {
                      Alert.alert(
                        isHeld ? 'Pro Subscription On Hold' : 'Pro Feature',
                        isHeld
                          ? 'Your Pro subscription is currently paused. Please contact support to reactivate your access.'
                          : `${opt.title} is exclusively available for Pro members.`,
                        [
                          { text: 'OK', style: 'cancel' },
                          !isHeld
                            ? {
                                text: 'Activate Pro',
                                onPress: () => {
                                  setShowEngineModal(false);
                                  setShowProModal(true);
                                },
                              }
                            : null,
                        ].filter(Boolean) as any
                      );
                      return;
                    }
                    await UploadStrategyRouter.setEngineMode(opt.mode);
                    setUploadEngineMode(opt.mode);
                    setShowEngineModal(false);
                  }}
                >
                  <View style={styles.engineOptionHeader}>
                    <View style={styles.engineOptionTitleRow}>
                      <Text style={[styles.engineOptionTitle, isSelected && { color: '#2563EB' }, isDisabled && { color: '#94A3B8' }]}>
                        {opt.title}
                      </Text>
                      {isDisabled && (
                        <View style={styles.proLockBadge}>
                          <Lock size={11} color="#94A3B8" />
                          <Text style={styles.proLockBadgeText}>PRO</Text>
                        </View>
                      )}
                    </View>
                    {isSelected && <CheckCircle2 size={18} color="#2563EB" />}
                  </View>
                  <Text style={[styles.engineOptionDesc, isDisabled && { color: '#94A3B8' }]}>{opt.desc}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </Pressable>
      </Modal>

      {/* Streaming Pipeline Selection Modal */}
      <Modal
        visible={showStreamingModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowStreamingModal(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setShowStreamingModal(false)}
        >
          <View
            style={styles.modalDialog}
            onStartShouldSetResponder={() => true}
          >
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Streaming Engine Pipeline</Text>
              <TouchableOpacity
                style={styles.modalCloseBtn}
                onPress={() => setShowStreamingModal(false)}
              >
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.modalDesc}>
              Select how videos and large media are decoded and streamed for playback.
            </Text>

            {([
              {
                mode: 'direct' as StreamingEngineMode,
                title: 'Direct Telegram MTProto (Default)',
                desc: 'Streams parts directly from Telegram Data Centers over client session leases (Zero server egress).',
                isProOnly: false,
              },
              {
                mode: 'auto' as StreamingEngineMode,
                title: 'Auto Hybrid (Pro ⚡)',
                desc: 'Attempts Direct Telegram MTProto first, falling back to Cloudflare Turbo Edge if unreachable.',
                isProOnly: true,
              },
              {
                mode: 'cloudflare' as StreamingEngineMode,
                title: 'Cloudflare Turbo Edge (Pro ⚡)',
                desc: 'Streams via Cloudflare global edge network with HTTP byte-range seeking, HLS caching, and instant startup.',
                isProOnly: true,
              },
            ]).map((opt) => {
              const isSelected = streamingEngineMode === opt.mode;
              const isDisabled = opt.isProOnly && !isPro;
              return (
                <TouchableOpacity
                  key={opt.mode}
                  style={[
                    styles.engineOptionCard,
                    isSelected && styles.engineOptionCardSelected,
                    isDisabled && styles.engineOptionCardDisabled,
                  ]}
                  activeOpacity={isDisabled ? 0.9 : 0.7}
                  onPress={async () => {
                    if (isDisabled) {
                      Alert.alert(
                        isHeld ? 'Pro Subscription On Hold' : 'Pro Feature',
                        isHeld
                          ? 'Your Pro subscription is currently paused. Please contact support to reactivate your access.'
                          : `${opt.title} is exclusively available for Pro members.`,
                        [
                          { text: 'OK', style: 'cancel' },
                          !isHeld
                            ? {
                                text: 'Activate Pro',
                                onPress: () => {
                                  setShowStreamingModal(false);
                                  setShowProModal(true);
                                },
                              }
                            : null,
                        ].filter(Boolean) as any
                      );
                      return;
                    }
                    await StreamingStrategyRouter.setEngineMode(opt.mode);
                    setStreamingEngineMode(opt.mode);
                    setShowStreamingModal(false);
                  }}
                >
                  <View style={styles.engineOptionHeader}>
                    <View style={styles.engineOptionTitleRow}>
                      <Text style={[styles.engineOptionTitle, isSelected && { color: '#4F46E5' }, isDisabled && { color: '#94A3B8' }]}>
                        {opt.title}
                      </Text>
                      {isDisabled && (
                        <View style={styles.proLockBadge}>
                          <Lock size={11} color="#94A3B8" />
                          <Text style={styles.proLockBadgeText}>PRO</Text>
                        </View>
                      )}
                    </View>
                    {isSelected && <CheckCircle2 size={18} color="#4F46E5" />}
                  </View>
                  <Text style={[styles.engineOptionDesc, isDisabled && { color: '#94A3B8' }]}>{opt.desc}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </Pressable>
      </Modal>

      {/* Advanced Settings Sub-Page Modal */}
      <Modal
        visible={showAdvancedModal}
        animationType="slide"
        statusBarTranslucent={true}
        onRequestClose={() => setShowAdvancedModal(false)}
      >
        <View style={[styles.advancedModalContainer, { paddingTop: insets.top }]}>
          <StatusBar barStyle="dark-content" />
          {/* Header */}
          <View style={styles.advancedHeader}>
            <TouchableOpacity
              style={styles.advancedBackBtn}
              onPress={() => setShowAdvancedModal(false)}
              activeOpacity={0.7}
            >
              <ArrowLeft size={20} color="#0F172A" />
            </TouchableOpacity>
            <View style={styles.advancedHeaderTitleCol}>
              <Text style={styles.advancedTitle}>Advanced Settings</Text>
              <Text style={styles.advancedSubtitle}>
                Protocol pipelines and performance tuning
              </Text>
            </View>
          </View>

          <ScrollView
            style={styles.container}
            contentContainerStyle={[
              styles.advancedScrollContainer,
              { paddingBottom: Math.max(insets.bottom + 24, 60) },
            ]}
            showsVerticalScrollIndicator={false}
          >
            {/* Section 1: Transfer & Streaming Engines */}
            <View style={styles.section}>
              <Text style={styles.sectionHeader}>Transfer & Streaming Engines</Text>
              <View style={styles.groupCard}>
                {/* Upload Engine Pipeline */}
                <TouchableOpacity
                  style={styles.rowItem}
                  activeOpacity={0.7}
                  onPress={() => setShowEngineModal(true)}
                >
                  <View style={[styles.iconBox, { backgroundColor: '#FFF7ED' }]}>
                    <Zap size={18} color="#EA580C" />
                  </View>
                  <View style={styles.rowTextCol}>
                    <Text style={styles.rowLabel}>Upload Pipeline</Text>
                    <Text style={styles.rowSubtitle} numberOfLines={1}>
                      {uploadEngineMode === 'direct'
                        ? 'Direct Telegram (Default)'
                        : uploadEngineMode === 'auto'
                        ? 'Auto (Direct MTProto + Fallback)'
                        : 'Cloudflare Proxy (Relay)'}
                    </Text>
                  </View>
                  <View style={[styles.badgePill, { backgroundColor: '#FFEDD5', borderColor: '#FED7AA' }]}>
                    <Text style={[styles.badgeText, { color: '#C2410C' }]}>
                      {uploadEngineMode.toUpperCase()}
                    </Text>
                  </View>
                  <ChevronRight size={16} color="#94A3B8" style={{ marginLeft: 6 }} />
                </TouchableOpacity>

                <View style={styles.divider} />

                {/* Streaming Pipeline */}
                <TouchableOpacity
                  style={styles.rowItem}
                  activeOpacity={0.7}
                  onPress={() => setShowStreamingModal(true)}
                >
                  <View style={[styles.iconBox, { backgroundColor: '#EEF2FF' }]}>
                    <Film size={18} color="#4F46E5" />
                  </View>
                  <View style={styles.rowTextCol}>
                    <Text style={styles.rowLabel}>Streaming Engine</Text>
                    <Text style={styles.rowSubtitle} numberOfLines={1}>
                      {streamingEngineMode === 'direct'
                        ? 'Direct Telegram MTProto (Default)'
                        : streamingEngineMode === 'cloudflare'
                        ? 'Cloudflare Turbo Edge'
                        : 'Auto Hybrid'}
                    </Text>
                  </View>
                  <View style={[styles.badgePill, { backgroundColor: '#E0E7FF', borderColor: '#C7D2FE' }]}>
                    <Text style={[styles.badgeText, { color: '#4338CA' }]}>
                      {streamingEngineMode.toUpperCase()}
                    </Text>
                  </View>
                  <ChevronRight size={16} color="#94A3B8" style={{ marginLeft: 6 }} />
                </TouchableOpacity>
              </View>
            </View>

            {/* Section 2: Storage & Cache */}
            <View style={styles.section}>
              <Text style={styles.sectionHeader}>Storage & Cache</Text>
              <View style={styles.groupCard}>
                <View style={styles.rowItem}>
                  <View style={[styles.iconBox, { backgroundColor: '#ECFDF5' }]}>
                    <HardDrive size={18} color="#059669" />
                  </View>
                  <View style={styles.rowTextCol}>
                    <Text style={styles.rowLabel}>Stream Cache</Text>
                    <Text style={styles.rowSubtitle} numberOfLines={1}>
                      {formatBytes(streamCacheSize)} cached (1GB LRU limit)
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[
                      styles.smallActionBtn,
                      streamCacheSize <= 0 && { opacity: 0.5 },
                    ]}
                    onPress={handleClearStreamCache}
                    disabled={isClearingCache || streamCacheSize <= 0}
                    activeOpacity={0.7}
                  >
                    {isClearingCache ? (
                      <ActivityIndicator size="small" color="#DC2626" />
                    ) : (
                      <Text style={styles.smallActionBtnText}>Clear Cache</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            </View>

            {/* Section 3: Server Endpoint */}
            <View style={styles.section}>
              <Text style={styles.sectionHeader}>Server & Backend</Text>
              <View style={styles.groupCard}>
                <TouchableOpacity
                  style={styles.rowItem}
                  activeOpacity={0.7}
                  onPress={() => {
                    setServerUrlInput(getApiBaseUrl());
                    setShowServerModal(true);
                  }}
                >
                  <View style={[styles.iconBox, { backgroundColor: '#EEF2FF' }]}>
                    <Server size={18} color="#4F46E5" />
                  </View>
                  <View style={styles.rowTextCol}>
                    <Text style={styles.rowLabel}>Server Endpoint</Text>
                    <Text style={styles.rowSubtitle} numberOfLines={1}>
                      {getApiBaseUrl()}
                    </Text>
                  </View>
                  <ChevronRight size={18} color="#94A3B8" />
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* Pro Membership Full-Screen Modal */}
      <Modal
        visible={showProModal}
        animationType="slide"
        statusBarTranslucent={true}
        onRequestClose={() => setShowProModal(false)}
      >
        <PremiumMembershipScreen
          userTier={user?.tier || 'free'}
          isTierHeld={user?.isTierHeld}
          tierHoldReason={user?.tierHoldReason}
          onBack={() => setShowProModal(false)}
          onRedeemSuccess={async (newTier) => {
            setShowProModal(false);
            // Default Pro setup: Cloudflare Turbo for streaming + Direct for uploads
            await StreamingStrategyRouter.setEngineMode('cloudflare');
            await UploadStrategyRouter.setEngineMode('direct');
            setStreamingEngineMode('cloudflare');
            setUploadEngineMode('direct');
            if (onUserUpdated) {
              const updatedUser = user ? { ...user, tier: newTier, isTierHeld: false, tierHoldReason: null } : { tier: newTier, isTierHeld: false, tierHoldReason: null };
              onUserUpdated(updatedUser);
            }
          }}
        />
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  scrollContainer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 110,
  },
  titleContainer: {
    marginBottom: 16,
    paddingHorizontal: 4,
  },
  screenTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.5,
  },
  screenSubtitle: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 2,
  },
  profileCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
    marginBottom: 4,
  },
  proBannerCard: {
    backgroundColor: '#FAF5FF',
    borderRadius: 18,
    padding: 14,
    borderWidth: 1.5,
    borderColor: '#E9D5FF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    marginBottom: 4,
    shadowColor: '#7C3AED',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  proBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
  },
  proIconCircle: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#7C3AED',
    alignItems: 'center',
    justifyContent: 'center',
  },
  proBannerTextCol: {
    flex: 1,
    gap: 2,
  },
  proTagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  proBannerTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#581C87',
  },
  proBadge: {
    backgroundColor: '#7E22CE',
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 5,
  },
  proBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  proBannerSubtitle: {
    fontSize: 11,
    color: '#6B21A8',
    lineHeight: 15,
  },
  avatarCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0F172A',
  },
  profileSub: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 1,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: 6,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#10B981',
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#059669',
  },
  section: {
    marginTop: 20,
  },
  sectionHeader: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 8,
    marginLeft: 6,
  },
  groupCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 1,
  },
  rowItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    paddingHorizontal: 16,
  },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 13,
  },
  rowTextCol: {
    flex: 1,
    paddingRight: 8,
  },
  rowLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1E293B',
  },
  rowSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  albumRightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  divider: {
    height: 1,
    backgroundColor: '#F1F5F9',
    marginLeft: 65,
  },
  badgePill: {
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  actionLinkText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0D9488',
  },
  checkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#EFF6FF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  checkButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1A73E8',
  },
  updateCard: {
    backgroundColor: '#F0FDF4',
    borderTopWidth: 1,
    borderTopColor: '#BBF7D0',
    padding: 14,
  },
  updateCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  updateCardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#166534',
  },
  updateCardNotes: {
    fontSize: 12,
    color: '#15803D',
    lineHeight: 18,
    marginBottom: 12,
  },
  downloadProgressContainer: {
    marginBottom: 12,
  },
  downloadProgressBarBg: {
    height: 6,
    backgroundColor: '#DCFCE7',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 6,
  },
  downloadProgressBarFill: {
    height: '100%',
    backgroundColor: '#059669',
    borderRadius: 3,
  },
  downloadProgressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  downloadProgressStatus: {
    fontSize: 12,
    fontWeight: '600',
    color: '#065F46',
  },
  downloadProgressPercent: {
    fontSize: 12,
    fontWeight: '700',
    color: '#059669',
  },
  downloadButton: {
    backgroundColor: '#059669',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  downloadButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  statusMessageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#F8FAFC',
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  statusMessageText: {
    fontSize: 12,
    color: '#059669',
    fontWeight: '500',
  },
  footer: {
    marginTop: 32,
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  footerTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#94A3B8',
  },
  footerSub: {
    fontSize: 11,
    color: '#CBD5E1',
    marginTop: 4,
    textAlign: 'center',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalDialog: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    width: '100%',
    maxWidth: 400,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 5,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
  },
  modalCloseBtn: {
    padding: 6,
  },
  modalCloseText: {
    fontSize: 16,
    color: '#64748B',
    fontWeight: '700',
  },
  modalDesc: {
    fontSize: 13,
    color: '#64748B',
    lineHeight: 18,
    marginBottom: 14,
  },
  modalTextInput: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: '#0F172A',
    marginBottom: 16,
  },
  modalSaveBtn: {
    backgroundColor: '#2563EB',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  modalSaveBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  engineOptionCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    marginBottom: 10,
  },
  engineOptionCardSelected: {
    backgroundColor: '#EFF6FF',
    borderColor: '#3B82F6',
  },
  engineOptionCardDisabled: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    opacity: 0.6,
  },
  engineOptionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  engineOptionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  proLockBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  proLockBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748B',
  },
  engineOptionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1E293B',
  },
  engineOptionDesc: {
    fontSize: 12,
    color: '#64748B',
    lineHeight: 16,
  },
  advancedModalContainer: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  advancedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  advancedBackBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  advancedHeaderTitleCol: {
    flex: 1,
  },
  advancedTitle: {
    fontSize: 19,
    fontWeight: '700',
    color: '#0F172A',
  },
  advancedSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 1,
  },
  advancedScrollContainer: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  smallActionBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  smallActionBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#DC2626',
  },
});
