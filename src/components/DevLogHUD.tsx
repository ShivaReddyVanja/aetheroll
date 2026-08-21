"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Terminal,
  Activity,
  X,
  Trash2,
  Minimize2,
  Maximize2,
  Search,
  CheckCircle2,
  AlertTriangle,
  Info,
  Radio,
  Zap,
  Copy,
  Check,
} from "lucide-react";

export interface LogEntry {
  id: string;
  timestamp: number;
  category: "EDGE_CACHE" | "STREAM" | "PREFETCH" | "UPLOAD" | "MTPROTO" | "RAM" | "AUTH" | "SYSTEM";
  level: "info" | "success" | "warn" | "error";
  message: string;
  meta?: Record<string, any>;
}

export function DevLogHUD() {
  const [isEnabled, setIsEnabled] = useState<boolean | null>(() => {
    const explicit = process.env.NEXT_PUBLIC_ENABLE_TELEMETRY;
    if (explicit === "false" || explicit === "0") return false;
    if (explicit === "true" || explicit === "1") return true;
    return null; // Will query /api/logs/status
  });

  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Check server telemetry status if not explicitly overridden by client env
  useEffect(() => {
    if (isEnabled !== null) return;

    const isRemote =
      (process.env.NEXT_PUBLIC_BACKEND_MODE || "").toLowerCase() === "prod" ||
      (process.env.NEXT_PUBLIC_BACKEND_MODE || "").toLowerCase() === "remote" ||
      (typeof window !== "undefined" && window.location.hostname === "localhost");

    const remoteBase =
      process.env.NEXT_PUBLIC_REMOTE_API_URL ||
      "https://telegram-gallery.shivareddyvanja.workers.dev";

    const statusUrl = isRemote
      ? `${remoteBase.replace(/\/$/, "")}/api/logs/status`
      : "/api/logs/status";

    fetch(statusUrl, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : { enabled: false }))
      .then((data: any) => {
        setIsEnabled(Boolean(data?.enabled));
      })
      .catch(() => {
        setIsEnabled(false);
      });
  }, [isEnabled]);

  // Connect to SSE stream when telemetry is confirmed enabled
  useEffect(() => {
    if (!isEnabled) return;
    let reconnectTimeout: any = null;

    function connectSSE() {
      try {
        const isRemote =
          (process.env.NEXT_PUBLIC_BACKEND_MODE || "").toLowerCase() === "prod" ||
          (process.env.NEXT_PUBLIC_BACKEND_MODE || "").toLowerCase() === "remote" ||
          (typeof window !== "undefined" && window.location.hostname === "localhost");

        const remoteBase =
          process.env.NEXT_PUBLIC_REMOTE_API_URL ||
          "https://telegram-gallery.shivareddyvanja.workers.dev";

        const streamUrl = isRemote
          ? `${remoteBase.replace(/\/$/, "")}/api/logs/stream`
          : "/api/logs/stream";

        const es = new EventSource(streamUrl, { withCredentials: true });
        eventSourceRef.current = es;

        es.onopen = () => {
          setIsConnected(true);
        };

        es.onmessage = (event) => {
          try {
            if (!event.data || event.data.startsWith(":")) return;
            const data: LogEntry = JSON.parse(event.data);
            setLogs((prev) => {
              if (prev.some((l) => l.id === data.id)) return prev;
              const next = [...prev, data];
              return next.length > 300 ? next.slice(next.length - 300) : next;
            });
          } catch {}
        };

        es.onerror = () => {
          setIsConnected(false);
          es.close();
          // Auto reconnect after 3s
          reconnectTimeout = setTimeout(connectSSE, 3000);
        };
      } catch (err) {
        setIsConnected(false);
        reconnectTimeout = setTimeout(connectSSE, 3000);
      }
    }

    connectSSE();

    return () => {
      if (eventSourceRef.current) eventSourceRef.current.close();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
    };
  }, [isEnabled]);

  // Keyboard shortcut (Tilde ~ or Backquote `) to toggle HUD
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "`" && !["INPUT", "TEXTAREA"].includes((e.target as HTMLElement)?.tagName)) {
        setIsOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Auto-scroll on new log
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, autoScroll, isOpen]);

  const categories = ["ALL", "EDGE_CACHE", "STREAM", "PREFETCH", "MTPROTO", "UPLOAD", "RAM"];

  const filteredLogs = logs.filter((log) => {
    const matchesCategory = activeCategory === "ALL" || log.category === activeCategory;
    const matchesSearch =
      searchQuery === "" ||
      log.message.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.category.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const getCategoryColor = (cat: string) => {
    switch (cat) {
      case "EDGE_CACHE":
        return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
      case "STREAM":
        return "bg-purple-500/15 text-purple-400 border-purple-500/30";
      case "PREFETCH":
        return "bg-cyan-500/15 text-cyan-400 border-cyan-500/30";
      case "MTPROTO":
        return "bg-amber-500/15 text-amber-400 border-amber-500/30";
      case "UPLOAD":
        return "bg-blue-500/15 text-blue-400 border-blue-500/30";
      case "RAM":
        return "bg-yellow-500/15 text-yellow-400 border-yellow-500/30";
      default:
        return "bg-zinc-500/15 text-zinc-400 border-zinc-500/30";
    }
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    const h = String(d.getHours()).padStart(2, "0");
    const m = String(d.getMinutes()).padStart(2, "0");
    const s = String(d.getSeconds()).padStart(2, "0");
    const ms = String(d.getMilliseconds()).padStart(3, "0");
    return `${h}:${m}:${s}.${ms}`;
  };

  const handleCopyLogs = () => {
    const text = filteredLogs.map((l) => `[${formatTime(l.timestamp)}] [${l.category}] ${l.message}`).join("\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // If telemetry is disabled by server flag or client env, unmount entirely
  if (!isEnabled) {
    return null;
  }

  // 1. Collapsed Floating Pill
  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 right-4 z-50 flex items-center gap-2.5 px-3.5 py-2 rounded-full bg-zinc-900/90 hover:bg-zinc-800 text-white border border-zinc-700 shadow-2xl backdrop-blur-md transition-all hover:scale-105 group active:scale-95 text-xs font-medium"
      >
        <span className="relative flex h-2 w-2">
          {isConnected && (
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
          )}
          <span
            className={`relative inline-flex rounded-full h-2 w-2 ${
              isConnected ? "bg-emerald-500" : "bg-rose-500"
            }`}
          ></span>
        </span>
        <Zap className="w-3.5 h-3.5 text-amber-400 group-hover:rotate-12 transition-transform" />
        <span>Engine Telemetry</span>
        <span className="px-1.5 py-0.5 rounded-full bg-zinc-800 text-[10px] text-zinc-300 font-mono">
          {logs.length}
        </span>
      </button>
    );
  }

  // 2. Expanded Dev HUD Drawer
  return (
    <div
      className={`fixed z-50 transition-all duration-200 ${
        isExpanded
          ? "inset-4 md:inset-8"
          : "bottom-4 right-4 w-[95vw] md:w-[640px] h-[520px] max-h-[90vh]"
      } flex flex-col rounded-xl bg-zinc-950/95 border border-zinc-800 shadow-2xl backdrop-blur-2xl text-zinc-200 overflow-hidden font-sans`}
    >
      {/* Top Header Bar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-zinc-900/80 border-b border-zinc-800 select-none">
        <div className="flex items-center gap-2.5">
          <Terminal className="w-4 h-4 text-amber-400" />
          <span className="text-xs font-semibold tracking-wide text-zinc-100 uppercase">
            Engine Live Telemetry
          </span>
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-zinc-800/80 border border-zinc-700 text-[10px] font-mono">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                isConnected ? "bg-emerald-400 animate-pulse" : "bg-rose-400"
              }`}
            />
            <span className={isConnected ? "text-emerald-300" : "text-rose-300"}>
              {isConnected ? "LIVE STREAM" : "DISCONNECTED"}
            </span>
          </div>
        </div>

        {/* Window Controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={handleCopyLogs}
            title="Copy Filtered Logs"
            className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={() => setLogs([])}
            title="Clear Logs"
            className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-400 hover:text-rose-400 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setIsExpanded((prev) => !prev)}
            title={isExpanded ? "Collapse" : "Maximize"}
            className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
          >
            {isExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={() => setIsOpen(false)}
            title="Close (Press ` to toggle)"
            className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Category Pills & Search Filter */}
      <div className="flex flex-col gap-2 p-2.5 bg-zinc-900/40 border-b border-zinc-800/80">
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
          {categories.map((cat) => {
            const count =
              cat === "ALL" ? logs.length : logs.filter((l) => l.category === cat).length;
            const isActive = activeCategory === cat;
            return (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-mono tracking-tight transition-all flex items-center gap-1.5 whitespace-nowrap ${
                  isActive
                    ? "bg-zinc-100 text-zinc-900 font-semibold shadow-sm"
                    : "bg-zinc-900 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/80 border border-zinc-800"
                }`}
              >
                <span>{cat}</span>
                <span
                  className={`text-[9px] px-1 rounded ${
                    isActive ? "bg-zinc-300 text-zinc-900" : "bg-zinc-800 text-zinc-400"
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Search Input Bar */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              type="text"
              placeholder="Filter logs by keyword, offset, chunk..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1 rounded-md bg-zinc-900/90 border border-zinc-800 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-amber-500/50"
            />
          </div>
          <button
            onClick={() => setAutoScroll((prev) => !prev)}
            className={`px-2.5 py-1 rounded-md text-[11px] font-mono border transition-all ${
              autoScroll
                ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                : "bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-zinc-200"
            }`}
          >
            Auto-Scroll: {autoScroll ? "ON" : "OFF"}
          </button>
        </div>
      </div>

      {/* Main Console Output Area */}
      <div
        ref={scrollRef}
        className="flex-1 p-3 overflow-y-auto font-mono text-[11px] leading-relaxed space-y-1.5 selection:bg-amber-500/30 selection:text-white"
      >
        {filteredLogs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-zinc-500 gap-2 select-none py-12">
            <Radio className="w-8 h-8 stroke-[1.5] text-zinc-600 animate-pulse" />
            <p className="text-xs">Waiting for telemetry events...</p>
            <p className="text-[10px] text-zinc-600">
              Hover over photos or play videos to watch chunks stream in real-time.
            </p>
          </div>
        ) : (
          filteredLogs.map((log) => {
            const isExpandedMeta = expandedLogId === log.id;
            return (
              <div
                key={log.id}
                className="group flex flex-col p-1.5 rounded hover:bg-zinc-900/60 transition-colors border border-transparent hover:border-zinc-800/60"
              >
                <div className="flex items-start gap-2">
                  <span className="text-zinc-500 select-none shrink-0 font-mono text-[10px] pt-0.5">
                    {formatTime(log.timestamp)}
                  </span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[9px] font-bold border uppercase shrink-0 ${getCategoryColor(
                      log.category
                    )}`}
                  >
                    {log.category}
                  </span>
                  <span
                    className={`flex-1 break-all ${
                      log.level === "error"
                        ? "text-rose-400"
                        : log.level === "warn"
                        ? "text-amber-300"
                        : log.level === "success"
                        ? "text-emerald-300"
                        : "text-zinc-200"
                    }`}
                  >
                    {log.message}
                  </span>
                  {log.meta && (
                    <button
                      onClick={() => setExpandedLogId(isExpandedMeta ? null : log.id)}
                      className="text-[10px] text-zinc-500 hover:text-zinc-300 underline shrink-0 px-1"
                    >
                      {isExpandedMeta ? "hide meta" : "meta"}
                    </button>
                  )}
                </div>

                {/* Collapsible Metadata Inspector */}
                {isExpandedMeta && log.meta && (
                  <pre className="mt-1.5 p-2 rounded bg-zinc-900 border border-zinc-800 text-[10px] text-zinc-300 overflow-x-auto">
                    {JSON.stringify(log.meta, null, 2)}
                  </pre>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Footer Status Bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-900/90 border-t border-zinc-800 text-[10px] text-zinc-400 font-mono select-none">
        <div className="flex items-center gap-2">
          <span>Events: {filteredLogs.length} / {logs.length}</span>
          <span>•</span>
          <span className="text-zinc-500">Shortcut: Press ` to toggle</span>
        </div>
        <div className="text-zinc-500">
          RAM Cache Limit: ≤4MB | Edge Cache: Active
        </div>
      </div>
    </div>
  );
}
