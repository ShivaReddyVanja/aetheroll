import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  Linking,
  StatusBar,
  Modal,
  Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  Zap,
  Share2,
  UploadCloud,
  Check,
  X,
  KeyRound,
  Send,
  ExternalLink,
  Lock,
  Sparkles,
  CheckCircle2,
  PauseCircle,
} from 'lucide-react-native';

import { redeemActivationCode } from '../services/api';

export interface PremiumMembershipScreenProps {
  onBack?: () => void;
  userTier?: 'free' | 'premium' | 'admin';
  isTierHeld?: boolean;
  tierHoldReason?: string | null;
  onRedeemSuccess?: (tier: string) => void;
}

export function PremiumMembershipScreen({
  onBack,
  userTier = 'free',
  isTierHeld = false,
  tierHoldReason = null,
  onRedeemSuccess,
}: PremiumMembershipScreenProps) {
  const insets = useSafeAreaInsets();
  const [code, setCode] = useState('');
  const [isRedeeming, setIsRedeeming] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [activatedTier, setActivatedTier] = useState<string>('premium');
  const [currentTier, setCurrentTier] = useState<'free' | 'premium' | 'admin'>(userTier);

  React.useEffect(() => {
    setCurrentTier(userTier);
  }, [userTier]);

  const isPro = (currentTier === 'premium' || currentTier === 'admin') && !isTierHeld;

  const handleRedeemCode = async () => {
    const cleanCode = code.trim().toUpperCase();
    if (!cleanCode) {
      Alert.alert('Activation Code', 'Please enter your activation code.');
      return;
    }

    setIsRedeeming(true);
    setStatusMessage(null);

    try {
      const res = await redeemActivationCode(cleanCode);
      setIsRedeeming(false);
      if (res.success && res.tier) {
        setActivatedTier(res.tier);
        setCurrentTier(res.tier as any);
        setCode('');
        setShowSuccessModal(true);
      } else {
        setStatusMessage({
          type: 'error',
          text: res.error || 'Invalid or expired code. Please try again.',
        });
      }
    } catch (err: any) {
      setIsRedeeming(false);
      setStatusMessage({
        type: 'error',
        text: err?.message || 'Failed to activate code. Please try again.',
      });
    }
  };

  const handleDismissSuccessModal = () => {
    setShowSuccessModal(false);
    if (onRedeemSuccess) {
      onRedeemSuccess(activatedTier);
    }
    if (onBack) {
      onBack();
    }
  };

  const handleRequestTelegramAccess = () => {
    Linking.openURL('https://t.me/builtbyshiva').catch(() => {
      Alert.alert('Telegram', 'Please contact @builtbyshiva on Telegram.');
    });
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="dark-content" />

      {/* Header */}
      <View style={styles.header}>
        {onBack ? (
          <TouchableOpacity
            style={styles.backButton}
            onPress={onBack}
            activeOpacity={0.7}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <ArrowLeft size={20} color="#0F172A" />
          </TouchableOpacity>
        ) : (
          <View style={{ width: 36 }} />
        )}

        <View style={styles.headerTitleRow}>
          <Text style={styles.headerTitle}>Pro Membership</Text>
          <View
            style={[
              styles.proBadge,
              isTierHeld && { backgroundColor: '#FFFBEB', borderColor: '#FDE68A' },
              !isTierHeld && isPro && { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' },
            ]}
          >
            <Text
              style={[
                styles.proBadgeText,
                isTierHeld && { color: '#D97706' },
                !isTierHeld && isPro && { color: '#059669' },
              ]}
            >
              {isTierHeld ? '⏸ ON HOLD' : isPro ? '✓ ACTIVE' : '⚡ PRO'}
            </Text>
          </View>
        </View>

        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* 1. Status or Redeem Code Section (ON TOP) */}
        {isTierHeld ? (
          <View style={[styles.groupCard, { marginTop: 12, borderColor: '#FDE68A', backgroundColor: '#FFFDF5' }]}>
            <View style={styles.cardPadding}>
              <View style={styles.rowHeader}>
                <View style={[styles.iconBox, { backgroundColor: '#FEF3C7' }]}>
                  <PauseCircle size={20} color="#D97706" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowLabel, { color: '#92400E' }]}>Pro Access on Hold</Text>
                  <Text style={styles.rowSubtitle}>
                    {tierHoldReason
                      ? `Your Pro subscription has been paused: ${tierHoldReason}`
                      : 'Your Pro subscription is temporarily paused. Please contact support.'}
                  </Text>
                </View>
              </View>

              <TouchableOpacity
                style={[styles.requestButton, { marginTop: 14, borderColor: '#FCD34D', backgroundColor: '#FFFFFF' }]}
                onPress={handleRequestTelegramAccess}
                activeOpacity={0.7}
              >
                <Send size={14} color="#B45309" />
                <Text style={[styles.requestButtonText, { color: '#92400E' }]}>Contact Support via Telegram</Text>
                <ExternalLink size={12} color="#D97706" />
              </TouchableOpacity>
            </View>
          </View>
        ) : isPro ? (
          <View style={[styles.groupCard, { marginTop: 12 }]}>
            <View style={styles.cardPadding}>
              <View style={styles.rowHeader}>
                <View style={[styles.iconBox, { backgroundColor: '#ECFDF5' }]}>
                  <CheckCircle2 size={20} color="#059669" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowLabel}>Pro Active</Text>
                  <Text style={styles.rowSubtitle}>
                    All Pro features are active on this account.
                  </Text>
                </View>
              </View>
            </View>
          </View>
        ) : (
          <View style={[styles.groupCard, { marginTop: 12 }]}>
            <View style={styles.cardPadding}>
              <View style={styles.rowHeader}>
                <View style={[styles.iconBox, { backgroundColor: '#FAF5FF' }]}>
                  <KeyRound size={18} color="#7C3AED" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowLabel}>Enter Activation Code</Text>
                  <Text style={styles.rowSubtitle}>
                    Unlock Pro features immediately.
                  </Text>
                </View>
              </View>

              <View style={styles.inputRow}>
                <TextInput
                  style={styles.textInput}
                  placeholder="PRO-XXXX-XXXX"
                  placeholderTextColor="#94A3B8"
                  value={code}
                  onChangeText={(text) => setCode(text.toUpperCase())}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  editable={!isRedeeming}
                />

                <TouchableOpacity
                  style={[styles.redeemButton, isRedeeming && { opacity: 0.6 }]}
                  onPress={handleRedeemCode}
                  activeOpacity={0.8}
                  disabled={isRedeeming}
                >
                  {isRedeeming ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.redeemButtonText}>Redeem</Text>
                  )}
                </TouchableOpacity>
              </View>

              {statusMessage && (
                <View
                  style={[
                    styles.statusBanner,
                    statusMessage.type === 'success' ? styles.statusSuccess : styles.statusError,
                  ]}
                >
                  <Text
                    style={[
                      styles.statusBannerText,
                      statusMessage.type === 'success' ? styles.statusSuccessText : styles.statusErrorText,
                    ]}
                  >
                    {statusMessage.text}
                  </Text>
                </View>
              )}

              <View style={styles.orDividerRow}>
                <View style={styles.orDividerLine} />
                <Text style={styles.orDividerText}>OR</Text>
                <View style={styles.orDividerLine} />
              </View>

              <TouchableOpacity
                style={styles.requestButton}
                onPress={handleRequestTelegramAccess}
                activeOpacity={0.7}
              >
                <Send size={14} color="#475569" />
                <Text style={styles.requestButtonText}>Request Code via Telegram</Text>
                <ExternalLink size={12} color="#94A3B8" />
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* 2. Pro Features */}
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>Pro Features</Text>
          <View style={styles.groupCard}>
            {/* Feature 1 */}
            <View style={styles.benefitRow}>
              <View style={[styles.iconBox, { backgroundColor: '#EEF2FF' }]}>
                <Zap size={18} color="#4F46E5" />
              </View>
              <View style={styles.rowTextCol}>
                <Text style={styles.rowLabel}>Instant 4K Playback</Text>
                <Text style={styles.rowSubtitle}>
                  Play and scrub large 4K videos with zero buffering.
                </Text>
              </View>
            </View>

            <View style={styles.divider} />

            {/* Feature 2 */}
            <View style={styles.benefitRow}>
              <View style={[styles.iconBox, { backgroundColor: '#FAF5FF' }]}>
                <Share2 size={18} color="#7C3AED" />
              </View>
              <View style={styles.rowTextCol}>
                <Text style={styles.rowLabel}>Public Link Sharing</Text>
                <Text style={styles.rowSubtitle}>
                  Share photos and videos with friends using clean web links.
                </Text>
              </View>
            </View>

            <View style={styles.divider} />

            {/* Feature 3 */}
            <View style={styles.benefitRow}>
              <View style={[styles.iconBox, { backgroundColor: '#FDF2F8' }]}>
                <UploadCloud size={18} color="#DB2777" />
              </View>
              <View style={styles.rowTextCol}>
                <Text style={styles.rowLabel}>High-Speed Uploads</Text>
                <Text style={styles.rowSubtitle}>
                  Back up heavy videos and large albums at maximum speed.
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* 3. Comparison */}
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>Comparison</Text>
          <View style={styles.groupCard}>
            <View style={styles.compHeaderRow}>
              <Text style={[styles.compColTitle, { flex: 1.8 }]}>Feature</Text>
              <Text style={[styles.compColTitle, { flex: 1, textAlign: 'center' }]}>Free</Text>
              <Text style={[styles.compColTitle, { flex: 1, textAlign: 'center', color: '#7C3AED' }]}>Pro ⚡</Text>
            </View>
            <View style={styles.fullDivider} />

            <View style={styles.compRow}>
              <Text style={[styles.compFeatureText, { flex: 1.8 }]}>Cloud Storage</Text>
              <Text style={[styles.compValText, { flex: 1, textAlign: 'center' }]}>Unlimited</Text>
              <Text style={[styles.compValText, { flex: 1, textAlign: 'center', color: '#059669' }]}>Unlimited</Text>
            </View>
            <View style={styles.fullDivider} />

            <View style={styles.compRow}>
              <Text style={[styles.compFeatureText, { flex: 1.8 }]}>4K Video Playback</Text>
              <Text style={[styles.compValText, { flex: 1, textAlign: 'center', color: '#64748B' }]}>Standard</Text>
              <Text style={[styles.compValText, { flex: 1, textAlign: 'center', color: '#4F46E5', fontWeight: '700' }]}>⚡ Instant</Text>
            </View>
            <View style={styles.fullDivider} />

            <View style={styles.compRow}>
              <Text style={[styles.compFeatureText, { flex: 1.8 }]}>Public Link Sharing</Text>
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Lock size={15} color="#94A3B8" />
              </View>
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Check size={16} color="#059669" />
              </View>
            </View>
            <View style={styles.fullDivider} />

            <View style={styles.compRow}>
              <Text style={[styles.compFeatureText, { flex: 1.8 }]}>Upload Speed</Text>
              <Text style={[styles.compValText, { flex: 1, textAlign: 'center', color: '#64748B' }]}>Standard</Text>
              <Text style={[styles.compValText, { flex: 1, textAlign: 'center', color: '#059669', fontWeight: '700' }]}>⚡ Fast</Text>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Custom Clean Celebration Success Modal */}
      <Modal
        visible={showSuccessModal}
        transparent={true}
        animationType="fade"
        statusBarTranslucent={true}
        onRequestClose={handleDismissSuccessModal}
      >
        <Pressable style={styles.successBackdrop} onPress={handleDismissSuccessModal}>
          <View style={styles.successCard} onStartShouldSetResponder={() => true}>
            <View style={styles.successIconCircle}>
              <Sparkles size={28} color="#7C3AED" />
            </View>

            <Text style={styles.successTitle}>Welcome to Pro! ⚡</Text>
            <Text style={styles.successSubtitle}>
              Your account has been upgraded successfully. All Pro features are now active.
            </Text>

            <View style={styles.successFeaturesList}>
              <View style={styles.successFeatureRow}>
                <CheckCircle2 size={16} color="#059669" />
                <Text style={styles.successFeatureText}>Instant 4K playback with zero buffering</Text>
              </View>
              <View style={styles.successFeatureRow}>
                <CheckCircle2 size={16} color="#059669" />
                <Text style={styles.successFeatureText}>Public link sharing with web player</Text>
              </View>
              <View style={styles.successFeatureRow}>
                <CheckCircle2 size={16} color="#059669" />
                <Text style={styles.successFeatureText}>High-speed turbo edge cloud uploads</Text>
              </View>
            </View>

            <TouchableOpacity
              style={styles.successContinueBtn}
              activeOpacity={0.85}
              onPress={handleDismissSuccessModal}
            >
              <Text style={styles.successContinueBtnText}>Continue to Gallery</Text>
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
    backgroundColor: '#F8FAFC',
  },
  header: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1F5F9',
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  proBadge: {
    backgroundColor: '#FAF5FF',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E9D5FF',
  },
  proBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#7C3AED',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 110,
  },
  titleContainer: {
    marginBottom: 14,
    paddingHorizontal: 4,
  },
  screenTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.5,
  },
  screenSubtitle: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 2,
  },
  cardPadding: {
    padding: 16,
    gap: 12,
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  section: {
    marginTop: 18,
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
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
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
    paddingRight: 4,
  },
  rowLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1E293B',
    marginBottom: 2,
  },
  rowSubtitle: {
    fontSize: 12,
    color: '#64748B',
    lineHeight: 16,
  },
  divider: {
    height: 1,
    backgroundColor: '#F1F5F9',
    marginLeft: 65,
  },
  fullDivider: {
    height: 1,
    backgroundColor: '#F1F5F9',
  },
  compHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    paddingHorizontal: 16,
    backgroundColor: '#F8FAFC',
  },
  compColTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  compRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  compFeatureText: {
    fontSize: 13,
    color: '#1E293B',
    fontWeight: '500',
  },
  compValText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1E293B',
  },
  inputRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 2,
  },
  textInput: {
    flex: 1,
    height: 44,
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    paddingHorizontal: 14,
    color: '#0F172A',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
  },
  redeemButton: {
    height: 44,
    paddingHorizontal: 18,
    borderRadius: 10,
    backgroundColor: '#7C3AED',
    alignItems: 'center',
    justifyContent: 'center',
  },
  redeemButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  statusBanner: {
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  statusSuccess: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  statusError: {
    backgroundColor: '#FFF1F2',
    borderColor: '#FECDD3',
  },
  statusBannerText: {
    fontSize: 12,
    fontWeight: '600',
  },
  statusSuccessText: {
    color: '#059669',
  },
  statusErrorText: {
    color: '#E11D48',
  },
  orDividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginVertical: 2,
  },
  orDividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#E2E8F0',
  },
  orDividerText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#94A3B8',
  },
  requestButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 42,
    borderRadius: 10,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  requestButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
  },
  extendCodeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginTop: 4,
  },
  extendCodeBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
  },
  successBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  successCard: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 8,
  },
  successIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#FAF5FF',
    borderWidth: 1.5,
    borderColor: '#E9D5FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  successTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.4,
    marginBottom: 6,
    textAlign: 'center',
  },
  successSubtitle: {
    fontSize: 13,
    color: '#64748B',
    lineHeight: 18,
    textAlign: 'center',
    marginBottom: 18,
  },
  successFeaturesList: {
    width: '100%',
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 14,
    gap: 10,
    marginBottom: 20,
  },
  successFeatureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  successFeatureText: {
    flex: 1,
    fontSize: 12,
    color: '#334155',
    fontWeight: '500',
  },
  successContinueBtn: {
    width: '100%',
    height: 48,
    borderRadius: 12,
    backgroundColor: '#7C3AED',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#7C3AED',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 3,
  },
  successContinueBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
});
