import React, { useState, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Modal,
  FlatList,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiFetch, setSessionToken, getApiBaseUrl, setApiBaseUrl } from '../services/api';
import { saveUserData, getSecureSession, getUserData } from '../services/secureStorage';
import { BrandLogo } from '../components/BrandLogo';

interface PhoneAuthScreenProps {
  onLoginSuccess: (user: any) => void;
}

interface CountryItem {
  code: string;
  dialCode: string;
  name: string;
  flag: string;
}

const ALL_COUNTRIES: CountryItem[] = [
  { code: 'IN', dialCode: '+91', name: 'India', flag: 'IN' },
  { code: 'US', dialCode: '+1', name: 'United States', flag: 'US' },
  { code: 'GB', dialCode: '+44', name: 'United Kingdom', flag: 'GB' },
  { code: 'CA', dialCode: '+1', name: 'Canada', flag: 'CA' },
  { code: 'AE', dialCode: '+971', name: 'United Arab Emirates', flag: 'AE' },
  { code: 'SG', dialCode: '+65', name: 'Singapore', flag: 'SG' },
  { code: 'AU', dialCode: '+61', name: 'Australia', flag: 'AU' },
  { code: 'DE', dialCode: '+49', name: 'Germany', flag: 'DE' },
  { code: 'FR', dialCode: '+33', name: 'France', flag: 'FR' },
  { code: 'SA', dialCode: '+966', name: 'Saudi Arabia', flag: 'SA' },
  { code: 'RU', dialCode: '+7', name: 'Russia', flag: 'RU' },
  { code: 'BR', dialCode: '+55', name: 'Brazil', flag: 'BR' },
  { code: 'JP', dialCode: '+81', name: 'Japan', flag: 'JP' },
  { code: 'KR', dialCode: '+82', name: 'South Korea', flag: 'KR' },
  { code: 'ID', dialCode: '+62', name: 'Indonesia', flag: 'ID' },
  { code: 'NG', dialCode: '+234', name: 'Nigeria', flag: 'NG' },
  { code: 'ZA', dialCode: '+27', name: 'South Africa', flag: 'ZA' },
  { code: 'IT', dialCode: '+39', name: 'Italy', flag: 'IT' },
  { code: 'ES', dialCode: '+34', name: 'Spain', flag: 'ES' },
  { code: 'NL', dialCode: '+31', name: 'Netherlands', flag: 'NL' },
  { code: 'SE', dialCode: '+46', name: 'Sweden', flag: 'SE' },
  { code: 'CH', dialCode: '+41', name: 'Switzerland', flag: 'CH' },
  { code: 'TR', dialCode: '+90', name: 'Turkey', flag: 'TR' },
  { code: 'MX', dialCode: '+52', name: 'Mexico', flag: 'MX' },
  { code: 'AR', dialCode: '+54', name: 'Argentina', flag: 'AR' },
  { code: 'MY', dialCode: '+60', name: 'Malaysia', flag: 'MY' },
  { code: 'PH', dialCode: '+63', name: 'Philippines', flag: 'PH' },
  { code: 'VN', dialCode: '+84', name: 'Vietnam', flag: 'VN' },
  { code: 'TH', dialCode: '+66', name: 'Thailand', flag: 'TH' },
  { code: 'PK', dialCode: '+92', name: 'Pakistan', flag: 'PK' },
  { code: 'BD', dialCode: '+880', name: 'Bangladesh', flag: 'BD' },
  { code: 'EG', dialCode: '+20', name: 'Egypt', flag: 'EG' },
  { code: 'IL', dialCode: '+972', name: 'Israel', flag: 'IL' },
  { code: 'NZ', dialCode: '+64', name: 'New Zealand', flag: 'NZ' },
  { code: 'CUSTOM', dialCode: 'custom', name: 'Other (Manual Code)', flag: 'INTL' },
];

const CODE_LENGTH = 5;

