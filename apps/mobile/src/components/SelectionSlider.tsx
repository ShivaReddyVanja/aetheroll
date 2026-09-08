import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Modal,
  TextInput,
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiFetch } from '../services/api';

interface SelectionSliderProps {
  selectedIds: Set<string>;
  totalCount: number;
  channelId?: string;
  onClearSelection: () => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onDeleteSelected: (ids: string[]) => Promise<void>;
  onFavoriteSelected: (ids: string[]) => Promise<void>;
  onActionComplete: () => void;
}

type ActiveSheet = 'tag' | 'trip' | 'event' | null;

interface MetaItem {
  id: string;
  name: string;
  color?: string;
}

/** Crisp Vector Icons (Zero Emojis) */
function FavoriteIcon({ color = '#F59E0B' }: { color?: string }) {
  return <Text style={[styles.iconStar, { color }]}>★</Text>;
}

function TagIcon({ color = '#1A73E8' }: { color?: string }) {
  return (
    <View style={[styles.tagIconWrapper, { borderColor: color }]}>
      <View style={[styles.tagIconDot, { backgroundColor: color }]} />
    </View>
  );
}

function TripIcon({ color = '#10B981' }: { color?: string }) {
  return (
    <View style={[styles.tripIconCircle, { borderColor: color }]}>
      <Text style={[styles.tripIconArrow, { color }]}>▲</Text>
    </View>
  );
}

function EventIcon({ color = '#8B5CF6' }: { color?: string }) {
  return (
    <View style={[styles.eventIconBox, { borderColor: color }]}>
      <View style={[styles.eventIconHeader, { backgroundColor: color }]} />
      <View style={styles.eventIconGrid}>
        <View style={[styles.eventIconDot, { backgroundColor: color }]} />
        <View style={[styles.eventIconDot, { backgroundColor: color }]} />
        <View style={[styles.eventIconDot, { backgroundColor: color }]} />
      </View>
    </View>
  );
}

function SelectAllIcon({ isAllSelected }: { isAllSelected: boolean }) {
  return (
    <View style={[styles.selectAllBox, isAllSelected && styles.selectAllBoxActive]}>
      <Text style={[styles.selectAllCheck, isAllSelected && styles.selectAllCheckActive]}>
        ✓
      </Text>
    </View>
  );
}

function DeleteIcon({ color = '#DC2626' }: { color?: string }) {
  return (
    <View style={styles.trashContainer}>
      <View style={[styles.trashHandle, { backgroundColor: color }]} />
      <View style={[styles.trashLid, { backgroundColor: color }]} />
      <View style={[styles.trashBody, { borderColor: color }]}>
        <View style={[styles.trashLine, { backgroundColor: color }]} />
        <View style={[styles.trashLine, { backgroundColor: color }]} />
      </View>
    </View>
  );
}

function ThreeDotsIcon() {
  return (
    <View style={styles.threeDotsWrapper}>
      <View style={styles.threeDot} />
      <View style={styles.threeDot} />
      <View style={styles.threeDot} />
    </View>
  );
}

