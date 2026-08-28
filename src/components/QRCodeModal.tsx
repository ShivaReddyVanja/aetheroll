"use client";

import React, { useState, useEffect } from "react";
import {
  QrCode,
  RefreshCw,
  Smartphone,
  ShieldCheck,
  AlertCircle,
  ExternalLink,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { getAuthWsUrl, getApiBaseUrl } from "@/lib/config";

interface QRCodeModalProps {
  onLoginSuccess: (user: any) => void;
}

export function QRCodeModal({ onLoginSuccess }: QRCodeModalProps) {
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Mobile responsiveness & QR toggle
  const [isMobile, setIsMobile] = useState(false);
  const [showQrOnMobile, setShowQrOnMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      const userAgent = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
      const mobileRegex = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;
      const isMobileDevice =
        mobileRegex.test(userAgent) || (typeof window !== "undefined" && window.innerWidth < 768);
      setIsMobile(isMobileDevice);
    };

    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  const startConnection = () => {
    setLoading(true);
    setError(null);
    setQrImage(null);
    setQrUrl(null);

    let activeSocket: WebSocket | null = null;
    let pollInterval: any = null;
    let isCancelled = false;

    // Helper: Stateful HTTP Polling fallback
    const startHttpPolling = async () => {
      try {
        const res = await fetch(`${getApiBaseUrl()}/api/auth/qr`, { credentials: "include" });
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        if (isCancelled) return;
        setQrImage(data.qrImage);
        if (data.qrUrl) setQrUrl(data.qrUrl);
        setLoading(false);

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
          setError(err.message || "Failed to load authentication link");
          setLoading(false);
        }
      }
    };

    // 1. Try Real-Time WebSocket first (Durable Object)
    try {
      const wsUrl = getAuthWsUrl();
      console.log("[Auth] Connecting to WebSocket:", wsUrl);
      const ws = new WebSocket(wsUrl);
      activeSocket = ws;

      ws.onmessage = async (event) => {
        if (isCancelled) return;
        try {
          const data = JSON.parse(event.data);
          if (data.type === "qr" && data.qrImage) {
            setQrImage(data.qrImage);
            if (data.qrUrl) setQrUrl(data.qrUrl);
            setLoading(false);
          } else if (data.type === "authenticated" && data.user) {
            ws.close();
            // Establish HttpOnly session cookie
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
            setError(data.error || "Authentication error");
            setLoading(false);
          }
        } catch (parseErr) {
          console.error("WS Parse Error:", parseErr);
        }
      };

      ws.onerror = () => {
        // Fallback to HTTP polling if WebSocket is blocked
        if (!qrImage && !isCancelled) {
          console.warn("[Auth] WebSocket connection unavailable, falling back to DO HTTP polling...");
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

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-6 text-center">
        {/* Header */}
        <div className="space-y-1.5">
          <div className="w-12 h-12 rounded-2xl bg-blue-600/20 text-blue-400 mx-auto flex items-center justify-center mb-3">
            {isMobile ? <Smartphone className="w-6 h-6" /> : <QrCode className="w-6 h-6" />}
          </div>
          <h2 className="text-lg font-bold text-white tracking-tight">Log in to Aetheroll</h2>
          <p className="text-xs text-slate-400">
            {isMobile
              ? "Connect your private vault directly via your official Telegram app"
              : "Scan with your official Telegram app to connect your private vault"}
          </p>
        </div>

        {/* Mobile Primary Deep Link CTA */}
        {isMobile && qrUrl && !loading && !error && (
          <div className="space-y-3">
            <a
              href={qrUrl}
              target="_self"
              className="w-full py-3.5 px-4 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-semibold text-sm rounded-xl flex items-center justify-center gap-2.5 shadow-lg shadow-blue-600/25 transition-all transform active:scale-[0.98]"
            >
              <Smartphone className="w-5 h-5" />
              <span>Open in Telegram App</span>
              <ExternalLink className="w-4 h-4 opacity-80" />
            </a>

            <button
              onClick={() => setShowQrOnMobile(!showQrOnMobile)}
              className="text-xs text-slate-400 hover:text-slate-200 flex items-center justify-center gap-1 mx-auto py-1"
            >
              <span>{showQrOnMobile ? "Hide QR Code" : "Scanning from another device? Show QR"}</span>
              {showQrOnMobile ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          </div>
        )}

        {/* QR Display Container (Shown on Desktop, or when Toggled on Mobile) */}
        {(!isMobile || showQrOnMobile || loading || error) && (
          <div className="relative flex flex-col items-center justify-center p-4 bg-white rounded-xl max-w-[260px] mx-auto shadow-inner">
            {loading ? (
              <div className="h-48 w-48 flex items-center justify-center text-slate-400">
                <RefreshCw className="w-8 h-8 animate-spin text-blue-600" />
              </div>
            ) : error ? (
              <div className="h-48 w-48 flex flex-col items-center justify-center text-rose-500 gap-2 p-2">
                <AlertCircle className="w-8 h-8" />
                <p className="text-xs">{error}</p>
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
        )}

        {/* Desktop Secondary Link */}
        {!isMobile && qrUrl && !loading && !error && (
          <a
            href={qrUrl}
            target="_self"
            className="inline-flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors"
          >
            <span>Opening on this device? Click here to open Telegram</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        )}

        {/* Instructions */}
        <div className="bg-slate-800/50 rounded-xl p-3 text-left space-y-2 text-xs text-slate-300">
          <div className="flex items-center gap-2 font-medium text-slate-200">
            <Smartphone className="w-4 h-4 text-blue-400" />
            <span>{isMobile ? "How to log in on mobile:" : "How to scan:"}</span>
          </div>
          {isMobile ? (
            <ol className="list-decimal list-inside space-y-1 text-slate-400 text-[11px] pl-1">
              <li>
                Tap <strong className="text-slate-200">Open in Telegram App</strong> above
              </li>
              <li>
                Tap <strong className="text-slate-200">Confirm</strong> inside Telegram to authorize
              </li>
              <li>Return to this browser window to complete login</li>
            </ol>
          ) : (
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
          )}
        </div>

        {/* Security badge */}
        <div className="flex items-center justify-center gap-1.5 text-[11px] text-slate-500">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
          <span>Direct MTProto authentication. Password never shared.</span>
        </div>
      </div>
    </div>
  );
}
