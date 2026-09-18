import React, { useState, useEffect } from 'react';
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
} from 'react-native';
import {
  ChevronRight,
  FolderHeart,
  Images,
  Cloud,
  RefreshCw,
  Smartphone,
  Sparkles,
  Download,
  Server,
  LogOut,
  CheckCircle2,
  Zap,
} from 'lucide-react-native';
import { ChannelItem } from '../components/ChannelPickerSheet';
import { AppVersionInfo, AndroidRelease, subscribeToUpdateProgress } from '../services/appUpdateService';
import { getApiBaseUrl, setApiBaseUrl } from '../services/api';
import { UploadStrategyRouter, UploadEngineMode } from '../services/backup';

export interface SettingsScreenProps {
  user: {
    id?: string | number;
    displayName?: string;
    username?: string;
    phone?: string;
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
}: SettingsScreenProps) {
  const [showServerModal, setShowServerModal] = useState(false);
  const [serverUrlInput, setServerUrlInput] = useState('');
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [liveStatusText, setLiveStatusText] = useState<string | null>(null);
  const [uploadEngineMode, setUploadEngineMode] = useState<UploadEngineMode>(UploadStrategyRouter.getEngineMode());
  const [showEngineModal, setShowEngineModal] = useState(false);

  useEffect(() => {
    setUploadEngineMode(UploadStrategyRouter.getEngineMode());
  }, []);

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
            <ChevronRight size={18} color="#94A3B8" />
          </TouchableOpacity>

          <View style={styles.divider} />

          {/* Indexed Media Count */}
          <View style={styles.rowItem}>
            <View style={[styles.iconBox, { backgroundColor: '#FAF5FF' }]}>
              <Images size={18} color="#9333EA" />
            </View>
            <View style={styles.rowTextCol}>
              <Text style={styles.rowLabel}>Indexed Media</Text>
              <Text style={styles.rowSubtitle}>Photos & videos cached locally</Text>
            </View>
            <View style={styles.badgePill}>
              <Text style={styles.badgeText}>{mediaCount} items</Text>
            </View>
          </View>

          <View style={styles.divider} />

          {/* Storage Capacity */}
          <View style={styles.rowItem}>
            <View style={[styles.iconBox, { backgroundColor: '#F0F9FF' }]}>
              <Cloud size={18} color="#0284C7" />
            </View>
            <View style={styles.rowTextCol}>
              <Text style={styles.rowLabel}>Cloud Storage</Text>
              <Text style={styles.rowSubtitle}>Telegram personal cloud</Text>
            </View>
            <View style={[styles.badgePill, { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' }]}>
              <Text style={[styles.badgeText, { color: '#059669' }]}>Unlimited</Text>
            </View>
          </View>

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

          <View style={styles.divider} />

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
                {uploadEngineMode === 'auto'
                  ? 'Auto (Direct MTProto + Fallback)'
                  : uploadEngineMode === 'direct'
                  ? 'Direct Telegram (Fastest)'
                  : 'Cloudflare Proxy (Relay)'}
              </Text>
            </View>
            <View style={[styles.badgePill, { backgroundColor: '#FFEDD5', borderColor: '#FED7AA' }]}>
              <Text style={[styles.badgeText, { color: '#C2410C' }]}>
                {uploadEngineMode.toUpperCase()}
              </Text>
            </View>
          </TouchableOpacity>
        </View>
      </View>

      {/* Section 2: Application & Updates */}
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

      {/* Section 3: Server & Network (Dev Mode Only) */}
      {__DEV__ && (
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>Developer & Server</Text>
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
      )}

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
                mode: 'auto' as UploadEngineMode,
                title: 'Auto (Direct + Fallback)',
                desc: 'Direct MTProto upload with automatic seamless fallback to Cloudflare proxy if blocked (Recommended).',
              },
              {
                mode: 'direct' as UploadEngineMode,
                title: 'Direct Telegram MTProto',
                desc: 'Uploads 512KB parts directly to Telegram Data Centers for maximum throughput and zero server overhead.',
              },
              {
                mode: 'cloudflare' as UploadEngineMode,
                title: 'Cloudflare Proxy',
                desc: 'Routes chunked uploads through Cloudflare Durable Objects intermediate proxy.',
              },
            ]).map((opt) => {
              const isSelected = uploadEngineMode === opt.mode;
              return (
                <TouchableOpacity
                  key={opt.mode}
                  style={[
                    styles.engineOptionCard,
                    isSelected && styles.engineOptionCardSelected,
                  ]}
                  activeOpacity={0.7}
                  onPress={async () => {
                    await UploadStrategyRouter.setEngineMode(opt.mode);
                    setUploadEngineMode(opt.mode);
                    setShowEngineModal(false);
                  }}
                >
                  <View style={styles.engineOptionHeader}>
                    <Text style={[styles.engineOptionTitle, isSelected && { color: '#2563EB' }]}>
                      {opt.title}
                    </Text>
                    {isSelected && <CheckCircle2 size={18} color="#2563EB" />}
                  </View>
                  <Text style={styles.engineOptionDesc}>{opt.desc}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </Pressable>
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
  engineOptionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
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
});
