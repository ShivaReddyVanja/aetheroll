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
import { Check, X, Search, Bookmark } from 'lucide-react-native';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

export interface ChannelItem {
  id: string;
  name: string;
  telegram_channel_id: string;
  media_count?: number;
  is_added?: number;
}

interface ChannelPickerSheetProps {
  visible: boolean;
  channels: ChannelItem[];
  activeChannel: ChannelItem | null;
  isLoading?: boolean;
  onClose: () => void;
  onSelectChannel: (channel: ChannelItem) => void;
}

// Vibrant palette for channel avatars
const AVATAR_COLORS = [
  '#2563EB', // Royal Blue
  '#7C3AED', // Purple
  '#059669', // Emerald Green
  '#D97706', // Amber
  '#DB2777', // Pink
  '#0891B2', // Cyan
  '#EA580C', // Orange
  '#4F46E5', // Indigo
];

function getAvatarColor(name: string): string {
  if (name.toLowerCase().includes('saved')) return '#0088CC'; // Telegram Blue
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % AVATAR_COLORS.length;
  return AVATAR_COLORS[index];
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
    const isSavedMessages = ch.name.toLowerCase().includes('saved');
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
            <Text style={styles.metaCount}>
              {ch.media_count !== undefined
                ? `${ch.media_count} ${ch.media_count === 1 ? 'item' : 'items'}`
                : 'Telegram Vault'}
            </Text>
            {isSavedMessages && (
              <View style={styles.savedBadge}>
                <Text style={styles.savedBadgeText}>Private</Text>
              </View>
            )}
          </View>
        </View>

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
        <View
          style={styles.sheetContainer}
          onStartShouldSetResponder={() => true}
        >
          {/* Top Handle */}
          <View style={styles.sheetHandle} />

          {/* Header Row */}
          <View style={styles.sheetHeader}>
            <View style={styles.titleGroup}>
              <Text style={styles.sheetTitle}>Telegram Channels</Text>
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

          {/* Search Filter Bar */}
          {channels.length > 4 && (
            <View style={styles.searchContainer}>
              <Search size={16} color="#9CA3AF" strokeWidth={2.2} style={styles.searchIcon} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search channels..."
                placeholderTextColor="#9CA3AF"
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoCorrect={false}
                clearButtonMode="while-editing"
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
              isLoading && channels.length === 0 ? (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="small" color="#1A73E8" />
                  <Text style={styles.loadingText}>Syncing channels from Telegram...</Text>
                </View>
              ) : (
                <View style={styles.emptyContainer}>
                  <Text style={styles.emptyText}>
                    {searchQuery ? 'No matching channels found' : 'No Telegram channels found'}
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
    paddingBottom: 12,
  },
  titleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '700',
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
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    marginHorizontal: 16,
    marginBottom: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    height: 40,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
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
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  channelDetails: {
    flex: 1,
  },
  channelTitle: {
    fontSize: 15,
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
    fontSize: 12.5,
    color: '#6B7280',
    fontWeight: '500',
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
  activeCheckCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#1A73E8',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  inactiveRadioCircle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: '#D1D5DB',
    marginLeft: 8,
  },
  loadingContainer: {
    padding: 36,
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 13,
    color: '#6B7280',
    fontWeight: '500',
  },
  emptyContainer: {
    padding: 32,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: '#9CA3AF',
    fontWeight: '500',
  },
});
