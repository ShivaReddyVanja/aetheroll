import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Cloud, RefreshCw, ChevronDown } from 'lucide-react-native';
import { BrandLogo } from './BrandLogo';

interface HeaderProps {
  channelName?: string;
  userName?: string;
  isSyncing?: boolean;
  onSelectChannel?: () => void;
  onOpenProfile?: () => void;
  onSync?: () => void;
}

export function Header({
  channelName = 'Private Channel',
  userName = 'User',
  isSyncing = false,
  onSelectChannel,
  onOpenProfile,
  onSync,
}: HeaderProps) {
  const insets = useSafeAreaInsets();
  const initial = (userName || 'U').charAt(0).toUpperCase();

  return (
    <View style={[styles.headerContainer, { paddingTop: insets.top > 0 ? insets.top : 8 }]}>
      <View style={styles.headerContent}>
        {/* Left: Brand Logo & Channel Chip */}
        <View style={styles.leftGroup}>
          <BrandLogo size={28} />
          <TouchableOpacity
            style={styles.channelChip}
            onPress={onSelectChannel}
            activeOpacity={0.7}
          >
            <View style={styles.channelIconDot} />
            <Text style={styles.channelText} numberOfLines={1}>
              {channelName}
            </Text>
            <ChevronDown size={14} color="#6B7280" strokeWidth={2.5} />
          </TouchableOpacity>
        </View>

        {/* Right: Cloud Sync & Profile Avatar */}
        <View style={styles.rightGroup}>
          {onSync && (
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={onSync}
              activeOpacity={0.7}
            >
              {isSyncing ? (
                <RefreshCw size={16} color="#1A73E8" strokeWidth={2.2} />
              ) : (
                <Cloud size={16} color="#4B5563" strokeWidth={2.2} />
              )}
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={styles.avatarBtn}
            onPress={onOpenProfile}
            activeOpacity={0.8}
          >
            <View style={styles.avatarCircle}>
              <Text style={styles.avatarText}>{initial}</Text>
            </View>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  headerContainer: {
    backgroundColor: '#FFFFFF',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  headerContent: {
    height: 48,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  leftGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  channelChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingHorizontal: 10,
    paddingVertical: 4.5,
    borderRadius: 18,
    maxWidth: 200,
    gap: 5,
  },
  channelIconDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#1A73E8',
  },
  channelText: {
    color: '#1F2937',
    fontSize: 12.5,
    fontWeight: '600',
    maxWidth: 130,
  },
  chevron: {
    color: '#6B7280',
    fontSize: 10,
    marginLeft: 1,
  },
  rightGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarBtn: {
    padding: 1,
  },
  avatarCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#1A73E8',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#E8F0FE',
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
});
