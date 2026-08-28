"use client";

import React, { useState, useEffect } from "react";
import {
  QrCode,
  RefreshCw,
  Smartphone,
  ShieldCheck,
  AlertCircle,
  Phone,
  KeyRound,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  Globe,
} from "lucide-react";
import { getAuthWsUrl, getApiBaseUrl } from "@/lib/config";

interface QRCodeModalProps {
  onLoginSuccess: (user: any) => void;
}

type AuthTab = "phone" | "qr";

interface CountryOption {
  code: string;
  dialCode: string;
  name: string;
  flag: string;
}

const TOP_COUNTRIES: CountryOption[] = [
  { code: "IN", dialCode: "+91", name: "India", flag: "🇮🇳" },
  { code: "US", dialCode: "+1", name: "United States / Canada", flag: "🇺🇸" },
  { code: "GB", dialCode: "+44", name: "United Kingdom", flag: "🇬🇧" },
  { code: "AE", dialCode: "+971", name: "UAE", flag: "🇦🇪" },
  { code: "SG", dialCode: "+65", name: "Singapore", flag: "🇸🇬" },
  { code: "AU", dialCode: "+61", name: "Australia", flag: "🇦🇺" },
  { code: "DE", dialCode: "+49", name: "Germany", flag: "🇩🇪" },
  { code: "FR", dialCode: "+33", name: "France", flag: "🇫🇷" },
  { code: "SA", dialCode: "+966", name: "Saudi Arabia", flag: "🇸🇦" },
  { code: "CUSTOM", dialCode: "custom", name: "Other (Manual Code)", flag: "🌐" },
];