export function SelectionSlider({
  selectedIds,
  totalCount,
  channelId,
  onClearSelection,
  onSelectAll,
  onDeselectAll,
  onDeleteSelected,
  onFavoriteSelected,
  onActionComplete,
}: SelectionSliderProps) {
  const insets = useSafeAreaInsets();
  const count = selectedIds.size;
  const isAllSelected = count > 0 && count === totalCount;

  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [activeSheet, setActiveSheet] = useState<ActiveSheet>(null);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<MetaItem[]>([]);
  const [newItemName, setNewItemName] = useState('');

  const mediaItemIds = Array.from(selectedIds);

  useEffect(() => {
    if (activeSheet && channelId) {
      loadMetadata(activeSheet);
    }
  }, [activeSheet, channelId]);

  const loadMetadata = async (type: ActiveSheet) => {
    try {
      setLoading(true);
      let endpoint = '';
      if (type === 'tag') endpoint = `/api/tags/user-tags?channel_id=${channelId}`;
      if (type === 'trip') endpoint = `/api/trips?channel_id=${channelId}`;
      if (type === 'event') endpoint = `/api/tags/events?channel_id=${channelId}`;

      const res = await apiFetch(endpoint);
      const data = await res.json();
      if (type === 'tag') setItems(data.tags || []);
      if (type === 'trip') setItems(data.trips || []);
      if (type === 'event') setItems(data.events || []);
    } catch (err) {
      console.warn('Load metadata error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleApplyItem = async (itemId: string) => {
    setLoading(true);
    try {
      if (activeSheet === 'tag') {
        await apiFetch('/api/tags/media-tag', {
          method: 'POST',
          body: JSON.stringify({ media_item_ids: mediaItemIds, tag_id: itemId }),
        });
      } else if (activeSheet === 'trip') {
        await apiFetch(`/api/trips/${itemId}/media`, {
          method: 'POST',
          body: JSON.stringify({ media_item_ids: mediaItemIds }),
        });
      } else if (activeSheet === 'event') {
        await apiFetch('/api/tags/media-event', {
          method: 'POST',
          body: JSON.stringify({ media_item_ids: mediaItemIds, event_id: itemId }),
        });
      }
      setActiveSheet(null);
      onActionComplete();
    } catch (err: any) {
      Alert.alert('Action Failed', err?.message || 'Could not apply change');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateAndApply = async () => {
    if (!newItemName.trim() || !channelId) return;
    setLoading(true);
    try {
      let createEndpoint = '';
      if (activeSheet === 'tag') createEndpoint = '/api/tags/user-tags';
      if (activeSheet === 'trip') createEndpoint = '/api/trips';
      if (activeSheet === 'event') createEndpoint = '/api/tags/events';

      const res = await apiFetch(createEndpoint, {
        method: 'POST',
        body: JSON.stringify({ channel_id: channelId, name: newItemName.trim() }),
      });
      const data = await res.json();
      const createdId = data.tag?.id || data.trip?.id || data.event?.id;
      if (createdId) {
        await handleApplyItem(createdId);
        setNewItemName('');
      }
    } catch (err: any) {
      Alert.alert('Creation Failed', err?.message || 'Could not create new item');
    } finally {
      setLoading(false);
    }
  };

  const confirmDelete = () => {
    Alert.alert(
      'Delete Selected Media',
      `Delete ${count} ${count === 1 ? 'item' : 'items'} from your Telegram vault?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => onDeleteSelected(mediaItemIds),
        },
      ]
    );
  };

  if (count === 0) return null;

  return (
    <>
      {/* Floating Action Dock: Icon + Text Buttons */}
      <View
        pointerEvents="box-none"
        style={[
          styles.floatingContainer,
          {
            bottom: insets.bottom > 0 ? insets.bottom + 6 : 16,
          },
        ]}
      >
        <View style={styles.dockBar}>
          {/* Left: Close & Count Indicator */}
          <TouchableOpacity
            style={styles.closeCountBtn}
            onPress={onClearSelection}
            activeOpacity={0.7}
          >
            <Text style={styles.closeSymbol}>✕</Text>
            <View style={styles.countBadge}>
              <Text style={styles.countBadgeText}>{count}</Text>
            </View>
          </TouchableOpacity>

          <View style={styles.verticalDivider} />

          {/* Primary Action Buttons (Icon + Text) */}
          <View style={styles.actionsRow}>
            {/* 1. Favourite (Icon & Text) */}
            <TouchableOpacity
              style={styles.actionPillBtn}
              onPress={() => onFavoriteSelected(mediaItemIds)}
              activeOpacity={0.7}
            >
              <FavoriteIcon />
              <Text style={styles.actionPillText}>Favorite</Text>
            </TouchableOpacity>

            {/* 2. Tag (Icon & Text) */}
            <TouchableOpacity
              style={styles.actionPillBtn}
              onPress={() => {
                setNewItemName('');
                setActiveSheet('tag');
              }}
              activeOpacity={0.7}
            >
              <TagIcon />
              <Text style={styles.actionPillText}>Tag</Text>
            </TouchableOpacity>

            {/* 3. Delete (Icon & Text) */}
            <TouchableOpacity
              style={[styles.actionPillBtn, styles.deletePillBtn]}
              onPress={confirmDelete}
              activeOpacity={0.7}
            >
              <DeleteIcon color="#DC2626" />
              <Text style={[styles.actionPillText, styles.deletePillText]}>Delete</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.verticalDivider} />

          {/* 4. Three Dots More Button */}
          <TouchableOpacity
            style={styles.moreCircleBtn}
            onPress={() => setIsMoreOpen(true)}
            activeOpacity={0.7}
          >
            <ThreeDotsIcon />
          </TouchableOpacity>
        </View>
      </View>

      {/* More Actions Sidebar / Bottom Sheet */}
      <Modal
        visible={isMoreOpen}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setIsMoreOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setIsMoreOpen(false)}>
          <View style={styles.bottomSheet} onStartShouldSetResponder={() => true}>
            <View style={styles.sheetHandle} />

            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Actions for {count} {count === 1 ? 'item' : 'items'}</Text>
              <TouchableOpacity
                style={styles.sheetCloseBtn}
                onPress={() => setIsMoreOpen(false)}
              >
                <Text style={styles.sheetCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.moreActionsList} showsVerticalScrollIndicator={false}>
              {/* Favorite Action */}
              <TouchableOpacity
                style={styles.moreActionRow}
                onPress={() => {
                  setIsMoreOpen(false);
                  onFavoriteSelected(mediaItemIds);
                }}
                activeOpacity={0.7}
              >
                <View style={[styles.moreActionIconCircle, { backgroundColor: '#FEF3C7' }]}>
                  <FavoriteIcon color="#D97706" />
                </View>
                <View style={styles.moreActionContent}>
                  <Text style={styles.moreActionTitle}>Favorite</Text>
                  <Text style={styles.moreActionSubtitle}>Toggle favorite status</Text>
                </View>
              </TouchableOpacity>

              {/* Tag Action */}
              <TouchableOpacity
                style={styles.moreActionRow}
                onPress={() => {
                  setIsMoreOpen(false);
                  setNewItemName('');
                  setActiveSheet('tag');
                }}
                activeOpacity={0.7}
              >
                <View style={[styles.moreActionIconCircle, { backgroundColor: '#DBEAFE' }]}>
                  <TagIcon color="#1D4ED8" />
                </View>
                <View style={styles.moreActionContent}>
                  <Text style={styles.moreActionTitle}>Add Tag</Text>
                  <Text style={styles.moreActionSubtitle}>Attach or create custom tags</Text>
                </View>
              </TouchableOpacity>

              {/* Trip Action */}
              <TouchableOpacity
                style={styles.moreActionRow}
                onPress={() => {
                  setIsMoreOpen(false);
                  setNewItemName('');
                  setActiveSheet('trip');
                }}
                activeOpacity={0.7}
              >
                <View style={[styles.moreActionIconCircle, { backgroundColor: '#D1FAE5' }]}>
                  <TripIcon color="#059669" />
                </View>
                <View style={styles.moreActionContent}>
                  <Text style={styles.moreActionTitle}>Add to Trip</Text>
                  <Text style={styles.moreActionSubtitle}>Group items into a travel collection</Text>
                </View>
              </TouchableOpacity>

              {/* Event Action */}
              <TouchableOpacity
                style={styles.moreActionRow}
                onPress={() => {
                  setIsMoreOpen(false);
                  setNewItemName('');
                  setActiveSheet('event');
                }}
                activeOpacity={0.7}
              >
                <View style={[styles.moreActionIconCircle, { backgroundColor: '#EDE9FE' }]}>
                  <EventIcon color="#6D28D9" />
                </View>
                <View style={styles.moreActionContent}>
                  <Text style={styles.moreActionTitle}>Link to Event</Text>
                  <Text style={styles.moreActionSubtitle}>Associate with a special occasion</Text>
                </View>
              </TouchableOpacity>

              {/* Select All / Deselect All Action */}
              <TouchableOpacity
                style={styles.moreActionRow}
                onPress={() => {
                  setIsMoreOpen(false);
                  if (isAllSelected) {
                    onDeselectAll();
                  } else {
                    onSelectAll();
                  }
                }}
                activeOpacity={0.7}
              >
                <View style={[styles.moreActionIconCircle, { backgroundColor: '#F1F5F9' }]}>
                  <SelectAllIcon isAllSelected={isAllSelected} />
                </View>
                <View style={styles.moreActionContent}>
                  <Text style={styles.moreActionTitle}>
                    {isAllSelected ? 'Deselect All' : 'Select All'}
                  </Text>
                  <Text style={styles.moreActionSubtitle}>
                    {totalCount} total media items in this channel
                  </Text>
                </View>
              </TouchableOpacity>

              {/* Delete Action */}
              <TouchableOpacity
                style={[styles.moreActionRow, styles.moreActionDeleteRow]}
                onPress={() => {
                  setIsMoreOpen(false);
                  confirmDelete();
                }}
                activeOpacity={0.7}
              >
                <View style={[styles.moreActionIconCircle, { backgroundColor: '#FEE2E2' }]}>
                  <DeleteIcon color="#DC2626" />
                </View>
                <View style={styles.moreActionContent}>
                  <Text style={[styles.moreActionTitle, { color: '#DC2626' }]}>Delete</Text>
                  <Text style={styles.moreActionSubtitle}>Permanently remove from Telegram vault</Text>
                </View>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </Pressable>
      </Modal>

      {/* Sub-Sheet Modal for Tag / Trip / Event */}
      <Modal
        visible={!!activeSheet}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setActiveSheet(null)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setActiveSheet(null)}>
          <View style={styles.bottomSheet} onStartShouldSetResponder={() => true}>
            <View style={styles.sheetHandle} />

            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>
                {activeSheet === 'tag' && `Add Tag to ${count} Items`}
                {activeSheet === 'trip' && `Add ${count} Items to Trip`}
                {activeSheet === 'event' && `Add ${count} Items to Event`}
              </Text>
              <TouchableOpacity
                style={styles.sheetCloseBtn}
                onPress={() => setActiveSheet(null)}
              >
                <Text style={styles.sheetCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Quick Create Row */}
            <View style={styles.createInputRow}>
              <TextInput
                style={styles.createTextInput}
                placeholder={`New ${activeSheet || 'item'} name...`}
                placeholderTextColor="#9AA0A6"
                value={newItemName}
                onChangeText={setNewItemName}
              />
              <TouchableOpacity
                style={[
                  styles.createSubmitBtn,
                  (!newItemName.trim() || loading) && styles.createBtnDisabled,
                ]}
                onPress={handleCreateAndApply}
                disabled={!newItemName.trim() || loading}
              >
                {loading ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.createSubmitText}>Add</Text>
                )}
              </TouchableOpacity>
            </View>

            {/* Existing Metadata List */}
            <ScrollView style={styles.metaList} showsVerticalScrollIndicator={false}>
              {loading && items.length === 0 ? (
                <View style={styles.loadingBox}>
                  <ActivityIndicator size="small" color="#1A73E8" />
                  <Text style={styles.loadingText}>Loading...</Text>
                </View>
              ) : items.length === 0 ? (
                <Text style={styles.emptyMetaText}>
                  No existing {activeSheet}s. Create one above to apply to selected items.
                </Text>
              ) : (
                items.map((it) => (
                  <TouchableOpacity
                    key={it.id}
                    style={styles.metaItemRow}
                    onPress={() => handleApplyItem(it.id)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.metaItemLeft}>
                      {activeSheet === 'tag' && (
                        <View
                          style={[
                            styles.tagColorDot,
                            { backgroundColor: it.color || '#1A73E8' },
                          ]}
                        />
                      )}
                      <Text style={styles.metaItemName}>{it.name}</Text>
                    </View>
                    <Text style={styles.metaApplyText}>+ Apply</Text>
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  floatingContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 100,
  },
  dockBar: {
    backgroundColor: '#FFFFFF',
    borderRadius: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.14,
    shadowRadius: 18,
    elevation: 10,
    width: '94%',
    maxWidth: 420,
  },
  closeCountBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F3F4',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 4,
  },
  closeSymbol: {
    fontSize: 12,
    color: '#5F6368',
    fontWeight: '800',
  },
  countBadge: {
    backgroundColor: '#1A73E8',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 1,
    minWidth: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
  },
  verticalDivider: {
    width: 1,
    height: 22,
    backgroundColor: '#E8EAED',
    marginHorizontal: 3,
  },
  actionsRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    gap: 4,
  },
  actionPillBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8F9FA',
    paddingHorizontal: 9,
    paddingVertical: 7,
    borderRadius: 16,
    gap: 5,
  },
  actionPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1F1F1F',
  },
  deletePillBtn: {
    backgroundColor: '#FEE2E2',
  },
  deletePillText: {
    color: '#DC2626',
    fontWeight: '700',
  },
  moreCircleBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F1F3F4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  threeDotsWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2.5,
  },
  threeDot: {
    width: 3.5,
    height: 3.5,
    borderRadius: 2,
    backgroundColor: '#5F6368',
  },
  iconStar: {
    fontSize: 15,
    fontWeight: '900',
  },
  tagIconWrapper: {
    width: 13,
    height: 13,
    borderWidth: 1.6,
    borderRadius: 2.5,
    transform: [{ rotate: '45deg' }],
    justifyContent: 'center',
    alignItems: 'center',
  },
  tagIconDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
  },
  tripIconCircle: {
    width: 15,
    height: 15,
    borderRadius: 7.5,
    borderWidth: 1.6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tripIconArrow: {
    fontSize: 7,
    fontWeight: '900',
    marginTop: -1,
  },
  eventIconBox: {
    width: 15,
    height: 15,
    borderRadius: 2.5,
    borderWidth: 1.6,
    padding: 1.2,
    justifyContent: 'space-between',
  },
  eventIconHeader: {
    height: 2.2,
    borderRadius: 1,
  },
  eventIconGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    marginBottom: 0.5,
  },
  eventIconDot: {
    width: 1.8,
    height: 1.8,
    borderRadius: 1,
  },
  selectAllBox: {
    width: 17,
    height: 17,
    borderRadius: 4,
    borderWidth: 1.8,
    borderColor: '#5F6368',
    justifyContent: 'center',
    alignItems: 'center',
  },
  selectAllBoxActive: {
    backgroundColor: '#1A73E8',
    borderColor: '#1A73E8',
  },
  selectAllCheck: {
    fontSize: 10,
    color: 'transparent',
    fontWeight: '900',
  },
  selectAllCheckActive: {
    color: '#FFFFFF',
  },
  trashContainer: {
    width: 15,
    height: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trashHandle: {
    width: 5,
    height: 1.8,
    borderTopLeftRadius: 1,
    borderTopRightRadius: 1,
    marginBottom: 0.8,
  },
  trashLid: {
    width: 13,
    height: 1.8,
    borderRadius: 1,
    marginBottom: 0.8,
  },
  trashBody: {
    width: 10,
    height: 9,
    borderWidth: 1.4,
    borderTopWidth: 0,
    borderBottomLeftRadius: 2,
    borderBottomRightRadius: 2,
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'center',
    paddingTop: 0.5,
  },
  trashLine: {
    width: 1.2,
    height: 4.5,
    borderRadius: 0.6,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'flex-end',
  },
  bottomSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderColor: '#DADCE0',
    maxHeight: '75%',
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
    paddingHorizontal: 20,
  },
  sheetHandle: {
    width: 38,
    height: 4,
    backgroundColor: '#DADCE0',
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 14,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F3F4',
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1F1F1F',
  },
  sheetCloseBtn: {
    padding: 6,
  },
  sheetCloseText: {
    fontSize: 16,
    color: '#5F6368',
    fontWeight: '600',
  },
  moreActionsList: {
    marginTop: 8,
    maxHeight: 380,
  },
  moreActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F3F4',
    gap: 14,
  },
  moreActionDeleteRow: {
    borderBottomWidth: 0,
  },
  moreActionIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreActionContent: {
    flex: 1,
  },
  moreActionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1F1F1F',
    marginBottom: 2,
  },
  moreActionSubtitle: {
    fontSize: 12,
    color: '#5F6368',
  },
  createInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 14,
    marginBottom: 10,
  },
  createTextInput: {
    flex: 1,
    height: 44,
    backgroundColor: '#F1F3F4',
    borderWidth: 1,
    borderColor: '#DADCE0',
    borderRadius: 12,
    paddingHorizontal: 12,
    fontSize: 14,
    color: '#1F1F1F',
  },
  createSubmitBtn: {
    height: 44,
    paddingHorizontal: 16,
    backgroundColor: '#1A73E8',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createBtnDisabled: {
    opacity: 0.5,
  },
  createSubmitText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  metaList: {
    maxHeight: 220,
  },
  metaItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F3F4',
  },
  metaItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  tagColorDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  metaItemName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1F1F1F',
  },
  metaApplyText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1A73E8',
  },
  loadingBox: {
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  loadingText: {
    fontSize: 12,
    color: '#5F6368',
  },
  emptyMetaText: {
    fontSize: 13,
    color: '#5F6368',
    textAlign: 'center',
    paddingVertical: 20,
    lineHeight: 18,
  },
});
