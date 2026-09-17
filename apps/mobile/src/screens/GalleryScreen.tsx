import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  Modal,
  Pressable,
  ScrollView,
  Platform,
  Dimensions,
  ActivityIndicator,
  Vibration,
  Alert,
} from 'react-native';
import { Header } from '../components/Header';
import { BottomNav, TabType } from '../components/BottomNav';
import { TimelineScrubber } from '../components/TimelineScrubber';
import { ChannelPickerSheet, ChannelItem } from '../components/ChannelPickerSheet';
import { AddChannelsModal } from '../components/AddChannelsModal';
import { CreateChannelSheet } from '../components/CreateChannelSheet';
import { ChannelShareSheet } from '../components/ChannelShareSheet';
import { SelectionSlider } from '../components/SelectionSlider';
import { MediaCard, MediaItemData } from '../components/MediaCard';
import { MediaViewerScreen } from './MediaViewerScreen';

import { BulkUploadScreen } from './BulkUploadScreen';
import { PhoneAuthScreen } from './PhoneAuthScreen';
import { BackupManager } from '../services/backup';
import {
  apiFetch,
  getApiBaseUrl,
  setApiBaseUrl,
  initializeAuth,
  verifyCurrentSession,
  performLogout,
  onSessionExpired,
} from '../services/api';
import {
  Smartphone,
  Download,
  RefreshCw,
  CheckCircle2,
  Sparkles,
} from 'lucide-react-native';
import {
  getAppVersionInfo,
  checkForAndroidUpdate,
  downloadAndInstallAndroidUpdate,
  AndroidRelease,
  AppVersionInfo,
} from '../services/appUpdateService';
import { getStoredActiveChannel, saveActiveChannel } from '../services/secureStorage';
import { BrandLogo } from '../components/BrandLogo';

const { width } = Dimensions.get('window');

interface MediaSection {
  title: string;
  data: MediaItemData[];
}

/** Format ISO date string into readable date header e.g. "Sat, Aug 22, 2026" */
function formatDateHeader(dateStr: string | Date): string {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return 'Recent';
    return d.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return 'Recent';
  }
}

