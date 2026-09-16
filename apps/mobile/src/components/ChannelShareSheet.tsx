import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Pressable,
  Platform,
  Dimensions,
  ActivityIndicator,
  Share,
  FlatList,
  TextInput,
  Alert,
  Keyboard,
  KeyboardEvent,
  RefreshControl,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  X,
  Share2,
  Users,
  UserPlus,
  Check,
  Search,
  ExternalLink,
  ShieldAlert,
  RefreshCw,
} from 'lucide-react-native';
import { apiFetch } from '../services/api';
import { ChannelItem } from './ChannelPickerSheet';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

const CONTACTS_CACHE_KEY = '@aetheroll_cached_contacts';
const CONTACTS_CACHE_TS_KEY = '@aetheroll_cached_contacts_ts';
// Default TTL: 30 minutes (Telegram contacts change rarely, but SWR allows silent background freshness)
const CONTACTS_CACHE_TTL_MS = 30 * 60 * 1000;

interface ChannelShareSheetProps {
  visible: boolean;
  channel: ChannelItem | null;
  onClose: () => void;
}

interface ContactItem {
  id: string;
  first_name: string;
  last_name?: string;
  username?: string;
  phone?: string;
}

export function ChannelShareSheet({
  visible,
  channel,
  onClose,
}: ChannelShareSheetProps) {
  const [activeTab, setActiveTab] = useState<'link' | 'contacts'>('link');
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [linkLoading, setLinkLoading] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  // Contacts state with SWR caching
  const [contacts, setContacts] = useState<ContactItem[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactsError, setContactsError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [contactSearch, setContactSearch] = useState('');
  const [invitingId, setInvitingId] = useState<string | null>(null);
  const [invitedIds, setInvitedIds] = useState<Set<string>>(new Set());
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const contactsRef = useRef(contacts);
  useEffect(() => {
    contactsRef.current = contacts;
  }, [contacts]);

  // Bug #3 & #8 Fix: Reset channel-specific state when channel changes
  useEffect(() => {
    setInviteLink(null);
    setLinkError(null);
    setInvitedIds(new Set());
  }, [channel?.telegram_channel_id]);

  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (e: KeyboardEvent) => {
        setKeyboardHeight(e.endCoordinates.height);
      }
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => {
        setKeyboardHeight(0);
      }
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const fetchInviteLink = async (forceRefresh = false) => {
    if (!channel?.telegram_channel_id) return;
    const cacheKey = `@aetheroll_invite_link_${channel.telegram_channel_id}`;

    if (!forceRefresh) {
      try {
        const cachedLink = await AsyncStorage.getItem(cacheKey);
        if (cachedLink) {
          setInviteLink(cachedLink);
          return;
        }
      } catch (err) {
        console.warn('[InviteLink Cache] Error reading cache:', err);
      }
    }

    setLinkLoading(true);
    setLinkError(null);
    try {
      const res = await apiFetch('/api/channels/invite-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegram_channel_id: channel.telegram_channel_id }),
      });
      const data = await res.json();
      if (data.success && data.invite_link) {
        setInviteLink(data.invite_link);
        await AsyncStorage.setItem(cacheKey, data.invite_link);
      } else {
        setLinkError(data.error || 'Failed to generate invite link');
      }
    } catch (err: any) {
      setLinkError(err?.message || 'Could not fetch invite link');
    } finally {
      setLinkLoading(false);
    }
  };

  // Bug #2 Fix: Stable useCallback with ref to prevent infinite re-render loop
  const loadContacts = useCallback(async (forceRefresh = false) => {
    let hasCachedData = false;
    setContactsError(null);

    // 1. Read from AsyncStorage cache immediately for 0ms instant display
    if (!forceRefresh) {
      try {
        const [cachedData, cachedTs] = await Promise.all([
          AsyncStorage.getItem(CONTACTS_CACHE_KEY),
          AsyncStorage.getItem(CONTACTS_CACHE_TS_KEY),
        ]);

        if (cachedData) {
          const parsed: ContactItem[] = JSON.parse(cachedData);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setContacts(parsed);
            hasCachedData = true;

            const ts = cachedTs ? parseInt(cachedTs, 10) : 0;
            const isFresh = Date.now() - ts < CONTACTS_CACHE_TTL_MS;
            if (isFresh) {
              return;
            }
          }
        }
      } catch (err) {
        console.warn('[Contacts Cache] Error reading cache:', err);
      }
    }

    // 2. Revalidate from MTProto API
    if (!hasCachedData && contactsRef.current.length === 0 && !forceRefresh) {
      setContactsLoading(true);
    } else {
      setIsRefreshing(true);
    }

    try {
      const res = await apiFetch('/api/channels/contacts');
      const data = await res.json();
      if (data.success && Array.isArray(data.contacts)) {
        setContacts(data.contacts);
        await Promise.all([
          AsyncStorage.setItem(CONTACTS_CACHE_KEY, JSON.stringify(data.contacts)),
          AsyncStorage.setItem(CONTACTS_CACHE_TS_KEY, Date.now().toString()),
        ]);
      } else if (data.error) {
        setContactsError(data.error);
      }
    } catch (err: any) {
      console.warn('[Contacts Cache] Failed to revalidate contacts:', err);
      setContactsError(err?.message || 'Failed to sync contacts from Telegram');
    } finally {
      setContactsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (visible && channel?.telegram_channel_id) {
      fetchInviteLink();
      if (activeTab === 'contacts') {
        loadContacts(false);
      }
    }
  }, [visible, channel?.telegram_channel_id, activeTab, loadContacts]);

  const handleNativeShare = async () => {
    if (!inviteLink) return;
    try {
      await Share.share({
        title: `Join ${channel?.name || 'Photo Album'} on Telegram`,
        message: `Join my shared photo album "${channel?.name || 'Album'}" on Aetheroll:\n${inviteLink}`,
        url: inviteLink,
      });
    } catch (err) {
      console.error('Share error:', err);
    }
  };

  const handleInviteUser = async (contact: ContactItem) => {
    if (!channel?.telegram_channel_id) return;
    const identifier = contact.username || contact.id;
    setInvitingId(contact.id);
    try {
      const res = await apiFetch('/api/channels/invite-users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telegram_channel_id: channel.telegram_channel_id,
          users: [identifier],
        }),
      });
      const data = await res.json();
      if (data.success) {
        setInvitedIds((prev) => new Set(prev).add(contact.id));
      } else if (data.failed && data.failed.length > 0) {
        const failReason = data.failed[0].reason;
        Alert.alert(
          'Could Not Add Directly',
          failReason || 'User privacy settings prevent adding directly. Please share the invite link with them.',
          [{ text: 'Share Link', onPress: () => setActiveTab('link') }, { text: 'OK' }]
        );
      } else {
        Alert.alert('Invite Error', data.error || 'Failed to invite user');
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Network error');
    } finally {
      setInvitingId(null);
    }
  };

  const filteredContacts = contacts.filter((c) => {
    const q = contactSearch.toLowerCase().trim();
    if (!q) return true;
    const name = `${c.first_name} ${c.last_name || ''}`.toLowerCase();
    const uname = (c.username || '').toLowerCase();
    return name.includes(q) || uname.includes(q);
  });

  const dynamicMaxHeight = keyboardHeight > 0
    ? Math.max(300, SCREEN_HEIGHT - keyboardHeight - 40)
    : SCREEN_HEIGHT * 0.8;

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={[styles.backdrop, { paddingBottom: keyboardHeight }]}>
        {/* Click outside to dismiss backdrop */}
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />

        <View style={[styles.sheetContainer, { maxHeight: dynamicMaxHeight }]}>
          {/* Top Handle */}
          <View style={styles.sheetHandle} />

          {/* Header */}
          <View style={styles.sheetHeader}>
            <View style={styles.titleGroup}>
              <View style={styles.iconBadge}>
                <Share2 size={16} color="#1A73E8" strokeWidth={2.5} />
              </View>
              <View>
                <Text style={styles.sheetTitle}>Invite to Album</Text>
                <Text style={styles.sheetSubtitle} numberOfLines={1}>
                  {channel?.name || 'Photo Album'}
                </Text>
              </View>
            </View>
            <TouchableOpacity
              style={styles.closeBtn}
              onPress={onClose}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <X size={18} color="#4B5563" strokeWidth={2.2} />
            </TouchableOpacity>
          </View>

          {/* Tab Switcher */}
          <View style={styles.tabBar}>
            <TouchableOpacity
              style={[styles.tabBtn, activeTab === 'link' && styles.tabBtnActive]}
              onPress={() => setActiveTab('link')}
            >
              <ExternalLink size={14} color={activeTab === 'link' ? '#1A73E8' : '#6B7280'} />
              <Text style={[styles.tabBtnText, activeTab === 'link' && styles.tabBtnTextActive]}>
                Invite Link
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.tabBtn, activeTab === 'contacts' && styles.tabBtnActive]}
              onPress={() => {
                setActiveTab('contacts');
                if (contacts.length === 0) loadContacts(false);
              }}
            >
              <Users size={14} color={activeTab === 'contacts' ? '#1A73E8' : '#6B7280'} />
              <Text style={[styles.tabBtnText, activeTab === 'contacts' && styles.tabBtnTextActive]}>
                Contacts
              </Text>
            </TouchableOpacity>
          </View>

          {/* TAB 1: INVITE LINK */}
          {activeTab === 'link' && (
            <View style={styles.linkTabContent}>
              {linkLoading ? (
                <View style={styles.loadingBox}>
                  <ActivityIndicator size="small" color="#1A73E8" />
                  <Text style={styles.loadingText}>Generating secure invite link...</Text>
                </View>
              ) : linkError ? (
                <View style={styles.errorBox}>
                  <ShieldAlert size={20} color="#DC2626" />
                  <Text style={styles.errorText}>{linkError}</Text>
                  <TouchableOpacity style={styles.retryBtn} onPress={() => fetchInviteLink(true)}>
                    <Text style={styles.retryBtnText}>Retry</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.linkContainer}>
                  <Text style={styles.linkLabel}>TELEGRAM INVITE LINK</Text>
                  <View style={styles.linkBox}>
                    <Text style={styles.linkText} numberOfLines={1}>
                      {inviteLink || 'https://t.me/+...'}
                    </Text>
                  </View>

                  {/* Share Action Buttons */}
                  <View style={styles.shareButtonsRow}>
                    <TouchableOpacity
                      style={styles.primaryShareBtn}
                      onPress={handleNativeShare}
                      activeOpacity={0.8}
                    >
                      <Share2 size={16} color="#FFFFFF" strokeWidth={2.5} />
                      <Text style={styles.primaryShareText}>Share Link via...</Text>
                    </TouchableOpacity>
                  </View>

                  <Text style={styles.hintText}>
                    Anyone with this link can join this album to view and backup media.
                  </Text>
                </View>
              )}
            </View>
          )}

          {/* TAB 2: CONTACTS */}
          {activeTab === 'contacts' && (
            <View style={styles.contactsTabContainer}>
              <View style={styles.searchBarRow}>
                <View style={styles.searchBar}>
                  <Search size={15} color="#9CA3AF" />
                  <TextInput
                    style={styles.searchInput}
                    placeholder="Search Telegram friends..."
                    placeholderTextColor="#9CA3AF"
                    value={contactSearch}
                    onChangeText={setContactSearch}
                  />
                  {contactSearch.length > 0 && (
                    <TouchableOpacity
                      onPress={() => setContactSearch('')}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <X size={14} color="#9CA3AF" />
                    </TouchableOpacity>
                  )}
                </View>

                {/* Force sync / refresh button */}
                <TouchableOpacity
                  style={[styles.refreshIconBtn, isRefreshing && styles.refreshIconBtnActive]}
                  onPress={() => loadContacts(true)}
                  disabled={isRefreshing || contactsLoading}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityLabel="Refresh Contacts"
                >
                  {isRefreshing ? (
                    <ActivityIndicator size="small" color="#1A73E8" />
                  ) : (
                    <RefreshCw size={15} color="#6B7280" />
                  )}
                </TouchableOpacity>
              </View>

              {contactsError && contacts.length > 0 && (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>{contactsError}</Text>
                </View>
              )}

              {contactsLoading ? (
                <View style={styles.loadingBox}>
                  <ActivityIndicator size="small" color="#1A73E8" />
                  <Text style={styles.loadingText}>Fetching contacts from Telegram...</Text>
                </View>
              ) : contactsError && contacts.length === 0 ? (
                <View style={styles.errorBox}>
                  <ShieldAlert size={20} color="#DC2626" />
                  <Text style={styles.errorText}>{contactsError}</Text>
                  <TouchableOpacity style={styles.retryBtn} onPress={() => loadContacts(true)}>
                    <Text style={styles.retryBtnText}>Retry</Text>
                  </TouchableOpacity>
                </View>
              ) : filteredContacts.length === 0 ? (
                <View style={styles.emptyBox}>
                  <Text style={styles.emptyText}>No Telegram contacts found</Text>
                </View>
              ) : (
                <FlatList
                  data={filteredContacts}
                  keyExtractor={(item) => item.id}
                  style={styles.contactsList}
                  contentContainerStyle={styles.contactsListContent}
                  showsVerticalScrollIndicator={true}
                  keyboardShouldPersistTaps="handled"
                  refreshControl={
                    <RefreshControl
                      refreshing={isRefreshing}
                      onRefresh={() => loadContacts(true)}
                      colors={['#1A73E8']}
                      tintColor="#1A73E8"
                    />
                  }
                  renderItem={({ item }) => {
                    const isInvited = invitedIds.has(item.id);
                    const isProcessing = invitingId === item.id;
                    const fullName = `${item.first_name} ${item.last_name || ''}`.trim();
                    const initial = fullName.charAt(0).toUpperCase() || 'U';

                    return (
                      <View style={styles.contactRow}>
                        <View style={styles.contactAvatar}>
                          <Text style={styles.contactAvatarText}>{initial}</Text>
                        </View>
                        <View style={styles.contactDetails}>
                          <Text style={styles.contactName} numberOfLines={1}>
                            {fullName}
                          </Text>
                          {item.username && (
                            <Text style={styles.contactHandle} numberOfLines={1}>
                              @{item.username}
                            </Text>
                          )}
                        </View>

                        <TouchableOpacity
                          style={[
                            styles.inviteBtn,
                            isInvited && styles.inviteBtnSuccess,
                            isProcessing && styles.inviteBtnDisabled,
                          ]}
                          onPress={() => !isInvited && !isProcessing && handleInviteUser(item)}
                          disabled={isInvited || isProcessing}
                        >
                          {isProcessing ? (
                            <ActivityIndicator size="small" color="#1A73E8" />
                          ) : isInvited ? (
                            <View style={styles.invitedRow}>
                              <Check size={13} color="#059669" strokeWidth={3} />
                              <Text style={styles.invitedText}>Added</Text>
                            </View>
                          ) : (
                            <View style={styles.invitedRow}>
                              <UserPlus size={13} color="#1A73E8" strokeWidth={2.2} />
                              <Text style={styles.inviteText}>Invite</Text>
                            </View>
                          )}
                        </TouchableOpacity>
                      </View>
                    );
                  }}
                />
              )}
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'flex-end',
  },
  sheetContainer: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    width: '100%',
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.16,
    shadowRadius: 20,
    elevation: 24,
    overflow: 'hidden',
  },
  sheetHandle: {
    width: 36,
    height: 4,
    backgroundColor: '#E5E7EB',
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 6,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  titleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },
  sheetSubtitle: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 1,
  },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#F3F4F6',
    padding: 3,
    borderRadius: 14,
    marginTop: 6,
    marginBottom: 12,
  },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: 11,
  },
  tabBtnActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2,
  },
  tabBtnText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#6B7280',
  },
  tabBtnTextActive: {
    color: '#1D4ED8',
    fontWeight: '700',
  },
  linkTabContent: {
    paddingVertical: 8,
    minHeight: 180,
  },
  contactsTabContainer: {
    flex: 1,
    minHeight: 240,
    paddingBottom: 8,
  },
  loadingBox: {
    paddingVertical: 40,
    alignItems: 'center',
    gap: 10,
  },
  loadingText: {
    fontSize: 13,
    color: '#6B7280',
  },
  errorBox: {
    paddingVertical: 24,
    alignItems: 'center',
    gap: 8,
  },
  errorText: {
    fontSize: 13,
    color: '#DC2626',
    textAlign: 'center',
  },
  retryBtn: {
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 12,
    marginTop: 6,
  },
  retryBtnText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: '#DC2626',
  },
  linkContainer: {
    paddingVertical: 4,
  },
  linkLabel: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#6B7280',
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  linkBox: {
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 16,
  },
  linkText: {
    fontSize: 13.5,
    color: '#1F2937',
    fontWeight: '500',
  },
  shareButtonsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  primaryShareBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#1A73E8',
    paddingVertical: 13,
    borderRadius: 16,
    shadowColor: '#1A73E8',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  primaryShareText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  hintText: {
    fontSize: 11.5,
    color: '#9CA3AF',
    textAlign: 'center',
    lineHeight: 16,
  },
  searchBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 38,
    gap: 8,
  },
  refreshIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  refreshIconBtnActive: {
    backgroundColor: '#EFF6FF',
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: '#1F2937',
    paddingVertical: 0,
  },
  contactsList: {
    flex: 1,
  },
  contactsListContent: {
    paddingBottom: 20,
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F3F4F6',
  },
  contactAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#E0F2FE',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  contactAvatarText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0284C7',
  },
  contactDetails: {
    flex: 1,
  },
  contactName: {
    fontSize: 13.5,
    fontWeight: '600',
    color: '#1F2937',
  },
  contactHandle: {
    fontSize: 11.5,
    color: '#6B7280',
    marginTop: 1,
  },
  inviteBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  inviteBtnSuccess: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  inviteBtnDisabled: {
    opacity: 0.6,
  },
  invitedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  inviteText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1A73E8',
  },
  invitedText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#059669',
  },
  emptyBox: {
    paddingVertical: 32,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 13,
    color: '#9CA3AF',
  },
});
