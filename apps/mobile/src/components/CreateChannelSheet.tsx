import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Pressable,
  Platform,
  Dimensions,
  ActivityIndicator,
  ScrollView,
  Keyboard,
  KeyboardEvent,
} from 'react-native';
import { X, Lock, Globe, Plus, Sparkles } from 'lucide-react-native';
import { apiFetch } from '../services/api';
import { ChannelItem } from './ChannelPickerSheet';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

interface CreateChannelSheetProps {
  visible: boolean;
  onClose: () => void;
  onCreateSuccess: (channel: ChannelItem) => void;
}

export function CreateChannelSheet({
  visible,
  onClose,
  onCreateSuccess,
}: CreateChannelSheetProps) {
  const [title, setTitle] = useState('');
  const [about, setAbout] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    if (visible) {
      setTitle('');
      setAbout('');
      setIsPublic(false);
      setUsername('');
      setErrorMsg(null);
    }
  }, [visible]);

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

  const handleCreate = async () => {
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setErrorMsg('Please enter an album name.');
      return;
    }

    if (isPublic) {
      const cleanUsername = username.trim().replace(/^@/, '');
      if (!/^[a-zA-Z0-9_]{5,32}$/.test(cleanUsername)) {
        setErrorMsg('Public username must be 5-32 letters, numbers, or underscores.');
        return;
      }
    }

    setErrorMsg(null);
    setLoading(true);

    try {
      const res = await apiFetch('/api/channels/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: cleanTitle,
          about: about.trim() || undefined,
          is_megagroup: false,
          is_public: isPublic,
          username: isPublic ? username.trim().replace(/^@/, '') : undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to create channel');
      }

      // Reset form
      setTitle('');
      setAbout('');
      setIsPublic(false);
      setUsername('');

      onCreateSuccess(data.channel);
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to create channel. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Calculate dynamic max height when keyboard is active
  const dynamicMaxHeight = keyboardHeight > 0
    ? Math.max(280, SCREEN_HEIGHT - keyboardHeight - (Platform.OS === 'android' ? 50 : 70))
    : SCREEN_HEIGHT * 0.88;

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={[styles.backdrop, { paddingBottom: keyboardHeight }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        
        <View style={[styles.sheetContainer, { maxHeight: dynamicMaxHeight }]}>
          {/* Top Drag Handle */}
          <View style={styles.sheetHandle} />

          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
            bounces={false}
          >
            {/* Header */}
            <View style={styles.sheetHeader}>
              <View style={styles.titleGroup}>
                <View style={styles.iconBadge}>
                  <Sparkles size={16} color="#1A73E8" strokeWidth={2.5} />
                </View>
                <Text style={styles.sheetTitle}>Create New Album</Text>
              </View>
              <TouchableOpacity
                style={styles.closeBtn}
                onPress={onClose}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <X size={18} color="#4B5563" strokeWidth={2.2} />
              </TouchableOpacity>
            </View>

            {errorMsg && (
              <View style={styles.errorAlert}>
                <Text style={styles.errorAlertText}>{errorMsg}</Text>
              </View>
            )}

            {/* Album Title */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>ALBUM NAME *</Text>
              <TextInput
                style={styles.textInput}
                placeholder="e.g. Family Archive, Paris Trip 2026"
                placeholderTextColor="#9CA3AF"
                value={title}
                onChangeText={(t) => {
                  setTitle(t);
                  if (errorMsg) setErrorMsg(null);
                }}
                autoFocus={true}
                maxLength={60}
              />
            </View>

            {/* Description (Optional) */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>DESCRIPTION (OPTIONAL)</Text>
              <TextInput
                style={[styles.textInput, styles.textArea]}
                placeholder="What will you store in this album?"
                placeholderTextColor="#9CA3AF"
                value={about}
                onChangeText={setAbout}
                multiline={true}
                numberOfLines={2}
                maxLength={200}
              />
            </View>

            {/* Privacy Toggle */}
            <View style={styles.privacySection}>
              <Text style={styles.inputLabel}>PRIVACY TYPE</Text>
              <View style={styles.toggleRow}>
                <TouchableOpacity
                  style={[styles.toggleBtn, !isPublic && styles.toggleBtnActive]}
                  onPress={() => setIsPublic(false)}
                  activeOpacity={0.7}
                >
                  <Lock size={15} color={!isPublic ? '#1A73E8' : '#6B7280'} strokeWidth={2.2} />
                  <View style={styles.toggleTextGroup}>
                    <Text style={[styles.toggleTitle, !isPublic && styles.toggleTitleActive]}>
                      Private Album
                    </Text>
                    <Text style={styles.toggleSub}>Only invited friends</Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.toggleBtn, isPublic && styles.toggleBtnActive]}
                  onPress={() => setIsPublic(true)}
                  activeOpacity={0.7}
                >
                  <Globe size={15} color={isPublic ? '#1A73E8' : '#6B7280'} strokeWidth={2.2} />
                  <View style={styles.toggleTextGroup}>
                    <Text style={[styles.toggleTitle, isPublic && styles.toggleTitleActive]}>
                      Shared Public Album
                    </Text>
                    <Text style={styles.toggleSub}>Anyone with link</Text>
                  </View>
                </TouchableOpacity>
              </View>
            </View>

            {/* Public Username Input (if public) */}
            {isPublic && (
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>TELEGRAM USERNAME *</Text>
                <View style={styles.usernameInputRow}>
                  <Text style={styles.usernamePrefix}>t.me/</Text>
                  <TextInput
                    style={styles.usernameInput}
                    placeholder="my_public_album"
                    placeholderTextColor="#9CA3AF"
                    value={username}
                    onChangeText={setUsername}
                    autoCapitalize="none"
                    autoCorrect={false}
                    maxLength={32}
                  />
                </View>
              </View>
            )}

            {/* Submit Button */}
            <TouchableOpacity
              style={[styles.submitBtn, loading && styles.submitBtnDisabled]}
              onPress={handleCreate}
              disabled={loading}
              activeOpacity={0.8}
            >
              {loading ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <Plus size={18} color="#FFFFFF" strokeWidth={2.5} />
                  <Text style={styles.submitBtnText}>Create & Open Album</Text>
                </>
              )}
            </TouchableOpacity>
          </ScrollView>
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
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === 'ios' ? 36 : 24,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F3F4F6',
    marginBottom: 16,
  },
  titleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
  },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorAlert: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FEE2E2',
    padding: 10,
    borderRadius: 12,
    marginBottom: 14,
  },
  errorAlertText: {
    color: '#DC2626',
    fontSize: 12.5,
    fontWeight: '500',
  },
  inputGroup: {
    marginBottom: 14,
  },
  inputLabel: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#6B7280',
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  textInput: {
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: '#1F2937',
  },
  textArea: {
    minHeight: 52,
    textAlignVertical: 'top',
  },
  privacySection: {
    marginBottom: 14,
  },
  toggleRow: {
    flexDirection: 'row',
    gap: 10,
  },
  toggleBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: '#F9FAFB',
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
  },
  toggleBtnActive: {
    backgroundColor: '#EFF6FF',
    borderColor: '#3B82F6',
  },
  toggleTextGroup: {
    flex: 1,
  },
  toggleTitle: {
    fontSize: 12.5,
    fontWeight: '600',
    color: '#4B5563',
  },
  toggleTitleActive: {
    color: '#1D4ED8',
    fontWeight: '700',
  },
  toggleSub: {
    fontSize: 10,
    color: '#9CA3AF',
  },
  usernameInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 14,
    paddingHorizontal: 14,
  },
  usernamePrefix: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7280',
  },
  usernameInput: {
    flex: 1,
    paddingVertical: 10,
    fontSize: 14,
    color: '#1F2937',
  },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1A73E8',
    paddingVertical: 13,
    borderRadius: 16,
    gap: 8,
    marginTop: 6,
    marginBottom: 8,
    shadowColor: '#1A73E8',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  submitBtnDisabled: {
    opacity: 0.65,
  },
  submitBtnText: {
    color: '#FFFFFF',
    fontSize: 14.5,
    fontWeight: '700',
  },
});