export function GalleryScreen() {
  const [user, setUser] = useState<any | null>(null);
  const [isAuthChecking, setIsAuthChecking] = useState(true);
  const [activeTab, setActiveTab] = useState<TabType>('gallery');
  const [items, setItems] = useState<MediaItemData[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState<MediaItemData | null>(null);

  // Channels & Vault state
  const [channels, setChannels] = useState<ChannelItem[]>([]);
  const [activeChannel, setActiveChannel] = useState<ChannelItem | null>(null);
  const [showChannelPicker, setShowChannelPicker] = useState(false);
  const [showAddChannels, setShowAddChannels] = useState(false);
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [shareTargetChannel, setShareTargetChannel] = useState<ChannelItem | null>(null);
  const [isChannelsLoading, setIsChannelsLoading] = useState(false);

  // Profile Modal & Settings
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [serverUrl, setServerUrl] = useState(getApiBaseUrl());

  // Multi-selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectedIdsRef = useRef<Set<string>>(selectedIds);
  useEffect(() => {
    selectedIdsRef.current = selectedIds;
  }, [selectedIds]);

  const isSelectionMode = selectedIds.size > 0;
  const [pendingUploadCount, setPendingUploadCount] = useState(0);

  // Fast Scrubber state & refs
  const [scrollProgress, setScrollProgress] = useState(0);
  const [isListScrolling, setIsListScrolling] = useState(false);
  const scrollViewRef = useRef<any>(null);
  const sectionPositionsRef = useRef<{ [key: number]: number }>({});

  const handleScrubToSection = (sectionIndex: number, _label: string) => {
    const targetY = sectionPositionsRef.current[sectionIndex];
    if (targetY !== undefined && scrollViewRef.current) {
      scrollViewRef.current.scrollTo({ y: Math.max(0, targetY - 4), animated: false });
    }
  };

  // Subscribe to BackupManager stats to show badge on Backup tab
  useEffect(() => {
    const unsubscribe = BackupManager.subscribe((payload) => {
      const activePending = payload.stats.pending + payload.stats.inProgress;
      setPendingUploadCount(activePending);
    });
    return unsubscribe;
  }, []);

  const [authStatusText, setAuthStatusText] = useState('Initializing gallery...');

  // Application version & update state
  const [appVersion, setAppVersion] = useState<AppVersionInfo>({ versionName: '1.0.0', versionCode: 1 });
  const [availableUpdate, setAvailableUpdate] = useState<AndroidRelease | null>(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [isDownloadingUpdate, setIsDownloadingUpdate] = useState(false);
  const [updateStatusMessage, setUpdateStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    getAppVersionInfo().then(setAppVersion).catch(() => {});
    checkForAndroidUpdate()
      .then((release) => {
        if (release) setAvailableUpdate(release);
      })
      .catch(() => {});
  }, []);

  const handleCheckForUpdates = useCallback(async () => {
    try {
      setIsCheckingUpdate(true);
      setUpdateStatusMessage(null);
      const release = await checkForAndroidUpdate({ ignoreDismissed: true });
      if (release) {
        setAvailableUpdate(release);
        setUpdateStatusMessage(null);
      } else {
        setAvailableUpdate(null);
        setUpdateStatusMessage('You are on the latest version.');
      }
    } catch {
      setUpdateStatusMessage('Could not check for updates right now.');
    } finally {
      setIsCheckingUpdate(false);
    }
  }, []);

  const handleDownloadUpdate = useCallback(async (release: AndroidRelease) => {
    try {
      setIsDownloadingUpdate(true);
      setUpdateStatusMessage(null);
      await downloadAndInstallAndroidUpdate(release);
    } catch (err: any) {
      Alert.alert(
        'Update Notice',
        err?.message || 'Failed to download or launch installer. Please try again.',
      );
    } finally {
      setIsDownloadingUpdate(false);
    }
  }, []);

  const addLog = (msg: string) => {
    console.log(`[AUTH_BOOT] ${msg}`);
  };

  // Startup: Load credentials from Android KeyStore & verify session
  useEffect(() => {
    async function bootAuth() {
      addLog('Starting auth check...');
      setAuthStatusText('Checking stored credentials...');
      try {
        setIsAuthChecking(true);

        addLog('Querying Android KeyStore and AsyncStorage...');
        const { token, user: cachedUser } = await initializeAuth();

        if (token) {
          addLog(`Session token found: ${token.slice(0, 8)}...${token.slice(-6)}`);

          // Verify session in background without blowing away the active session
          setAuthStatusText('Verifying session with backend...');
          addLog('Calling GET /api/auth/me to verify session validity...');
          try {
            const result = await verifyCurrentSession();
            addLog(`Backend verification completed: authenticated=${result.authenticated}`);
            if (result.authenticated && result.user) {
              addLog(`Authenticated as: "${result.user.displayName || result.user.username || result.user.id}"`);
              setUser(result.user);

              // Restore stored channel immediately if available
              setAuthStatusText('Restoring active channel...');
              const storedChannel = await getStoredActiveChannel();
              if (storedChannel) {
                addLog(`Restored active channel: "${storedChannel.name}" (${storedChannel.id})`);
                setActiveChannel(storedChannel);
              }
            } else if (result.offline && cachedUser) {
              addLog('Network offline: continuing with cached profile');
              setUser(cachedUser);
              const storedChannel = await getStoredActiveChannel();
              if (storedChannel) {
                setActiveChannel(storedChannel);
              }
            } else {
              addLog('Session expired / invalid token -> redirecting to login');
              setUser(null);
              setChannels([]);
              setItems([]);
              setActiveChannel(null);
              Alert.alert('Session Expired', 'Your session has expired. Please log in again to continue.');
            }
          } catch (vErr: any) {
            addLog(`Session verification error: ${vErr?.message || vErr}`);
            setUser(null);
          }
        } else {
          addLog('No session token found in KeyStore or AsyncStorage');
          addLog('User not logged in -> redirecting to Phone Auth screen');
          setUser(null);
        }
      } catch (err: any) {
        addLog(`Auth boot error: ${err?.message || err}`);
        setUser(null);
      } finally {
        // Small delay so user can observe the status if needed
        setTimeout(() => {
          setIsAuthChecking(false);
        }, 400);
      }
    }

    bootAuth();
  }, []);

  // Subscribe to session expiration events across any API call
  useEffect(() => {
    const unsubscribe = onSessionExpired(() => {
      console.warn('[GALLERY] Session expired event received -> resetting user state');
      setUser(null);
      setChannels([]);
      setItems([]);
      setActiveChannel(null);
      Alert.alert('Session Expired', 'Your session has expired. Please log in again to continue.');
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (user) {
      console.log('[GALLERY EFFECT] User logged in, fetching channels...');
      fetchChannels();
    }
  }, [user]);

  useEffect(() => {
    if (user && activeChannel?.id) {
      console.log('[GALLERY EFFECT] activeChannel is set to:', activeChannel.name, activeChannel.id, '- fetching media');
      fetchGalleryMedia(activeChannel.id);
    }
  }, [user, activeChannel?.id]);

  const handleLogout = async () => {
    console.log('[GALLERY] User logging out...');
    await performLogout();
    setUser(null);
    setChannels([]);
    setItems([]);
    setActiveChannel(null);
    setShowProfileModal(false);
  };

  const fetchChannels = async () => {
    try {
      setIsChannelsLoading(true);
      console.log('[GALLERY CHANNELS] Calling GET /api/channels ...');
      const res = await apiFetch('/api/channels');
      console.log('[GALLERY CHANNELS] Response status:', res.status);
      if (res.status === 401) {
        console.warn('[GALLERY CHANNELS] 401 Unauthorized received');
        return;
      }
      const data = await res.json();
      console.log('[GALLERY CHANNELS] Channels data:', data);
      if (data && Array.isArray(data.channels) && data.channels.length > 0) {
        setChannels(data.channels);
        const storedActive = await getStoredActiveChannel();
        const matched = storedActive ? data.channels.find((c: any) => c.id === storedActive.id) : null;
        const initial = matched || activeChannel || data.channels[0];
        console.log('[GALLERY CHANNELS] Setting active channel to:', initial.name, initial.id);
        setActiveChannel(initial);
        await saveActiveChannel(initial);
      }
    } catch (err) {
      console.error('[GALLERY CHANNELS] Error fetching channels:', err);
    } finally {
      setIsChannelsLoading(false);
    }
  };


  const fetchGalleryMedia = async (targetChannelId?: string) => {
    const chId = targetChannelId || activeChannel?.id;
    if (!chId) {
      console.log('[GALLERY MEDIA] Skipping fetchGalleryMedia: no active channel ID available');
      setLoading(false);
      setRefreshing(false);
      return;
    }

    try {
      setLoading(true);
      console.log(`[GALLERY MEDIA] Calling GET /api/media?channel_id=${encodeURIComponent(chId)}&limit=60 ...`);
      const res = await apiFetch(`/api/media?channel_id=${encodeURIComponent(chId)}&limit=60`);
      console.log('[GALLERY MEDIA] Response status:', res.status);
      if (res.status === 401) {
        console.warn('[GALLERY MEDIA] 401 Unauthorized received');
        return;
      }
      const data: any = await res.json();
      console.log('[GALLERY MEDIA] Items returned count:', data?.items?.length || 0);

      if (data && Array.isArray(data.items)) {
        const formatted = data.items.map((i: any) => ({
          id: i.id,
          telegramMessageId: i.telegram_message_id,
          fileType: i.file_type || 'photo',
          fileSizeBytes: i.file_size_bytes || 0,
          width: i.width || 400,
          height: i.height || 300,
          durationSeconds: i.duration_seconds,
          blurHash: i.blur_hash,
          isFavorite: !!i.is_favorite,
          capturedAt: i.captured_at || new Date().toISOString(),
        }));
        setItems(formatted);
      } else {
        console.warn('[GALLERY MEDIA] Unexpected response:', data);
      }
    } catch (err) {
      console.error('[GALLERY MEDIA] Error fetching media:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleRefresh = () => {
    setRefreshing(true);
    fetchChannels();
    if (activeChannel?.id) {
      fetchGalleryMedia(activeChannel.id);
    }
  };

  const handleToggleFavorite = useCallback(async (id: string) => {
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, isFavorite: !i.isFavorite } : i))
    );
    try {
      await apiFetch(`/api/media/${id}/favorite`, { method: 'POST' });
    } catch {}
  }, []);

  const handleCardPress = useCallback((item: MediaItemData) => {
    if (selectedIdsRef.current.size > 0) {
      Vibration.vibrate(25);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(item.id)) {
          next.delete(item.id);
        } else {
          next.add(item.id);
        }
        return next;
      });
    } else {
      setSelectedMedia(item);
    }
  }, []);

  const handleCardLongPress = useCallback((item: MediaItemData) => {
    Vibration.vibrate(40);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(item.id)) {
        next.delete(item.id);
      } else {
        next.add(item.id);
      }
      return next;
    });
  }, []);

  const handleSelectAll = () => {
    const allIds = new Set(displayedItems.map((i) => i.id));
    setSelectedIds(allIds);
  };

  const handleDeselectAll = () => {
    setSelectedIds(new Set());
  };

  const handleBulkFavorite = async (ids: string[]) => {
    // Optimistic toggle: if all are favorited, unfavorite them; otherwise favorite them
    const allFav = ids.every((id) => items.find((i) => i.id === id)?.isFavorite);
    const targetState = !allFav;

    setItems((prev) =>
      prev.map((i) => (ids.includes(i.id) ? { ...i, isFavorite: targetState } : i))
    );
    setSelectedIds(new Set());

    try {
      await Promise.allSettled(
        ids.map((id) => apiFetch(`/api/media/${id}/favorite`, { method: 'POST' }))
      );
    } catch (err) {
      console.warn('Bulk favorite error:', err);
    }
  };

  const handleBulkDelete = async (ids: string[]) => {
    try {
      // Optimistic delete from UI
      setItems((prev) => prev.filter((i) => !ids.includes(i.id)));
      setSelectedIds(new Set());

      const res = await apiFetch('/api/media/delete', {
        method: 'POST',
        body: JSON.stringify({ media_ids: ids }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        console.warn('Delete media warning:', data.error);
        if (activeChannel?.id) {
          fetchGalleryMedia(activeChannel.id);
        }
      }
    } catch (err) {
      console.error('Bulk delete error:', err);
      if (activeChannel?.id) {
        fetchGalleryMedia(activeChannel.id);
      }
    }
  };

  const displayedItems = useMemo(() => {
    if (activeTab === 'favorites') {
      return items.filter((i) => i.isFavorite);
    }
    return items;
  }, [items, activeTab]);

  // Group items by Date header
  const sections: MediaSection[] = useMemo(() => {
    const map = new Map<string, MediaItemData[]>();
    for (const item of displayedItems) {
      const dateKey = formatDateHeader(item.capturedAt);
      if (!map.has(dateKey)) {
        map.set(dateKey, []);
      }
      map.get(dateKey)!.push(item);
    }
    return Array.from(map.entries()).map(([title, data]) => ({ title, data }));
  }, [displayedItems]);

  if (isAuthChecking) {
    return (
      <View style={styles.splashContainer}>
        <BrandLogo size={56} />
        <Text style={styles.splashTitle}>AETHEROLL</Text>
        <Text style={styles.splashSubtitle}>Unlimited Media Gallery</Text>

        <View style={styles.splashStatusRow}>
          <ActivityIndicator color="#1A73E8" size="small" />
          <Text style={styles.splashStatusText}>{authStatusText}</Text>
        </View>
      </View>
    );
  }

  if (!user) {
    return <PhoneAuthScreen onLoginSuccess={(u) => setUser(u)} />;
  }

  return (
    <View style={styles.container}>
      {/* Top App Header */}
      <Header
        channelName={activeChannel?.name || 'Private Channel'}
        userName={user?.displayName || user?.username || 'User'}
        onSelectChannel={() => {
          setShowChannelPicker(true);
          fetchChannels();
        }}
        onOpenProfile={() => setShowProfileModal(true)}
        onSync={handleRefresh}
        isSyncing={refreshing}
      />

      {/* Main Content Area */}
      {activeTab === 'upload' ? (
        <BulkUploadScreen />
      ) : activeTab === 'settings' ? (
        <ScrollView
          style={styles.settingsContent}
          contentContainerStyle={styles.settingsScrollContainer}
          showsVerticalScrollIndicator={false}
        >
          {/* User Profile Card */}
          <View style={styles.settingsCard}>
            <View style={styles.settingsUserRow}>
              <View style={styles.settingsAvatarCircle}>
                <Text style={styles.settingsAvatarText}>
                  {(user?.displayName || 'U').charAt(0).toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.settingsUserName}>{user?.displayName || 'Logged In'}</Text>
                <Text style={styles.settingsUserSub}>Telegram Cloud Account</Text>
              </View>
            </View>

            <View style={styles.settingsDivider} />

            <View style={styles.settingsItem}>
              <Text style={styles.settingsItemLabel}>Active Photo Album</Text>
              <Text style={styles.settingsItemValue}>{activeChannel?.name || 'Private Channel'}</Text>
            </View>

            <View style={styles.settingsItem}>
              <Text style={styles.settingsItemLabel}>Indexed Media Items</Text>
              <Text style={styles.settingsItemValue}>{items.length} items</Text>
            </View>
          </View>

          {/* Software Updates & App Info Card */}
          <View style={[styles.settingsCard, { marginTop: 16 }]}>
            <View style={styles.settingsHeaderRow}>
              <View style={styles.settingsIconCircle}>
                <Smartphone size={18} color="#0F766E" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.settingsSectionTitle}>Application & Updates</Text>
                <Text style={styles.settingsSectionSub}>Aetheroll for Android</Text>
              </View>
              {availableUpdate && (
                <View style={styles.updateBadgeContainer}>
                  <Text style={styles.updateBadgeText}>Update</Text>
                </View>
              )}
            </View>

            <View style={styles.settingsDivider} />

            <View style={styles.settingsItem}>
              <Text style={styles.settingsItemLabel}>Installed Version</Text>
              <Text style={styles.settingsItemValue}>
                v{appVersion.versionName} (Build {appVersion.versionCode})
              </Text>
            </View>

            {availableUpdate ? (
              <View style={styles.updateAvailableBanner}>
                <View style={styles.updateBannerHeader}>
                  <Sparkles size={16} color="#047857" />
                  <Text style={styles.updateBannerTitle}>
                    New Release v{availableUpdate.version}
                  </Text>
                </View>
                {availableUpdate.releaseNotes && availableUpdate.releaseNotes.length > 0 && (
                  <Text style={styles.updateBannerNotes} numberOfLines={3}>
                    {availableUpdate.releaseNotes.join('\n')}
                  </Text>
                )}
                <TouchableOpacity
                  style={styles.updateActionButton}
                  onPress={() => handleDownloadUpdate(availableUpdate)}
                  disabled={isDownloadingUpdate}
                  activeOpacity={0.8}
                >
                  {isDownloadingUpdate ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <>
                      <Download size={15} color="#FFFFFF" />
                      <Text style={styles.updateActionText}>Download & Install Update</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.upToDateRow}>
                <View style={styles.upToDateStatusLeft}>
                  <CheckCircle2 size={16} color="#059669" />
                  <Text style={styles.upToDateText}>
                    {updateStatusMessage || 'You are running the latest version'}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.checkUpdateButton}
                  onPress={handleCheckForUpdates}
                  disabled={isCheckingUpdate}
                  activeOpacity={0.7}
                >
                  {isCheckingUpdate ? (
                    <ActivityIndicator size="small" color="#1A73E8" />
                  ) : (
                    <RefreshCw size={13} color="#1A73E8" />
                  )}
                  <Text style={styles.checkUpdateText}>Check</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* Logout Button */}
          <TouchableOpacity
            style={[styles.logoutButton, { marginTop: 16 }]}
            onPress={handleLogout}
            activeOpacity={0.8}
          >
            <Text style={styles.logoutButtonText}>Log Out of Aetheroll</Text>
          </TouchableOpacity>
        </ScrollView>
      ) : (
        <View style={styles.mainContent}>
          {loading && items.length === 0 ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator color="#1A73E8" size="small" />
              <Text style={styles.loadingText}>Loading cloud media...</Text>
            </View>
          ) : displayedItems.length === 0 ? (
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIconBox}>
                <Text style={styles.emptyIconText}>◫</Text>
              </View>
              <Text style={styles.emptyTitle}>
                {activeTab === 'favorites' ? 'No Favorites Yet' : 'No Media in Channel'}
              </Text>
              <Text style={styles.emptySub}>
                {activeTab === 'favorites'
                  ? 'Star any photo or video to easily find it here.'
                  : 'Upload photos or videos to your Telegram album to view them here.'}
              </Text>

              {activeTab !== 'favorites' && (
                <TouchableOpacity
                  style={styles.emptyUploadBtn}
                  onPress={() => setActiveTab('upload')}
                  activeOpacity={0.8}
                >
                  <Text style={styles.emptyUploadBtnText}>+ Backup & Upload Photos</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <>
              <ScrollView
                ref={scrollViewRef}
                style={styles.gridScrollView}
                contentContainerStyle={styles.gridContentContainer}
                onScroll={(e) => {
                  const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
                  const maxScroll = Math.max(1, contentSize.height - layoutMeasurement.height);
                  const progress = Math.max(0, Math.min(1, contentOffset.y / maxScroll));
                  setScrollProgress(progress);
                  setIsListScrolling(true);
                }}
                onScrollBeginDrag={() => setIsListScrolling(true)}
                onScrollEndDrag={() => {
                  setTimeout(() => setIsListScrolling(false), 200);
                }}
                onMomentumScrollEnd={() => {
                  setIsListScrolling(false);
                }}
                scrollEventThrottle={16}
                refreshControl={
                  <RefreshControl
                    refreshing={refreshing}
                    onRefresh={handleRefresh}
                    tintColor="#1A73E8"
                  />
                }
                showsVerticalScrollIndicator={false}
              >
                {sections.map((sec, secIdx) => (
                  <View
                    key={sec.title}
                    style={styles.sectionBlock}
                    onLayout={(e) => {
                      sectionPositionsRef.current[secIdx] = e.nativeEvent.layout.y;
                    }}
                  >
                    {/* Date Header Row */}
                    <View style={styles.dateHeaderRow}>
                      <Text style={styles.dateHeaderText}>{sec.title}</Text>
                      <Text style={styles.dateHeaderCount}>{sec.data.length} items</Text>
                    </View>

                    {/* 3-Column Square Grid with 2px gap */}
                    <View style={styles.sectionGrid}>
                      {sec.data.map((item) => (
                        <MediaCard
                          key={item.id}
                          item={item}
                          isSelected={selectedIds.has(item.id)}
                          isSelectionMode={isSelectionMode}
                          onPress={handleCardPress}
                          onLongPress={handleCardLongPress}
                          onToggleFavorite={handleToggleFavorite}
                        />
                      ))}
                    </View>
                  </View>
                ))}
              </ScrollView>

              {/* Google Photos Fast Timeline Scrubber */}
              <TimelineScrubber
                sections={sections}
                scrollProgress={scrollProgress}
                isListScrolling={isListScrolling}
                onScrubToSection={handleScrubToSection}
              />
            </>
          )}
        </View>
      )}

      {/* Lightbox / Media Viewer */}
      {selectedMedia && (
        <MediaViewerScreen
          item={selectedMedia}
          items={displayedItems}
          onClose={() => setSelectedMedia(null)}
          onToggleFavorite={handleToggleFavorite}
        />
      )}

      {/* Bottom Controls: Selection Slider (when selecting) or Google Photos Floating Dock (default) */}
      {isSelectionMode ? (
        <SelectionSlider
          selectedIds={selectedIds}
          totalCount={displayedItems.length}
          channelId={activeChannel?.id}
          onClearSelection={() => setSelectedIds(new Set())}
          onSelectAll={handleSelectAll}
          onDeselectAll={handleDeselectAll}
          onDeleteSelected={handleBulkDelete}
          onFavoriteSelected={handleBulkFavorite}
          onActionComplete={() => {
            if (activeChannel?.id) fetchGalleryMedia(activeChannel.id);
            setSelectedIds(new Set());
          }}
        />
      ) : (
        <BottomNav
          activeTab={activeTab}
          onTabChange={setActiveTab}
          pendingUploadCount={pendingUploadCount}
          hasUpdateAvailable={!!availableUpdate}
        />
      )}

      {/* Fast Fluid Channel Switcher Bottom Sheet */}
      <ChannelPickerSheet
        visible={showChannelPicker}
        channels={channels}
        activeChannel={activeChannel}
        isLoading={isChannelsLoading}
        onClose={() => setShowChannelPicker(false)}
        onSelectChannel={(ch) => {
          setActiveChannel(ch);
          saveActiveChannel(ch);
          fetchGalleryMedia(ch.id);
        }}
        onOpenAddChannels={() => {
          setShowChannelPicker(false);
          setShowAddChannels(true);
        }}
        onOpenCreateChannel={() => {
          setShowChannelPicker(false);
          setShowCreateChannel(true);
        }}
        onOpenShareChannel={(ch) => {
          setShowChannelPicker(false);
          setShareTargetChannel(ch);
        }}
      />

      {/* Add Telegram Channels Discovery Page Modal */}
      <AddChannelsModal
        visible={showAddChannels}
        onClose={() => setShowAddChannels(false)}
        onOpenCreateChannel={() => {
          setShowAddChannels(false);
          setShowCreateChannel(true);
        }}
        onChannelsUpdated={() => {
          fetchChannels();
        }}
      />

      {/* Create Channel Bottom Sheet */}
      <CreateChannelSheet
        visible={showCreateChannel}
        onClose={() => setShowCreateChannel(false)}
        onCreateSuccess={(newChannel) => {
          setChannels((prev) => [newChannel, ...prev]);
          setActiveChannel(newChannel);
          saveActiveChannel(newChannel);
          fetchGalleryMedia(newChannel.id);
        }}
      />

      {/* Share Channel & Invite Friends Sheet */}
      <ChannelShareSheet
        visible={!!shareTargetChannel}
        channel={shareTargetChannel}
        onClose={() => setShareTargetChannel(null)}
      />


      {/* User Profile / Storage Bottom Sheet */}
      <Modal
        visible={showProfileModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowProfileModal(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setShowProfileModal(false)}>
          <View style={styles.profileSheet} onStartShouldSetResponder={() => true}>
            <View style={styles.sheetHandle} />

            {/* User Profile Header */}
            <View style={styles.profileHeaderRow}>
              <View style={styles.profileAvatarLarge}>
                <Text style={styles.profileAvatarLargeText}>
                  {(user?.displayName || 'U').charAt(0).toUpperCase()}
                </Text>
              </View>
              <View style={styles.profileUserTextGroup}>
                <Text style={styles.profileDisplayName}>{user?.displayName || 'Logged In'}</Text>
                <Text style={styles.profileUsername}>
                  {user?.username ? `@${user.username}` : user?.phoneNumber || 'Telegram User'}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.profileCloseBtn}
                onPress={() => setShowProfileModal(false)}
              >
                <Text style={styles.profileCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Storage Progress Box */}
            <View style={styles.storageBox}>
              <View style={styles.storageHeaderRow}>
                <Text style={styles.storageTitle}>Unlimited Telegram Cloud</Text>
                <Text style={styles.storageBadge}>Active</Text>
              </View>
              <View style={styles.storageProgressBar}>
                <View style={styles.storageProgressFill} />
              </View>
              <Text style={styles.storageSubText}>
                {items.length} media items synced to your private Telegram storage.
              </Text>
            </View>

            {/* Actions */}
            <TouchableOpacity
              style={styles.profileActionItem}
              onPress={() => {
                setShowProfileModal(false);
                setActiveTab('settings');
              }}
            >
              <Text style={styles.profileActionText}>⚙ App Settings & Server Endpoint</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.profileLogoutItem}
              onPress={handleLogout}
            >
              <Text style={styles.profileLogoutText}>Log Out</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  mainContent: {
    flex: 1,
  },
  selectionBar: {
    height: 48,
    backgroundColor: '#E8F0FE',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#D2E3FC',
  },
  selectionCloseBtn: {
    padding: 6,
  },
  selectionCloseText: {
    fontSize: 16,
    color: '#1A73E8',
    fontWeight: '700',
  },
  selectionCountText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1A73E8',
  },
  selectionActionBtn: {
    backgroundColor: '#1A73E8',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  selectionActionText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  gridScrollView: {
    flex: 1,
  },
  gridContentContainer: {
    paddingBottom: 96,
  },
  sectionBlock: {
    marginBottom: 6,
  },
  dateHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 4,
  },
  dateHeaderText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1F2937',
    letterSpacing: -0.2,
  },
  dateHeaderCount: {
    fontSize: 12,
    color: '#6B7280',
    fontWeight: '500',
  },
  sectionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 2,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
    gap: 12,
  },
  loadingText: {
    color: '#5F6368',
    fontSize: 14,
    fontWeight: '500',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    marginTop: 60,
  },
  emptyIconBox: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#F1F3F4',
    borderWidth: 1,
    borderColor: '#E8EAED',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyIconText: {
    fontSize: 28,
    color: '#1A73E8',
  },
  emptyTitle: {
    color: '#1F1F1F',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 6,
  },
  emptySub: {
    color: '#5F6368',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 20,
    maxWidth: 260,
  },
  emptyUploadBtn: {
    backgroundColor: '#1A73E8',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 20,
    shadowColor: '#1A73E8',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  emptyUploadBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  settingsContent: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  settingsScrollContainer: {
    paddingBottom: 110,
  },
  settingsCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E8EAED',
    padding: 20,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  settingsUserRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 16,
  },
  settingsAvatarCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#1A73E8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsAvatarText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
  },
  settingsUserName: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1F1F1F',
  },
  settingsUserSub: {
    fontSize: 13,
    color: '#5F6368',
    marginTop: 2,
  },
  settingsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  settingsIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#CCFBF1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsSectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1F1F1F',
  },
  settingsSectionSub: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 1,
  },
  updateBadgeContainer: {
    backgroundColor: '#DCFCE7',
    borderWidth: 1,
    borderColor: '#86EFAC',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  updateBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#15803D',
  },
  settingsDivider: {
    height: 1,
    backgroundColor: '#E8EAED',
    marginVertical: 12,
  },
  settingsItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    alignItems: 'center',
  },
  settingsItemLabel: {
    fontSize: 14,
    color: '#5F6368',
  },
  settingsItemValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1F1F1F',
  },
  updateAvailableBanner: {
    backgroundColor: '#F0FDF4',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#BBF7D0',
    padding: 14,
    marginTop: 10,
  },
  updateBannerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  updateBannerTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#166534',
  },
  updateBannerNotes: {
    fontSize: 12,
    color: '#15803D',
    lineHeight: 18,
    marginBottom: 12,
  },
  updateActionButton: {
    backgroundColor: '#059669',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  updateActionText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  upToDateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 8,
  },
  upToDateStatusLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  upToDateText: {
    fontSize: 13,
    color: '#374151',
    fontWeight: '500',
    flex: 1,
  },
  checkUpdateButton: {
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
  checkUpdateText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1A73E8',
  },
  logoutButton: {
    marginTop: 20,
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: 'center',
  },
  logoutButtonText: {
    color: '#DC2626',
    fontSize: 14,
    fontWeight: '700',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'flex-end',
  },
  bottomSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderColor: '#E8EAED',
    maxHeight: '75%',
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 10,
  },
  sheetHandle: {
    width: 38,
    height: 4,
    backgroundColor: '#DADCE0',
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 12,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F3F4',
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#1F1F1F',
  },
  sheetCloseText: {
    fontSize: 16,
    color: '#5F6368',
    fontWeight: '600',
    padding: 4,
  },
  channelList: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  channelItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 14,
    marginBottom: 6,
  },
  channelItemRowActive: {
    backgroundColor: '#E8F0FE',
  },
  channelAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#1A73E8',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  channelAvatarText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  channelInfo: {
    flex: 1,
  },
  channelNameText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1F1F1F',
  },
  channelNameActive: {
    color: '#1A73E8',
    fontWeight: '700',
  },
  channelMetaText: {
    fontSize: 12,
    color: '#5F6368',
    marginTop: 2,
  },
  channelCheck: {
    color: '#1A73E8',
    fontSize: 16,
    fontWeight: '900',
  },
  profileSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderColor: '#E8EAED',
    padding: 20,
    paddingBottom: Platform.OS === 'ios' ? 36 : 24,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 10,
  },
  profileHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 18,
  },
  profileAvatarLarge: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#1A73E8',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  profileAvatarLargeText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
  },
  profileUserTextGroup: {
    flex: 1,
  },
  profileDisplayName: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1F1F1F',
  },
  profileUsername: {
    fontSize: 13,
    color: '#5F6368',
    marginTop: 2,
  },
  profileCloseBtn: {
    padding: 6,
  },
  profileCloseText: {
    fontSize: 16,
    color: '#5F6368',
    fontWeight: '700',
  },
  storageBox: {
    backgroundColor: '#F8F9FA',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E8EAED',
    padding: 16,
    marginBottom: 16,
  },
  storageHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  storageTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1F1F1F',
  },
  storageBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: '#137333',
    backgroundColor: '#E6F4EA',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  storageProgressBar: {
    height: 6,
    backgroundColor: '#E8EAED',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 8,
  },
  storageProgressFill: {
    width: '35%',
    height: '100%',
    backgroundColor: '#1A73E8',
    borderRadius: 3,
  },
  storageSubText: {
    fontSize: 12,
    color: '#5F6368',
    lineHeight: 16,
  },
  profileActionItem: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F3F4',
  },
  profileActionText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1F1F1F',
  },
  profileLogoutItem: {
    paddingVertical: 14,
    marginTop: 4,
  },
  profileLogoutText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#DC2626',
  },
  splashContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  splashTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: '#1F1F1F',
    letterSpacing: 3,
    marginTop: 14,
  },
  splashSubtitle: {
    fontSize: 12,
    color: '#5F6368',
    fontWeight: '500',
    marginTop: 4,
    marginBottom: 20,
  },
  splashStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#E8F0FE',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    marginTop: 8,
  },
  splashStatusText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1A73E8',
  },
});
