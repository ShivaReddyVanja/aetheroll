import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Dimensions,
  Pressable,
  Platform,
  Modal,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import {
  Check,
  X,
  Search,
  Bookmark,
  Plus,
  Share2,
  FolderPlus,
  Sparkles,
} from 'lucide-react-native';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

export interface ChannelItem {
  id: string;
  name: string;
  telegram_channel_id: string;
  media_count?: number;
  is_added?: number;
  is_channel?: boolean;
  is_group?: boolean;
  is_public?: boolean;
  username?: string | null;
  invite_link?: string | null;
}

interface ChannelPickerSheetProps {
  visible: boolean;
  channels: ChannelItem[];
  activeChannel: ChannelItem | null;
  isLoading?: boolean;
  onClose: () => void;
  onSelectChannel: (channel: ChannelItem) => void;
  onOpenAddChannels: () => void;
  onOpenCreateChannel: () => void;
  onOpenShareChannel: (channel: ChannelItem) => void;
}

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

export function ChannelPickerSheet({
  visible,
  channels,
  activeChannel,
  isLoading = false,
  onClose,
  onSelectChannel,
  onOpenAddChannels,
  onOpenCreateChannel,
  onOpenShareChannel,
}: ChannelPickerSheetProps) {
  const [searchQuery, setSearchQuery] = useState('');

  // Filter channels based on search query
  const filteredChannels = useMemo(() => {
    if (!searchQuery.trim()) return channels;
    const q = searchQuery.toLowerCase().trim();
    return channels.filter((c) => c.name.toLowerCase().includes(q));
  }, [channels, searchQuery]);

  const renderChannelItem = ({ item: ch }: { item: ChannelItem }) => {
    const isActive = activeChannel?.id === ch.id;
    const isSavedMessages =
      ch.telegram_channel_id === 'me' ||
      ch.telegram_channel_id.startsWith('me_') ||
      ch.name.toLowerCase().includes('saved');
    const avatarBg = getAvatarColor(ch.name);
    const initials = getInitials(ch.name);

    return (
      <TouchableOpacity
        style={[styles.channelRow, isActive && styles.channelRowActive]}
        onPress={() => {
          onSelectChannel(ch);
          onClose();
        }}
        activeOpacity={0.65}
      >
        {/* Left Avatar */}
        <View style={[styles.avatarBox, { backgroundColor: avatarBg }]}>
          {isSavedMessages ? (
            <Bookmark size={18} color="#FFFFFF" strokeWidth={2.5} />
          ) : (
            <Text style={styles.avatarText}>{initials}</Text>
          )}
        </View>

        {/* Center Details */}
        <View style={styles.channelDetails}>
          <Text
            style={[styles.channelTitle, isActive && styles.channelTitleActive]}
            numberOfLines={1}
          >
            {ch.name}
          </Text>
          <View style={styles.metaRow}>
            {isSavedMessages ? (
              <View style={styles.savedBadge}>
                <Text style={styles.savedBadgeText}>Private Cloud</Text>
              </View>
            ) : (
              <Text style={styles.metaCount}>
                {ch.media_count !== undefined && ch.media_count > 0
                  ? `${ch.media_count} items`
                  : 'Photo Album'}
              </Text>
            )}
          </View>
        </View>

        {/* Share Button for Custom Channels */}
        {!isSavedMessages && (
          <TouchableOpacity
            style={styles.shareIconBtn}
            onPress={() => onOpenShareChannel(ch)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Share2 size={15} color="#6B7280" strokeWidth={2.2} />
          </TouchableOpacity>
        )}

        {/* Right Status Indicator */}
        {isActive ? (
          <View style={styles.activeCheckCircle}>
            <Check size={14} color="#FFFFFF" strokeWidth={3} />
          </View>
        ) : (
          <View style={styles.inactiveRadioCircle} />
        )}
      </TouchableOpacity>
    );
  };

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View style={styles.sheetContainer}>
          {/* Top Handle */}
          <View style={styles.sheetHandle} />

          {/* Header Row */}
          <View style={styles.sheetHeader}>
            <View style={styles.titleGroup}>
              <Text style={styles.sheetTitle}>Photo Albums</Text>
              {channels.length > 0 && (
                <View style={styles.countBadge}>
                  <Text style={styles.countBadgeText}>{channels.length}</Text>
                </View>
              )}
            </View>
            <TouchableOpacity
              style={styles.closeBtn}
              onPress={onClose}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <X size={18} color="#4B5563" strokeWidth={2.2} />
            </TouchableOpacity>
          </View>

          {/* TOP ACTION PILLS: + Add Channels & + New Album */}
          <View style={styles.actionButtonsRow}>
            <TouchableOpacity
              style={styles.actionPillPrimary}
              onPress={() => {
                onClose();
                onOpenAddChannels();
              }}
              activeOpacity={0.8}
            >
              <FolderPlus size={15} color="#FFFFFF" strokeWidth={2.2} />
              <Text style={styles.actionPillPrimaryText}>Add Channels</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionPillSecondary}
              onPress={() => {
                onClose();
                onOpenCreateChannel();
              }}
              activeOpacity={0.8}
            >
              <Sparkles size={14} color="#1A73E8" strokeWidth={2.2} />
              <Text style={styles.actionPillSecondaryText}>New Album</Text>
            </TouchableOpacity>
          </View>

          {/* Search Filter Bar (if more than 3 channels) */}
          {channels.length > 3 && (
            <View style={styles.searchContainer}>
              <Search size={16} color="#9CA3AF" strokeWidth={2.2} style={styles.searchIcon} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search photo albums..."
                placeholderTextColor="#9CA3AF"
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoCorrect={false}
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.clearSearchBtn}>
                  <X size={14} color="#6B7280" strokeWidth={2.5} />
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Channel List */}
          <FlatList
            data={filteredChannels}
            keyExtractor={(item) => item.id}
            renderItem={renderChannelItem}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            ItemSeparatorComponent={() => <View style={styles.itemSeparator} />}
            ListEmptyComponent={
              isLoading ? (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="small" color="#1A73E8" />
                  <Text style={styles.loadingText}>Loading albums...</Text>
                </View>
              ) : (
                <View style={styles.emptyContainer}>
                  <Text style={styles.emptyText}>
                    {searchQuery ? 'No matching albums found' : 'No photo albums added yet'}
                  </Text>
                </View>
              )
            }
          />
        </View>
      </Pressable>
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
    maxHeight: SCREEN_HEIGHT * 0.8,
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.16,
    shadowRadius: 20,
    elevation: 24,
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
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 10,
  },
  titleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.3,
  },
  countBadge: {
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  countBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7280',
  },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonsRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  actionPillPrimary: {
    flex: 1.2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#1A73E8',
    paddingVertical: 9.5,
    borderRadius: 14,
    shadowColor: '#1A73E8',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  actionPillPrimaryText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  actionPillSecondary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    paddingVertical: 9.5,
    borderRadius: 14,
  },
  actionPillSecondaryText: {
    color: '#1D4ED8',
    fontSize: 13,
    fontWeight: '700',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    marginHorizontal: 16,
    marginBottom: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    height: 38,
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
  clearSearchBtn: {
    padding: 4,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 16,
  },
  itemSeparator: {
    height: 6,
  },
  channelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  channelRowActive: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
  },
  avatarBox: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '800',
  },
  channelDetails: {
    flex: 1,
  },
  channelTitle: {
    fontSize: 14.5,
    fontWeight: '600',
    color: '#1F2937',
    marginBottom: 2,
  },
  channelTitleActive: {
    color: '#1D4ED8',
    fontWeight: '700',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  metaCount: {
    fontSize: 12,
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
  shareIconBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  activeCheckCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#1A73E8',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
  },
  inactiveRadioCircle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: '#D1D5DB',
    marginLeft: 4,
  },
  loadingContainer: {
    padding: 36,
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 13,
    color: '#6B7280',
  },
  emptyContainer: {
    padding: 32,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: '#9CA3AF',
  },
});
