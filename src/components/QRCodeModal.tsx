"use client";

import React, { useState, useEffect } from "react";
import { QrCode, RefreshCw, Smartphone, ShieldCheck, AlertCircle } from "lucide-react";

interface QRCodeModalProps {
  onLoginSuccess: (user: any) => void;
}

export function QRCodeModal({ onLoginSuccess }: QRCodeModalProps) {
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const startConnection = () => {
    setLoading(true);
    setError(null);
    setQrImage(null);

    let activeSocket: WebSocket | null = null;
    let pollInterval: any = null;
    let isCancelled = false;

    // Helper: Stateful HTTP Polling fallback
    const startHttpPolling = async () => {
      try {
        const res = await fetch("/api/auth/qr");
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        if (isCancelled) return;
        setQrImage(data.qrImage);
        setLoading(false);

        pollInterval = setInterval(async () => {
          if (isCancelled) return;
          try {
            const checkRes = await fetch("/api/auth/qr/check", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ qrId: data.qrId }),
            });
            const checkData = await checkRes.json();
            if (checkData.success && checkData.user) {
              clearInterval(pollInterval);
              if (checkData.sessionToken) {
                try {
                  await fetch("/api/auth/session", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ sessionToken: checkData.sessionToken }),
                  });
                  // Also persist for cross-origin upload headers (uploads go direct to worker)
                  localStorage.setItem("tg_session_token", checkData.sessionToken);
                } catch {}
              }
              onLoginSuccess(checkData.user);
            }
          } catch {}
        }, 2000);
      } catch (err: any) {
        if (!isCancelled) {
          setError(err.message || "Failed to load QR code");
          setLoading(false);
        }
      }
    };

    // 1. Try Real-Time WebSocket first (Durable Object)
    try {
      const isHttps = window.location.protocol === "https:";
      const defaultWsProtocol = isHttps ? "wss:" : "ws:";
      const remoteUrl = process.env.NEXT_PUBLIC_REMOTE_API_URL;
      
      let wsUrl = `${defaultWsProtocol}//${window.location.host}/api/auth/ws`;
      if (remoteUrl && remoteUrl.startsWith("http")) {
        const parsed = new URL(remoteUrl);
        const remoteWsProto = parsed.protocol === "https:" ? "wss:" : "ws:";
        wsUrl = `${remoteWsProto}//${parsed.host}/api/auth/ws`;
      }

      console.log("[Auth] Connecting to WebSocket:", wsUrl);
      const ws = new WebSocket(wsUrl);
      activeSocket = ws;

      ws.onmessage = async (event) => {
        if (isCancelled) return;
        try {
          const data = JSON.parse(event.data);
          if (data.type === "qr" && data.qrImage) {
            setQrImage(data.qrImage);
            setLoading(false);
          } else if (data.type === "authenticated" && data.user) {
            ws.close();
            // Establish HttpOnly session cookie
            if (data.sessionToken) {
              await fetch("/api/auth/session", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sessionToken: data.sessionToken }),
              });
              // Also persist for cross-origin upload headers (uploads go direct to worker)
              localStorage.setItem("tg_session_token", data.sessionToken);
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
          try { ws.close(); } catch {}
          startHttpPolling();
        }
      };
    } catch {
      startHttpPolling();
    }

    return () => {
      isCancelled = true;
      if (activeSocket) {
        try { activeSocket.close(); } catch {}
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
            <QrCode className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold text-white tracking-tight">
            Log in to Telegram Gallery
          </h2>
          <p className="text-xs text-slate-400">
            Scan with your official Telegram app to connect your private vault
          </p>
        </div>

        {/* QR Display Container */}
        <div className="relative flex items-center justify-center p-4 bg-white rounded-xl max-w-[260px] mx-auto shadow-inner">
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

        {/* Instructions */}
        <div className="bg-slate-800/50 rounded-xl p-3 text-left space-y-2 text-xs text-slate-300">
          <div className="flex items-center gap-2 font-medium text-slate-200">
            <Smartphone className="w-4 h-4 text-blue-400" />
            <span>How to scan:</span>
          </div>
          <ol className="list-decimal list-inside space-y-1 text-slate-400 text-[11px] pl-1">
            <li>Open <strong className="text-slate-200">Telegram</strong> on your phone</li>
            <li>Go to <strong className="text-slate-200">Settings → Devices</strong></li>
            <li>Tap <strong className="text-slate-200">Link Desktop Device</strong></li>
            <li>Point your phone at this screen to confirm</li>
          </ol>
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