export function QRCodeModal({ onLoginSuccess }: QRCodeModalProps) {
  // Navigation & responsive state
  const [activeTab, setActiveTab] = useState<AuthTab>("qr");
  const [isMobile, setIsMobile] = useState(false);

  // QR Auth state
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(true);
  const [qrError, setQrError] = useState<string | null>(null);

  // Phone Auth state
  const [phoneStep, setPhoneStep] = useState<"phone" | "code" | "2fa">("phone");
  const [selectedCountry, setSelectedCountry] = useState<CountryOption>(TOP_COUNTRIES[0]); // Default India 🇮🇳
  const [customDialCode, setCustomDialCode] = useState("+");
  const [localNumber, setLocalNumber] = useState("");
  const [phoneAuthId, setPhoneAuthId] = useState<string | null>(null);
  const [fullPhoneSubmitted, setFullPhoneSubmitted] = useState("");
  const [phoneCode, setPhoneCode] = useState("");
  const [password, setPassword] = useState("");
  const [phoneLoading, setPhoneLoading] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);

  useEffect(() => {
    const checkMobile = () => {
      const userAgent = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
      const mobileRegex = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;
      const mobileDevice =
        mobileRegex.test(userAgent) || (typeof window !== "undefined" && window.innerWidth < 768);
      setIsMobile(mobileDevice);
      if (mobileDevice) {
        setActiveTab("phone");
      }
    };

    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  // ----------------------------------------------------
  // QR Code WebSockets / Polling
  // ----------------------------------------------------
  const startConnection = () => {
    setQrLoading(true);
    setQrError(null);
    setQrImage(null);

    let activeSocket: WebSocket | null = null;
    let pollInterval: any = null;
    let isCancelled = false;

    const startHttpPolling = async () => {
      try {
        const res = await fetch(`${getApiBaseUrl()}/api/auth/qr`, { credentials: "include" });
        const resText = await res.text();
        let data: any = {};
        try {
          data = JSON.parse(resText);
        } catch {
          throw new Error("Invalid server response");
        }
        if (data.error) throw new Error(data.error);

        if (isCancelled) return;
        setQrImage(data.qrImage);
        setQrLoading(false);

        pollInterval = setInterval(async () => {
          if (isCancelled) return;
          try {
            const checkRes = await fetch(`${getApiBaseUrl()}/api/auth/qr/check`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({ qrId: data.qrId }),
            });
            const checkData = await checkRes.json();
            if (checkData.success && checkData.user) {
              clearInterval(pollInterval);
              if (checkData.sessionToken) {
                try {
                  await fetch(`${getApiBaseUrl()}/api/auth/session`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    credentials: "include",
                    body: JSON.stringify({ sessionToken: checkData.sessionToken }),
                  });
                } catch {}
              }
              onLoginSuccess(checkData.user);
            }
          } catch {}
        }, 2000);
      } catch (err: any) {
        if (!isCancelled) {
          setQrError(err.message || "Failed to load QR code");
          setQrLoading(false);
        }
      }
    };

    try {
      const wsUrl = getAuthWsUrl();
      const ws = new WebSocket(wsUrl);
      activeSocket = ws;

      ws.onmessage = async (event) => {
        if (isCancelled) return;
        try {
          const data = JSON.parse(event.data);
          if (data.type === "qr" && data.qrImage) {
            setQrImage(data.qrImage);
            setQrLoading(false);
          } else if (data.type === "authenticated" && data.user) {
            ws.close();
            if (data.sessionToken) {
              await fetch(`${getApiBaseUrl()}/api/auth/session`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ sessionToken: data.sessionToken }),
              });
            }
            onLoginSuccess(data.user);
          } else if (data.type === "expired") {
            ws.close();
            if (!isCancelled) startConnection();
          } else if (data.type === "error") {
            setQrError(data.error || "Authentication error");
            setQrLoading(false);
          }
        } catch (parseErr) {
          console.error("WS Parse Error:", parseErr);
        }
      };

      ws.onerror = () => {
        if (!qrImage && !isCancelled) {
          try {
            ws.close();
          } catch {}
          startHttpPolling();
        }
      };
    } catch {
      startHttpPolling();
    }

    return () => {
      isCancelled = true;
      if (activeSocket) {
        try {
          activeSocket.close();
        } catch {}
      }
      if (pollInterval) clearInterval(pollInterval);
    };
  };

  useEffect(() => {
    const cleanup = startConnection();
    return () => {
      cleanup();
    };
  }, []);

  // ----------------------------------------------------
  // Phone Auth Handlers
  // ----------------------------------------------------
  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setPhoneError(null);
    setPhoneLoading(true);

    const prefix = selectedCountry.dialCode === "custom" ? customDialCode : selectedCountry.dialCode;
    const cleanDigits = localNumber.replace(/[^\d]/g, "");
    const fullNumber = `${prefix}${cleanDigits}`;

    if (!cleanDigits || cleanDigits.length < 5) {
      setPhoneError("Please enter a valid phone number.");
      setPhoneLoading(false);
      return;
    }

    try {
      const res = await fetch(`${getApiBaseUrl()}/api/auth/phone/send-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ phoneNumber: fullNumber }),
      });

      const resText = await res.text();
      let data: any = {};
      try {
        data = JSON.parse(resText);
      } catch {
        throw new Error(resText || "Server returned invalid response");
      }

      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to send code");
      }

      setPhoneAuthId(data.phoneAuthId);
      setFullPhoneSubmitted(fullNumber);
      setPhoneStep("code");
    } catch (err: any) {
      setPhoneError(err.message || "Could not send verification code.");
    } finally {
      setPhoneLoading(false);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setPhoneError(null);
    setPhoneLoading(true);

    try {
      const res = await fetch(`${getApiBaseUrl()}/api/auth/phone/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          phoneAuthId,
          phoneCode,
          password: password || undefined,
        }),
      });

      const resText = await res.text();
      let data: any = {};
      try {
        data = JSON.parse(resText);
      } catch {
        throw new Error(resText || "Server returned invalid response");
      }

      if (data.requires2FA) {
        setPhoneStep("2fa");
        if (data.error) setPhoneError(data.error);
        setPhoneLoading(false);
        return;
      }

      if (!res.ok || data.error || !data.success) {
        throw new Error(data.error || "Verification failed");
      }

      if (data.sessionToken) {
        try {
          await fetch(`${getApiBaseUrl()}/api/auth/session`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ sessionToken: data.sessionToken }),
          });
        } catch {}
      }

      onLoginSuccess(data.user);
    } catch (err: any) {
      setPhoneError(err.message || "Failed to verify code");
    } finally {
      setPhoneLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-3">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-[360px] w-full p-4 shadow-2xl space-y-4 text-center">
        {/* Header */}
        <div className="space-y-1">
          <div className="w-10 h-10 rounded-xl bg-blue-600/20 text-blue-400 mx-auto flex items-center justify-center mb-2">
            {activeTab === "phone" ? <Phone className="w-5 h-5" /> : <QrCode className="w-5 h-5" />}
          </div>
          <h2 className="text-base font-bold text-white tracking-tight">Log in to Aetheroll</h2>
          <p className="text-[11px] text-slate-400">
            Connect your Telegram account to access your vault
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="flex bg-slate-950/80 p-0.5 rounded-lg border border-slate-800/60 text-xs">
          <button
            onClick={() => setActiveTab("phone")}
            className={`flex-1 py-1.5 font-medium rounded-md transition-all flex items-center justify-center gap-1.5 ${
              activeTab === "phone"
                ? "bg-blue-600 text-white shadow"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Phone className="w-3.5 h-3.5" />
            <span>Phone Number</span>
          </button>
          <button
            onClick={() => setActiveTab("qr")}
            className={`flex-1 py-1.5 font-medium rounded-md transition-all flex items-center justify-center gap-1.5 ${
              activeTab === "qr"
                ? "bg-blue-600 text-white shadow"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <QrCode className="w-3.5 h-3.5" />
            <span>QR Code</span>
          </button>
        </div>

        {/* TAB 1: PHONE NUMBER LOGIN */}
        {activeTab === "phone" && (
          <div className="space-y-3 text-left">
            {phoneError && (
              <div className="p-2.5 bg-rose-500/10 border border-rose-500/20 rounded-lg text-rose-400 text-[11px] flex items-start gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{phoneError}</span>
              </div>
            )}

            {phoneStep === "phone" && (
              <form onSubmit={handleSendCode} className="space-y-3">
                <div>
                  <label className="block text-[11px] font-medium text-slate-300 mb-1">
                    Phone Number
                  </label>
                  <div className="flex items-center">
                    {/* Country Selector Dropdown */}
                    <select
                      value={selectedCountry.code}
                      onChange={(e) => {
                        const country = TOP_COUNTRIES.find((c) => c.code === e.target.value);
                        if (country) setSelectedCountry(country);
                      }}
                      className="w-[105px] shrink-0 bg-slate-950 text-slate-200 border border-slate-800 rounded-l-xl px-2 py-2.5 text-xs focus:outline-none focus:border-blue-500 border-r-0 cursor-pointer truncate"
                    >
                      {TOP_COUNTRIES.map((country) => (
                        <option key={country.code} value={country.code} className="bg-slate-900 text-white">
                          {country.flag} {country.dialCode === "custom" ? "Custom" : country.dialCode}
                        </option>
                      ))}
                    </select>

                    {/* If Custom selected, show manual code input */}
                    {selectedCountry.dialCode === "custom" ? (
                      <input
                        type="text"
                        value={customDialCode}
                        onChange={(e) => setCustomDialCode(e.target.value)}
                        placeholder="+1"
                        className="w-16 shrink-0 bg-slate-950 border border-slate-800 border-r-0 px-2 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                      />
                    ) : null}

                    {/* Local Phone Number Input */}
                    <input
                      type="tel"
                      value={localNumber}
                      onChange={(e) => setLocalNumber(e.target.value)}
                      placeholder="98765 43210"
                      required
                      className="flex-1 min-w-0 bg-slate-950 border border-slate-800 rounded-r-xl px-3 py-2.5 text-sm font-medium text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={phoneLoading || !localNumber.trim()}
                  className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:opacity-50 text-white font-medium text-xs rounded-xl flex items-center justify-center gap-1.5 shadow-md shadow-blue-600/20 transition"
                >
                  {phoneLoading ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <>
                      <span>Send Code to Telegram</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </>
                  )}
                </button>
              </form>
            )}

            {phoneStep === "code" && (
              <form onSubmit={handleVerifyCode} className="space-y-3">
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span>
                    Sent to <strong className="text-white">{fullPhoneSubmitted}</strong>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setPhoneStep("phone");
                      setPhoneCode("");
                    }}
                    className="text-blue-400 hover:underline text-[11px] flex items-center gap-0.5"
                  >
                    <ArrowLeft className="w-3 h-3" /> Change
                  </button>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-300 mb-1">
                    5-Digit Login Code
                  </label>
                  <input
                    type="text"
                    value={phoneCode}
                    onChange={(e) => setPhoneCode(e.target.value.trim())}
                    placeholder="12345"
                    required
                    maxLength={6}
                    autoFocus
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-center tracking-[0.25em] text-base font-bold text-white placeholder-slate-600 focus:outline-none focus:border-blue-500 transition"
                  />
                  <p className="text-[10px] text-slate-400 mt-1.5 text-center">
                    Check your official Telegram chat app for the login message
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={phoneLoading || !phoneCode.trim()}
                  className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:opacity-50 text-white font-medium text-xs rounded-xl flex items-center justify-center gap-1.5 shadow-md shadow-blue-600/20 transition"
                >
                  {phoneLoading ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <>
                      <span>Verify Code & Log In</span>
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    </>
                  )}
                </button>
              </form>
            )}

            {phoneStep === "2fa" && (
              <form onSubmit={handleVerifyCode} className="space-y-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-amber-400">
                    <KeyRound className="w-3.5 h-3.5" />
                    <span>Two-Step Verification Enabled</span>
                  </div>
                  <p className="text-[10px] text-slate-400">
                    Enter your Telegram 2FA cloud password to complete login.
                  </p>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-300 mb-1">
                    2FA Password
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter password"
                    required
                    autoFocus
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-blue-500 transition"
                  />
                </div>

                <button
                  type="submit"
                  disabled={phoneLoading || !password.trim()}
                  className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:opacity-50 text-white font-medium text-xs rounded-xl flex items-center justify-center gap-1.5 shadow-md shadow-blue-600/20 transition"
                >
                  {phoneLoading ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <span>Unlock Account</span>
                  )}
                </button>
              </form>
            )}
          </div>
        )}

        {/* TAB 2: QR CODE LOGIN */}
        {activeTab === "qr" && (
          <div className="space-y-3">
            <div className="relative flex flex-col items-center justify-center p-3 bg-white rounded-xl max-w-[220px] mx-auto shadow-inner">
              {qrLoading ? (
                <div className="h-40 w-40 flex items-center justify-center text-slate-400">
                  <RefreshCw className="w-6 h-6 animate-spin text-blue-600" />
                </div>
              ) : qrError ? (
                <div className="h-40 w-40 flex flex-col items-center justify-center text-rose-500 gap-1.5 p-2">
                  <AlertCircle className="w-6 h-6" />
                  <p className="text-[11px]">{qrError}</p>
                  <button
                    onClick={startConnection}
                    className="mt-1 text-[11px] px-2.5 py-1 bg-slate-100 text-slate-900 rounded-md font-medium"
                  >
                    Retry
                  </button>
                </div>
              ) : (
                qrImage && (
                  <img
                    src={qrImage}
                    alt="Telegram Login QR Code"
                    className="w-40 h-40 rounded-lg"
                  />
                )
              )}
            </div>

            <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-2.5 text-left space-y-1 text-[11px] text-slate-300">
              <div className="flex items-center gap-1.5 font-medium text-slate-200">
                <Smartphone className="w-3.5 h-3.5 text-blue-400" />
                <span>How to scan:</span>
              </div>
              <ol className="list-decimal list-inside space-y-0.5 text-slate-400 text-[10px] pl-0.5">
                <li>Open <strong className="text-slate-200">Telegram</strong> on your phone</li>
                <li>Go to <strong className="text-slate-200">Settings → Devices</strong></li>
                <li>Tap <strong className="text-slate-200">Link Desktop Device</strong></li>
              </ol>
            </div>
          </div>
        )}

        {/* Security badge */}
        <div className="flex items-center justify-center gap-1 text-[10px] text-slate-500 pt-1">
          <ShieldCheck className="w-3 h-3 text-emerald-500" />
          <span>Direct MTProto authentication. Password never stored.</span>
        </div>
      </div>
    </div>
  );
}
