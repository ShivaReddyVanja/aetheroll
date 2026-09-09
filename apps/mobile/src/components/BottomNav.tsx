import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Image as PhotosIcon,
  Star as StarIcon,
  CloudUpload as BackupIcon,
  Settings as SettingsIcon,
} from 'lucide-react-native';

export type TabType = 'gallery' | 'favorites' | 'upload' | 'settings';

interface BottomNavProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  pendingUploadCount?: number;
}

export function BottomNav({ activeTab, onTabChange, pendingUploadCount = 0 }: BottomNavProps) {
  const insets = useSafeAreaInsets();

  const tabs: Array<{
    id: TabType;
    label: string;
    renderIcon: (color: string) => React.ReactNode;
  }> = [
    {
      id: 'gallery',
      label: 'Photos',
      renderIcon: (color) => <PhotosIcon size={20} color={color} strokeWidth={2.2} />,
    },
    {
      id: 'favorites',
      label: 'Favorites',
      renderIcon: (color) => <StarIcon size={20} color={color} strokeWidth={2.2} />,
    },
    {
      id: 'upload',
      label: 'Backup',
      renderIcon: (color) => <BackupIcon size={20} color={color} strokeWidth={2.2} />,
    },
    {
      id: 'settings',
      label: 'Settings',
      renderIcon: (color) => <SettingsIcon size={20} color={color} strokeWidth={2.2} />,
    },
  ];

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.floatingContainer,
        {
          bottom: insets.bottom > 0 ? insets.bottom + 8 : 16,
        },
      ]}
    >
      <View style={styles.dockBar}>
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          const contentColor = isActive ? '#001D35' : '#5F6368';

          return (
            <TouchableOpacity
              key={tab.id}
              style={[styles.tabItem, isActive && styles.tabItemActive]}
              onPress={() => onTabChange(tab.id)}
              activeOpacity={0.7}
            >
              <View style={styles.iconWrapper}>
                {tab.renderIcon(contentColor)}
                {tab.id === 'upload' && pendingUploadCount > 0 && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{pendingUploadCount}</Text>
                  </View>
                )}
              </View>
              <Text style={[styles.label, isActive && styles.activeLabel]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  floatingContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 99,
  },
  dockBar: {
    backgroundColor: '#FFFFFF',
    borderRadius: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 14,
    elevation: 6,
    width: '92%',
    maxWidth: 390,
    gap: 4,
  },
  tabItem: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    paddingVertical: 6,
    paddingHorizontal: 6,
    borderRadius: 22,
    backgroundColor: 'transparent',
  },
  tabItemActive: {
    backgroundColor: '#C2E7FF',
  },
  iconWrapper: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -8,
    backgroundColor: '#1A73E8',
    borderRadius: 8,
    paddingHorizontal: 4,
    paddingVertical: 1,
    minWidth: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#FFFFFF',
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '800',
  },
  label: {
    color: '#5F6368',
    fontSize: 11,
    fontWeight: '500',
    marginTop: 2,
  },
  activeLabel: {
    color: '#001D35',
    fontWeight: '700',
  },
});
