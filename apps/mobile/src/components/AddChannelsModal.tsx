import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Platform,
  Dimensions,
  ActivityIndicator,
  FlatList,
  TextInput,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  X,
  Search,
  Plus,
  Trash2,
  Bookmark,
  RefreshCw,
  Sparkles,
  Users,
  CheckCircle,
} from 'lucide-react-native';
import { apiFetch } from '../services/api';
import { ChannelItem } from './ChannelPickerSheet';

const AVATAR_COLORS = [
  '#2563EB', '#7C3AED', '#059669', '#D97706',
  '#DB2777', '#0891B2', '#EA580C', '#4F46E5',
];

function getAvatarColor(name: string): string {
  if (name.toLowerCase().includes('saved')) return '#0088CC';
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getInitials(name: string): string {
  const clean = name.trim();
  if (!clean) return 'C';
  const parts = clean.split(/[\s_-]+/);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return clean.slice(0, 2).toUpperCase();
}

interface AddChannelsModalProps {
  visible: boolean;
  onClose: () => void;
  onOpenCreateChannel: () => void;
  onChannelsUpdated: () => void;
}

export function AddChannelsModal({
  visible,
  onClose,
  onOpenCreateChannel,
  onChannelsUpdated,
}: AddChannelsModalProps) {
  const insets = useSafeAreaInsets();
  const [channels, setChannels] = useState<ChannelItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setSearchQuery('');
      loadAllTelegramChannels();
    }
  }, [visible]);

  const loadAllTelegramChannels = async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/channels?all=true');
      if (res.status === 401) {
        onClose();
        return;
      }
      const data = await res.json();
      if (data && Array.isArray(data.channels)) {
        setChannels(data.channels);
      }
    } catch (err) {
      console.error('Failed to load all channels:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddChannel = async (ch: ChannelItem) => {
    setActionLoadingId(ch.id);
    try {
      const res = await apiFetch('/api/channels/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telegram_channel_id: ch.telegram_channel_id,
          name: ch.name,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setChannels((prev) =>
          prev.map((item) =>
            item.id === ch.id || item.telegram_channel_id === ch.telegram_channel_id
              ? { ...item, is_added: 1 }
              : item
          )
        );
        onChannelsUpdated();
      } else {
        Alert.alert('Error', data.error || 'Failed to add channel');
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not add channel');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleRemoveChannel = async (ch: ChannelItem) => {
    setActionLoadingId(ch.id);
    try {
      const res = await apiFetch('/api/channels/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel_id: ch.id }),
      });
      const data = await res.json();
      if (data.success) {
        setChannels((prev) =>
          prev.map((item) =>
            item.id === ch.id ? { ...item, is_added: 0 } : item
          )
        );
        onChannelsUpdated();
      } else {
        Alert.alert('Error', data.error || 'Failed to remove channel');
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not remove channel');
    } finally {
      setActionLoadingId(null);
    }
  };

  const filteredChannels = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return channels;
    return channels.filter((c) => c.name.toLowerCase().includes(q));
  }, [channels, searchQuery]);

  const addedChannels = filteredChannels.filter((c) => c.is_added === 1);
  const availableChannels = filteredChannels.filter((c) => c.is_added !== 1);

  const renderChannelRow = (ch: ChannelItem, isAdded: boolean) => {
    const isSavedMessages =
      ch.telegram_channel_id === 'me' ||
      ch.telegram_channel_id.startsWith('me_') ||
      ch.name.toLowerCase().includes('saved');
    const isProcessing = actionLoadingId === ch.id;
    const avatarBg = getAvatarColor(ch.name);
    const initials = getInitials(ch.name);

    return (
      <View key={ch.id} style={styles.channelRow}>
        <View style={[styles.avatarBox, { backgroundColor: avatarBg }]}>
          {isSavedMessages ? (
            <Bookmark size={16} color="#FFFFFF" strokeWidth={2.5} />
          ) : (
            <Text style={styles.avatarText}>{initials}</Text>
          )}
        </View>

        <View style={styles.channelDetails}>
          <Text style={styles.channelTitle} numberOfLines={1}>
            {ch.name}
          </Text>
          <View style={styles.metaRow}>
            {isSavedMessages ? (
              <View style={styles.savedBadge}>
                <Text style={styles.savedBadgeText}>Private Cloud Album</Text>
              </View>
            ) : (
              <Text style={styles.metaCount}>
                {ch.media_count !== undefined && ch.media_count > 0
                  ? `${ch.media_count} synced items`
                  : 'Photo Album'}
              </Text>
            )}
          </View>
        </View>

        {isSavedMessages ? (
          <View style={styles.defaultBadge}>
            <CheckCircle size={14} color="#059669" />
            <Text style={styles.defaultBadgeText}>Default</Text>
          </View>
        ) : isAdded ? (
          <TouchableOpacity
            style={styles.removeBtn}
            onPress={() => handleRemoveChannel(ch)}
            disabled={isProcessing}
          >
            {isProcessing ? (
              <ActivityIndicator size="small" color="#EF4444" />
            ) : (
              <Text style={styles.removeBtnText}>Remove</Text>
            )}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.addBtn}
            onPress={() => handleAddChannel(ch)}
            disabled={isProcessing}
          >
            {isProcessing ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <>
                <Plus size={14} color="#FFFFFF" strokeWidth={2.5} />
                <Text style={styles.addBtnText}>Add</Text>
              </>
            )}
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.container, { paddingTop: Platform.OS === 'android' ? insets.top + 8 : 12 }]}>
        {/* Top App Bar */}
        <View style={styles.topBar}>
          <View>
            <Text style={styles.pageTitle}>Add Telegram Channels</Text>
            <Text style={styles.pageSubtitle}>
              Select channels to include in your photo gallery
            </Text>
          </View>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <X size={18} color="#4B5563" strokeWidth={2.2} />
          </TouchableOpacity>
        </View>

        {/* Create Channel Action Banner */}
        <TouchableOpacity
          style={styles.createBanner}
          onPress={() => {
            onClose();
            onOpenCreateChannel();
          }}
          activeOpacity={0.8}
        >
          <View style={styles.createBannerLeft}>
            <View style={styles.createBannerIcon}>
              <Sparkles size={16} color="#FFFFFF" strokeWidth={2.5} />
            </View>
            <View>
              <Text style={styles.createBannerTitle}>Create New Photo Album</Text>
              <Text style={styles.createBannerSub}>
                Start a private or shared album on Telegram
              </Text>
            </View>
          </View>
          <Plus size={18} color="#1A73E8" strokeWidth={2.5} />
        </TouchableOpacity>


        {/* Search Bar */}
        <View style={styles.searchContainer}>
          <Search size={16} color="#9CA3AF" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search channels & groups..."
            placeholderTextColor="#9CA3AF"
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCorrect={false}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.clearBtn}>
              <X size={14} color="#6B7280" />
            </TouchableOpacity>
          )}
        </View>

        {/* Channel Lists */}
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#1A73E8" />
            <Text style={styles.loadingText}>Discovering Telegram channels & groups...</Text>
          </View>
        ) : (
          <FlatList
            data={[{ key: 'content' }]}
            keyExtractor={(item) => item.key}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.listContent}
            renderItem={() => (
              <View>
                {/* SECTION 1: ADDED TO GALLERY */}
                {addedChannels.length > 0 && (
                  <View style={styles.section}>
                    <Text style={styles.sectionHeader}>
                      IN YOUR GALLERY ({addedChannels.length})
                    </Text>
                    <View style={styles.sectionCard}>
                      {addedChannels.map((ch) => renderChannelRow(ch, true))}
                    </View>
                  </View>
                )}

                {/* SECTION 2: AVAILABLE ON TELEGRAM */}
                <View style={styles.section}>
                  <Text style={styles.sectionHeader}>
                    AVAILABLE ON TELEGRAM ({availableChannels.length})
                  </Text>
                  {availableChannels.length === 0 ? (
                    <View style={styles.emptyAvailableBox}>
                      <Text style={styles.emptyAvailableText}>
                        {searchQuery
                          ? 'No matching channels found'
                          : 'All your Telegram channels have been added to the gallery!'}
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.sectionCard}>
                      {availableChannels.map((ch) => renderChannelRow(ch, false))}
                    </View>
                  )}
                </View>
              </View>
            )}
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 14,
  },
  pageTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.3,
  },
  pageSubtitle: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 1,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  createBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    marginHorizontal: 16,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 18,
  },
  createBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  createBannerIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#1A73E8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  createBannerTitle: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#1D4ED8',
  },
  createBannerSub: {
    fontSize: 11,
    color: '#60A5FA',
    marginTop: 1,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginHorizontal: 16,
    marginBottom: 14,
    paddingHorizontal: 12,
    borderRadius: 14,
    height: 40,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 13.5,
    color: '#1F2937',
    paddingVertical: 0,
  },
  clearBtn: {
    padding: 4,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 13.5,
    color: '#6B7280',
    fontWeight: '500',
  },
  section: {
    marginBottom: 20,
  },
  sectionHeader: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6B7280',
    letterSpacing: 0.6,
    marginBottom: 8,
    marginLeft: 4,
  },
  sectionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    overflow: 'hidden',
  },
  channelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F3F4F6',
  },
  avatarBox: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  channelDetails: {
    flex: 1,
    marginRight: 8,
  },
  channelTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1F2937',
    marginBottom: 2,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  metaCount: {
    fontSize: 11.5,
    color: '#6B7280',
  },
  savedBadge: {
    backgroundColor: '#E0F2FE',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
  },
  savedBadgeText: {
    color: '#0284C7',
    fontSize: 10,
    fontWeight: '700',
  },
  defaultBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  defaultBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#059669',
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#1A73E8',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  addBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  removeBtn: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FEE2E2',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  removeBtnText: {
    color: '#DC2626',
    fontSize: 12,
    fontWeight: '600',
  },
  emptyAvailableBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 24,
    alignItems: 'center',
  },
  emptyAvailableText: {
    fontSize: 13,
    color: '#9CA3AF',
    textAlign: 'center',
  },
});
