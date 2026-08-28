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
} from "lucide-react";
import { getAuthWsUrl, getApiBaseUrl } from "@/lib/config";

interface QRCodeModalProps {
  onLoginSuccess: (user: any) => void;
}

type AuthTab = "phone" | "qr";

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
  const [phoneNumber, setPhoneNumber] = useState("");
  const [phoneAuthId, setPhoneAuthId] = useState<string | null>(null);
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
        const data = await res.json();
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

    try {
      const res = await fetch(`${getApiBaseUrl()}/api/auth/phone/send-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ phoneNumber }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to send code");
      }

      setPhoneAuthId(data.phoneAuthId);
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

      const data = await res.json();

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
    <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-5 text-center">
        {/* Header */}
        <div className="space-y-1.5">
          <div className="w-12 h-12 rounded-2xl bg-blue-600/20 text-blue-400 mx-auto flex items-center justify-center mb-3">
            {activeTab === "phone" ? <Phone className="w-6 h-6" /> : <QrCode className="w-6 h-6" />}
          </div>
          <h2 className="text-lg font-bold text-white tracking-tight">Log in to Aetheroll</h2>
          <p className="text-xs text-slate-400">
            Connect your official Telegram account to access your private vault
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="flex bg-slate-800/80 p-1 rounded-xl gap-1">
          <button
            onClick={() => setActiveTab("phone")}
            className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-all flex items-center justify-center gap-1.5 ${
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
            className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-all flex items-center justify-center gap-1.5 ${
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
          <div className="space-y-4 text-left">
            {phoneError && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{phoneError}</span>
              </div>
            )}

            {phoneStep === "phone" && (
              <form onSubmit={handleSendCode} className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Telegram Phone Number
                  </label>
                  <div className="relative">
                    <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                    <input
                      type="tel"
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value)}
                      placeholder="+1234567890"
                      required
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition"
                    />
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Include country code (e.g. +1 for US/Canada, +44 for UK, +91 for India)
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={phoneLoading || !phoneNumber.trim()}
                  className="w-full py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-medium text-xs rounded-xl flex items-center justify-center gap-2 transition"
                >
                  {phoneLoading ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <span>Send Code to Telegram</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </form>
            )}

            {phoneStep === "code" && (
              <form onSubmit={handleVerifyCode} className="space-y-3">
                <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                  <span>Code sent to <strong className="text-white">{phoneNumber}</strong></span>
                  <button
                    type="button"
                    onClick={() => {
                      setPhoneStep("phone");
                      setPhoneCode("");
                    }}
                    className="text-blue-400 hover:underline text-[11px] flex items-center gap-1"
                  >
                    <ArrowLeft className="w-3 h-3" /> Change
                  </button>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Telegram Login Code
                  </label>
                  <input
                    type="text"
                    value={phoneCode}
                    onChange={(e) => setPhoneCode(e.target.value)}
                    placeholder="Enter 5-digit code"
                    required
                    maxLength={10}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-center tracking-widest text-lg font-bold text-white placeholder-slate-600 focus:outline-none focus:border-blue-500 transition"
                  />
                  <p className="text-[11px] text-slate-500 mt-1 text-center">
                    Check your official Telegram chat app for the login message
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={phoneLoading || !phoneCode.trim()}
                  className="w-full py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-medium text-xs rounded-xl flex items-center justify-center gap-2 transition"
                >
                  {phoneLoading ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <span>Verify Code & Log In</span>
                      <CheckCircle2 className="w-4 h-4" />
                    </>
                  )}
                </button>
              </form>
            )}

            {phoneStep === "2fa" && (
              <form onSubmit={handleVerifyCode} className="space-y-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-xs font-medium text-amber-400">
                    <KeyRound className="w-4 h-4" />
                    <span>Two-Step Verification Enabled</span>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Your Telegram account is protected with a 2FA cloud password.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    2FA Password
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your 2FA password"
                    required
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500 transition"
                  />
                </div>

                <button
                  type="submit"
                  disabled={phoneLoading || !password.trim()}
                  className="w-full py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-medium text-xs rounded-xl flex items-center justify-center gap-2 transition"
                >
                  {phoneLoading ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
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
          <div className="space-y-4">
            <div className="relative flex flex-col items-center justify-center p-4 bg-white rounded-xl max-w-[260px] mx-auto shadow-inner">
              {qrLoading ? (
                <div className="h-48 w-48 flex items-center justify-center text-slate-400">
                  <RefreshCw className="w-8 h-8 animate-spin text-blue-600" />
                </div>
              ) : qrError ? (
                <div className="h-48 w-48 flex flex-col items-center justify-center text-rose-500 gap-2 p-2">
                  <AlertCircle className="w-8 h-8" />
                  <p className="text-xs">{qrError}</p>
                  <button
                    onClick={startConnection}
                    className="mt-2 text-xs px-3 py-1 bg-slate-100 text-slate-900 rounded-md font-medium"
                  >
                    Retry
                  </button>
                </div>
              ) : (
                qrImage && (
                  <img
                    src={qrImage}
                    alt="Telegram Login QR Code"
                    className="w-48 h-48 rounded-lg"
                  />
                )
              )}
            </div>

            <div className="bg-slate-800/50 rounded-xl p-3 text-left space-y-2 text-xs text-slate-300">
              <div className="flex items-center gap-2 font-medium text-slate-200">
                <Smartphone className="w-4 h-4 text-blue-400" />
                <span>How to scan:</span>
              </div>
              <ol className="list-decimal list-inside space-y-1 text-slate-400 text-[11px] pl-1">
                <li>
                  Open <strong className="text-slate-200">Telegram</strong> on your phone
                </li>
                <li>
                  Go to <strong className="text-slate-200">Settings → Devices</strong>
                </li>
                <li>
                  Tap <strong className="text-slate-200">Link Desktop Device</strong>
                </li>
                <li>Point your phone at this screen to confirm</li>
              </ol>
            </div>
          </div>
        )}

        {/* Security badge */}
        <div className="flex items-center justify-center gap-1.5 text-[11px] text-slate-500">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
          <span>Direct MTProto authentication. Password never shared.</span>
        </div>
      </div>
    </div>
  );
}