/** Format raw phone number into human-readable spaced chunks */
function formatPhoneDisplay(phone: string): string {
  if (!phone) return '';
  const clean = phone.trim();
  if (clean.startsWith('+91') && clean.length === 13) {
    return `+91 ${clean.slice(3, 8)} ${clean.slice(8)}`;
  }
  if (clean.startsWith('+1') && clean.length === 12) {
    return `+1 (${clean.slice(2, 5)}) ${clean.slice(5, 8)}-${clean.slice(8)}`;
  }
  if (clean.startsWith('+44') && clean.length >= 12) {
    return `+44 ${clean.slice(3, 7)} ${clean.slice(7)}`;
  }
  if (clean.startsWith('+971') && clean.length >= 12) {
    return `+971 ${clean.slice(4, 6)} ${clean.slice(6)}`;
  }
  if (clean.length > 6) {
    const splitPoint = clean.length > 10 ? clean.length - 10 : 3;
    return `${clean.slice(0, splitPoint)} ${clean.slice(splitPoint, splitPoint + 4)} ${clean.slice(splitPoint + 4)}`.trim();
  }
  return clean;
}

export function PhoneAuthScreen({ onLoginSuccess }: PhoneAuthScreenProps) {
  const [step, setStep] = useState<'phone' | 'code' | '2fa'>('phone');
  const [selectedCountry, setSelectedCountry] = useState<CountryItem>(ALL_COUNTRIES[0]); // Default India
  const [customDialCode, setCustomDialCode] = useState('+');
  const [localNumber, setLocalNumber] = useState('');
  const [phoneAuthId, setPhoneAuthId] = useState('');
  const [fullPhoneSubmitted, setFullPhoneSubmitted] = useState('');
  const [phoneCode, setPhoneCode] = useState('');
  const [password, setPassword] = useState('');
  const [isCodeViaApp, setIsCodeViaApp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState(getApiBaseUrl());
  const [showSettings, setShowSettings] = useState(false);
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [countrySearch, setCountrySearch] = useState('');

  const codeInputRef = useRef<any>(null);

  const filteredCountries = useMemo(() => {
    const q = countrySearch.trim().toLowerCase();
    if (!q) return ALL_COUNTRIES;
    return ALL_COUNTRIES.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.dialCode.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q)
    );
  }, [countrySearch]);

  const handleSendCode = async () => {
    setErrorMsg(null);
    const prefix = selectedCountry.dialCode === 'custom' ? customDialCode.trim() : selectedCountry.dialCode;
    const cleanDigits = localNumber.replace(/[^\d]/g, '');

    if (selectedCountry.dialCode === 'custom' && !/^\+\d{1,4}$/.test(prefix)) {
      setErrorMsg('Please enter a valid country dial code (e.g. +1, +44).');
      return;
    }

    if (!cleanDigits || cleanDigits.length < 5) {
      setErrorMsg('Please enter a valid phone number.');
      return;
    }

    const fullNumber = `${prefix}${cleanDigits}`;
    console.log(`[PHONE_LOGIN] [1/2] Sending login code request for phone: "${fullNumber}" to ${serverUrl}`);

    setLoading(true);
    try {
      setApiBaseUrl(serverUrl);
      const res = await apiFetch('/api/auth/phone/send-code', {
        method: 'POST',
        body: JSON.stringify({ phoneNumber: fullNumber }),
      });
      console.log(`[PHONE_LOGIN] [1/2] /api/auth/phone/send-code status: ${res.status}`);
      const data: any = await res.json();
      console.log(`[PHONE_LOGIN] [1/2] Response data:`, data);

      if (!res.ok || data.error) {
        console.warn(`[PHONE_LOGIN] [1/2] Send code error:`, data.error);
        setErrorMsg(data.error || 'Failed to send verification code');
        return;
      }

      console.log(`[PHONE_LOGIN] [1/2] Code sent successfully! phoneAuthId="${data.phoneAuthId}", isCodeViaApp=${data.isCodeViaApp}`);
      setPhoneAuthId(data.phoneAuthId);
      setIsCodeViaApp(!!data.isCodeViaApp);
      setFullPhoneSubmitted(fullNumber);
      setPhoneCode('');
      setStep('code');
    } catch (err: any) {
      console.error(`[PHONE_LOGIN] [1/2] Send code exception:`, err);
      setErrorMsg(err.message || 'Could not connect to server');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async () => {
    setErrorMsg(null);
    if (step === 'code' && (!phoneCode || phoneCode.trim().length !== CODE_LENGTH)) {
      setErrorMsg(`Please enter the complete ${CODE_LENGTH}-digit code`);
      return;
    }

    console.log(`[PHONE_LOGIN] [2/2] Verifying code "${phoneCode}" (authId: ${phoneAuthId}, hasPassword: ${!!password})`);
    setLoading(true);
    try {
      const bodyPayload: any = {
        phoneAuthId,
        phoneCode: phoneCode.trim(),
      };
      if (password) {
        bodyPayload.password = password;
      }

      const res = await apiFetch('/api/auth/phone/verify', {
        method: 'POST',
        body: JSON.stringify(bodyPayload),
      });
      console.log(`[PHONE_LOGIN] [2/2] /api/auth/phone/verify status: ${res.status}`);
      const data: any = await res.json();
      console.log(`[PHONE_LOGIN] [2/2] Raw response keys:`, Object.keys(data));
      console.log(`[PHONE_LOGIN] [2/2] Full response data:`, JSON.stringify(data));

      if (data.requires2FA) {
        console.log(`[PHONE_LOGIN] [2/2] Account requires 2FA password`);
        setStep('2fa');
        if (data.error) setErrorMsg(data.error);
        setLoading(false);
        return;
      }

      if (!res.ok || !data.success) {
        console.warn(`[PHONE_LOGIN] [2/2] Verification failed:`, data.error);
        setErrorMsg(data.error || 'Invalid verification code');
        return;
      }

      let tokenToSave = data.sessionToken;
      if (!tokenToSave) {
        const cookieHeader = res.headers.get('set-cookie') || '';
        const match = cookieHeader.match(/(?:tg_session|aetheroll_session)=([^;]+)/);
        if (match && match[1]) {
          tokenToSave = decodeURIComponent(match[1]);
          console.log(`[PHONE_LOGIN] [2/2] Extracted token from Set-Cookie header`);
        }
      }

      console.log(`[PHONE_LOGIN] [2/2] Token ready to persist:`, tokenToSave ? `${tokenToSave.slice(0, 12)}... (length: ${tokenToSave.length})` : 'MISSING_TOKEN');
      console.log(`[PHONE_LOGIN] [2/2] User profile ready to persist:`, JSON.stringify(data.user));

      if (tokenToSave) {
        console.log(`[PHONE_LOGIN] [2/2] Saving session token to KeyStore & AsyncStorage...`);
        await setSessionToken(tokenToSave);
      } else {
        console.error(`[PHONE_LOGIN] [2/2] ERROR: No session token found in response body or headers!`);
      }

      if (data.user) {
        console.log(`[PHONE_LOGIN] [2/2] Saving user profile to AsyncStorage...`);
        await saveUserData(data.user);
      }

      // Immediate Readback Verification Test
      console.log(`[PHONE_LOGIN] [2/2] Running instant post-login verification test...`);
      const testToken = await getSecureSession();
      const testUser = await getUserData();
      console.log(`[PHONE_LOGIN] [2/2] Post-login readback -> token: ${testToken ? `${testToken.slice(0, 10)}... (OK)` : 'FAILED'}, user: ${testUser?.displayName || 'FAILED'}`);

      console.log(`[PHONE_LOGIN] [2/2] Login completed successfully! Transitioning to GalleryScreen.`);
      onLoginSuccess(data.user);
    } catch (err: any) {
      console.error(`[PHONE_LOGIN] [2/2] Verification exception:`, err);
      setErrorMsg(err.message || 'Failed to complete authentication');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardContainer}
      >
        {/* Top App Bar with clean Back / Settings buttons */}
        <View style={styles.appBar}>
          {step !== 'phone' ? (
            <TouchableOpacity
              style={styles.navBackBtn}
              onPress={() => {
                setErrorMsg(null);
                setStep('phone');
              }}
              activeOpacity={0.7}
            >
              <Text style={styles.navBackIcon}>←</Text>
              <Text style={styles.navBackText}>Back</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.navPlaceholder} />
          )}

          <TouchableOpacity
            style={styles.navSettingsBtn}
            onPress={() => setShowSettings(true)}
            activeOpacity={0.7}
          >
            <Text style={styles.navSettingsIcon}>⚙</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.contentWrapper}>
          {/* STEP 1: PHONE LOGIN */}
          {step === 'phone' && (
            <View style={styles.formContainer}>
              {/* Centered Brand Header */}
              <View style={styles.brandHeader}>
                <View style={styles.logoBadge}>
                  <BrandLogo size={52} />
                </View>
                <Text style={styles.brandTitle}>AETHEROLL</Text>
                <Text style={styles.brandSubtitle}>Infinite Cloud Photo & Video Vault</Text>
              </View>

              <Text style={styles.mainHeading}>Log in with Telegram</Text>
              <Text style={styles.subHeading}>
                Enter your phone number to receive your login code
              </Text>

              {errorMsg && (
                <View style={styles.errorAlert}>
                  <Text style={styles.errorAlertText}>{errorMsg}</Text>
                </View>
              )}

              {/* Phone Input Row */}
              <Text style={styles.fieldLabel}>PHONE NUMBER</Text>
              <View style={styles.phoneInputRow}>
                {/* Country Trigger */}
                <TouchableOpacity
                  style={styles.countryTrigger}
                  onPress={() => {
                    setCountrySearch('');
                    setShowCountryPicker(true);
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={styles.countryFlag}>{selectedCountry.flag}</Text>
                  <Text style={styles.countryCodeText}>
                    {selectedCountry.dialCode === 'custom' ? 'Code' : selectedCountry.dialCode}
                  </Text>
                  <Text style={styles.dropdownChevron}>▾</Text>
                </TouchableOpacity>

                {/* Custom Dial Code if needed */}
                {selectedCountry.dialCode === 'custom' && (
                  <TextInput
                    style={styles.customCodeInput}
                    placeholder="+1"
                    placeholderTextColor="#475569"
                    keyboardType="phone-pad"
                    value={customDialCode}
                    onChangeText={setCustomDialCode}
                  />
                )}

                {/* Number Input */}
                <TextInput
                  style={styles.numberInput}
                  placeholder="98765 43210"
                  placeholderTextColor="#475569"
                  keyboardType="phone-pad"
                  value={localNumber}
                  onChangeText={setLocalNumber}
                  autoCapitalize="none"
                />
              </View>

              {/* Primary Action Button */}
              <TouchableOpacity
                style={[
                  styles.ctaButton,
                  (!localNumber.trim() || loading) && styles.ctaButtonDisabled,
                ]}
                onPress={handleSendCode}
                disabled={loading || !localNumber.trim()}
                activeOpacity={0.8}
              >
                {loading ? (
                  <ActivityIndicator color="#ffffff" size="small" />
                ) : (
                  <View style={styles.ctaRow}>
                    <Text style={styles.ctaText}>Send Code to Telegram</Text>
                    <Text style={styles.ctaArrow}>→</Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>
          )}

          {/* STEP 2: 5-DIGIT CODE ENTRY */}
          {step === 'code' && (
            <View style={styles.formContainer}>
              {/* Brand Header */}
              <View style={styles.brandHeaderCompact}>
                <BrandLogo size={44} />
              </View>

              <Text style={styles.mainHeading}>Enter 5-Digit Code</Text>

              {/* Phone Info Row */}
              <View style={styles.phoneInfoRow}>
                <Text style={styles.phoneInfoMuted}>Code sent to </Text>
                <Text style={styles.phoneInfoNumber}>
                  {formatPhoneDisplay(fullPhoneSubmitted)}
                </Text>
                <TouchableOpacity
                  style={styles.phoneEditChip}
                  onPress={() => {
                    setStep('phone');
                    setPhoneCode('');
                    setErrorMsg(null);
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={styles.phoneEditChipText}>Edit</Text>
                </TouchableOpacity>
              </View>

              {errorMsg && (
                <View style={styles.errorAlert}>
                  <Text style={styles.errorAlertText}>{errorMsg}</Text>
                </View>
              )}

              {/* 5 Sleek OTP Digit Cells */}
              <Pressable
                style={styles.otpRow}
                onPress={() => codeInputRef.current?.focus()}
              >
                {Array.from({ length: CODE_LENGTH }).map((_, index) => {
                  const digit = phoneCode[index] || '';
                  const isFocused = phoneCode.length === index;
                  const isLastFilled =
                    phoneCode.length === CODE_LENGTH && index === CODE_LENGTH - 1;
                  return (
                    <View
                      key={index}
                      style={[
                        styles.otpCell,
                        (isFocused || isLastFilled) && styles.otpCellFocused,
                        digit ? styles.otpCellFilled : null,
                      ]}
                    >
                      <Text style={styles.otpDigit}>{digit}</Text>
                    </View>
                  );
                })}
              </Pressable>

              {/* Hidden text input capturing OTP */}
              <TextInput
                ref={codeInputRef}
                style={styles.hiddenInput}
                value={phoneCode}
                onChangeText={(val) => {
                  const clean = val.replace(/[^\d]/g, '').slice(0, CODE_LENGTH);
                  setPhoneCode(clean);
                  if (clean.length === CODE_LENGTH) {
                    setErrorMsg(null);
                  }
                }}
                keyboardType="number-pad"
                maxLength={CODE_LENGTH}
                autoFocus
              />

              {/* Telegram Helper Notice */}
              <View style={styles.telegramBadge}>
                <Text style={styles.telegramBadgeText}>
                  {isCodeViaApp
                    ? 'Check your official Telegram app for the login code'
                    : 'Check your SMS messages for the login code'}
                </Text>
              </View>

              {/* Primary Action Button */}
              <TouchableOpacity
                style={[
                  styles.ctaButton,
                  (phoneCode.length !== CODE_LENGTH || loading) && styles.ctaButtonDisabled,
                ]}
                onPress={handleVerifyCode}
                disabled={loading || phoneCode.length !== CODE_LENGTH}
                activeOpacity={0.8}
              >
                {loading ? (
                  <ActivityIndicator color="#ffffff" size="small" />
                ) : (
                  <View style={styles.ctaRow}>
                    <Text style={styles.ctaText}>Verify Code & Log In</Text>
                    <Text style={styles.ctaArrow}>→</Text>
                  </View>
                )}
              </TouchableOpacity>

              {/* Resend Code Link */}
              <View style={styles.resendContainer}>
                <Text style={styles.resendMuted}>Didn't receive code?</Text>
                <TouchableOpacity
                  onPress={handleSendCode}
                  disabled={loading}
                  activeOpacity={0.7}
                >
                  <Text style={styles.resendHighlight}>Resend Code</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* STEP 3: 2FA PASSWORD */}
          {step === '2fa' && (
            <View style={styles.formContainer}>
              <View style={styles.brandHeaderCompact}>
                <BrandLogo size={44} />
              </View>

              <Text style={styles.mainHeading}>Two-Step Verification</Text>
              <Text style={styles.subHeading}>
                Enter your Telegram 2FA cloud password to complete login
              </Text>

              {errorMsg && (
                <View style={styles.errorAlert}>
                  <Text style={styles.errorAlertText}>{errorMsg}</Text>
                </View>
              )}

              <Text style={styles.fieldLabel}>2FA CLOUD PASSWORD</Text>
              <TextInput
                style={styles.passwordInputField}
                placeholder="Enter password"
                placeholderTextColor="#475569"
                secureTextEntry
                value={password}
                onChangeText={setPassword}
                autoFocus
              />

              <TouchableOpacity
                style={[
                  styles.ctaButton,
                  (!password.trim() || loading) && styles.ctaButtonDisabled,
                ]}
                onPress={handleVerifyCode}
                disabled={loading || !password.trim()}
                activeOpacity={0.8}
              >
                {loading ? (
                  <ActivityIndicator color="#ffffff" size="small" />
                ) : (
                  <View style={styles.ctaRow}>
                    <Text style={styles.ctaText}>Unlock Account</Text>
                    <Text style={styles.ctaArrow}>→</Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>
          )}

          {/* Security Guarantee Banner */}
          <View style={styles.securityFooter}>
            <Text style={styles.securityCheck}>✓</Text>
            <Text style={styles.securityText}>
              Direct MTProto authentication. Password never stored.
            </Text>
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* Country Picker Modal */}
      <Modal
        visible={showCountryPicker}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowCountryPicker(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setShowCountryPicker(false)}>
          <View style={styles.bottomSheet} onStartShouldSetResponder={() => true}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Select Country</Text>
              <TouchableOpacity
                style={styles.sheetCloseBtn}
                onPress={() => setShowCountryPicker(false)}
              >
                <Text style={styles.sheetCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.searchBoxWrapper}>
              <TextInput
                style={styles.searchInput}
                placeholder="Search country or code..."
                placeholderTextColor="#64748B"
                value={countrySearch}
                onChangeText={setCountrySearch}
                autoCapitalize="none"
              />
            </View>

            <FlatList
              data={filteredCountries}
              keyExtractor={(item) => item.code}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => {
                const isSelected = selectedCountry.code === item.code;
                return (
                  <TouchableOpacity
                    style={[styles.countryRowItem, isSelected && styles.countryRowItemSelected]}
                    onPress={() => {
                      setSelectedCountry(item);
                      setShowCountryPicker(false);
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.countryRowFlag}>{item.flag}</Text>
                    <Text style={[styles.countryRowName, isSelected && styles.countryRowNameSelected]}>
                      {item.name}
                    </Text>
                    <Text style={styles.countryRowDial}>
                      {item.dialCode === 'custom' ? 'Custom' : item.dialCode}
                    </Text>
                    {isSelected && <Text style={styles.countryRowCheck}>✓</Text>}
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </Pressable>
      </Modal>

      {/* Server Endpoint Settings Modal */}
      <Modal
        visible={showSettings}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowSettings(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setShowSettings(false)}>
          <View style={styles.settingsDialog} onStartShouldSetResponder={() => true}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Server Endpoint</Text>
              <TouchableOpacity
                style={styles.sheetCloseBtn}
                onPress={() => setShowSettings(false)}
              >
                <Text style={styles.sheetCloseText}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.settingsDesc}>
              Configure the backend API server URL for authentication and media sync.
            </Text>
            <TextInput
              style={styles.settingsTextInput}
              value={serverUrl}
              onChangeText={setServerUrl}
              autoCapitalize="none"
              placeholder="https://your-server.com"
              placeholderTextColor="#64748B"
            />
            <TouchableOpacity
              style={styles.saveSettingsBtn}
              onPress={() => {
                setApiBaseUrl(serverUrl.trim());
                setShowSettings(false);
              }}
            >
              <Text style={styles.saveSettingsBtnText}>Save & Apply</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  keyboardContainer: {
    flex: 1,
  },
  appBar: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  navBackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 8,
    gap: 6,
  },
  navBackIcon: {
    fontSize: 20,
    color: '#1F1F1F',
    fontWeight: '700',
  },
  navBackText: {
    fontSize: 15,
    color: '#1F1F1F',
    fontWeight: '600',
  },
  navPlaceholder: {
    width: 60,
  },
  navSettingsBtn: {
    padding: 8,
  },
  navSettingsIcon: {
    fontSize: 20,
    color: '#5F6368',
  },
  contentWrapper: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingBottom: 32,
  },
  formContainer: {
    width: '100%',
  },
  brandHeader: {
    alignItems: 'center',
    marginBottom: 28,
  },
  brandHeaderCompact: {
    alignItems: 'center',
    marginBottom: 20,
  },
  logoBadge: {
    marginBottom: 12,
  },
  brandTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#1F1F1F',
    letterSpacing: 2,
  },
  brandSubtitle: {
    fontSize: 13,
    color: '#5F6368',
    marginTop: 4,
    fontWeight: '500',
  },
  mainHeading: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1F1F1F',
    textAlign: 'center',
    letterSpacing: -0.2,
  },
  subHeading: {
    fontSize: 14,
    color: '#5F6368',
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 24,
    lineHeight: 20,
  },
  phoneInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    marginBottom: 28,
    gap: 6,
  },
  phoneInfoMuted: {
    fontSize: 14,
    color: '#5F6368',
  },
  phoneInfoNumber: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1F1F1F',
  },
  phoneEditChip: {
    backgroundColor: '#E8F0FE',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    marginLeft: 4,
  },
  phoneEditChipText: {
    fontSize: 12,
    color: '#1A73E8',
    fontWeight: '700',
  },
  errorAlert: {
    backgroundColor: '#FDE8E8',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
    marginBottom: 20,
  },
  errorAlertText: {
    color: '#DC2626',
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#5F6368',
    letterSpacing: 0.8,
    marginBottom: 8,
    marginLeft: 2,
  },
  phoneInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 56,
    backgroundColor: '#F8F9FA',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#DADCE0',
    overflow: 'hidden',
    marginBottom: 20,
  },
  countryTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    height: '100%',
    paddingHorizontal: 14,
    borderRightWidth: 1.5,
    borderRightColor: '#DADCE0',
    backgroundColor: '#F1F3F4',
  },
  countryFlag: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1A73E8',
    marginRight: 6,
    backgroundColor: '#E8F0FE',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  countryCodeText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1F1F1F',
  },
  dropdownChevron: {
    fontSize: 11,
    color: '#5F6368',
    marginLeft: 6,
  },
  customCodeInput: {
    width: 64,
    height: '100%',
    paddingHorizontal: 10,
    fontSize: 15,
    fontWeight: '600',
    color: '#1F1F1F',
    borderRightWidth: 1.5,
    borderRightColor: '#DADCE0',
    backgroundColor: '#F8F9FA',
  },
  numberInput: {
    flex: 1,
    height: '100%',
    paddingHorizontal: 16,
    fontSize: 16,
    fontWeight: '600',
    color: '#1F1F1F',
  },
  passwordInputField: {
    height: 56,
    backgroundColor: '#F8F9FA',
    borderWidth: 1.5,
    borderColor: '#DADCE0',
    borderRadius: 16,
    paddingHorizontal: 16,
    fontSize: 16,
    color: '#1F1F1F',
    marginBottom: 20,
  },
  otpRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
    paddingHorizontal: 4,
  },
  otpCell: {
    width: 52,
    height: 60,
    borderRadius: 16,
    backgroundColor: '#F8F9FA',
    borderWidth: 1.5,
    borderColor: '#DADCE0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  otpCellFocused: {
    borderColor: '#1A73E8',
    backgroundColor: '#E8F0FE',
    shadowColor: '#1A73E8',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 2,
  },
  otpCellFilled: {
    borderColor: '#BDC1C6',
    backgroundColor: '#FFFFFF',
  },
  otpDigit: {
    fontSize: 26,
    fontWeight: '800',
    color: '#1F1F1F',
  },
  hiddenInput: {
    position: 'absolute',
    opacity: 0,
    width: 1,
    height: 1,
  },
  telegramBadge: {
    backgroundColor: '#E8F0FE',
    borderWidth: 1,
    borderColor: '#D2E3FC',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 24,
  },
  telegramBadgeText: {
    fontSize: 13,
    color: '#1967D2',
    textAlign: 'center',
    lineHeight: 18,
    fontWeight: '500',
  },
  ctaButton: {
    height: 56,
    backgroundColor: '#1A73E8',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#1A73E8',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  ctaButtonDisabled: {
    opacity: 0.5,
  },
  ctaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  ctaArrow: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
    marginLeft: 8,
  },
  resendContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
    gap: 6,
  },
  resendMuted: {
    fontSize: 13,
    color: '#5F6368',
  },
  resendHighlight: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1A73E8',
  },
  securityFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 36,
  },
  securityCheck: {
    color: '#137333',
    fontSize: 14,
    fontWeight: '900',
    marginRight: 6,
  },
  securityText: {
    fontSize: 12,
    color: '#5F6368',
    fontWeight: '500',
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
    maxHeight: '80%',
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
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
  searchBoxWrapper: {
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  searchInput: {
    backgroundColor: '#F1F3F4',
    borderWidth: 1,
    borderColor: '#DADCE0',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: '#1F1F1F',
  },
  countryRowItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F3F4',
  },
  countryRowItemSelected: {
    backgroundColor: '#E8F0FE',
  },
  countryRowFlag: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1A73E8',
    marginRight: 14,
    backgroundColor: '#E8F0FE',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
    minWidth: 32,
    textAlign: 'center',
  },
  countryRowName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#1F1F1F',
  },
  countryRowNameSelected: {
    color: '#1A73E8',
  },
  countryRowDial: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1A73E8',
    marginRight: 8,
  },
  countryRowCheck: {
    fontSize: 14,
    color: '#137333',
    fontWeight: '900',
  },
  settingsDialog: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#DADCE0',
    padding: 24,
    marginHorizontal: 20,
    alignSelf: 'center',
    width: '90%',
    marginBottom: 'auto',
    marginTop: 'auto',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 8,
  },
  settingsDesc: {
    fontSize: 13,
    color: '#5F6368',
    marginTop: 10,
    marginBottom: 16,
    lineHeight: 18,
  },
  settingsTextInput: {
    backgroundColor: '#F1F3F4',
    borderWidth: 1,
    borderColor: '#DADCE0',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 14,
    color: '#1F1F1F',
    marginBottom: 20,
  },
  saveSettingsBtn: {
    height: 50,
    backgroundColor: '#1A73E8',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveSettingsBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
});
