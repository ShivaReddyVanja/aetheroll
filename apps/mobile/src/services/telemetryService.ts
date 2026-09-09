// Telemetry and Edge Stream Diagnostic Service for Aetheroll Mobile
import { getApiBaseUrl, getSessionToken } from './api';

export interface TelemetryLogEntry {
  id: string;
  timestamp: number;
  category: 'EDGE_CACHE' | 'STREAM' | 'PREFETCH' | 'UPLOAD' | 'MTPROTO' | 'EXOPLAYER' | 'SYSTEM' | 'ERROR';
  level: 'info' | 'success' | 'warn' | 'error';
  message: string;
  meta?: any;
}

export interface StreamProbeResult {
  mediaId: string;
  url: string;
  status: number;
  statusText: string;
  edgeCache: 'HIT' | 'MISS' | 'UNKNOWN';
  contentRange: string | null;
  contentLength: string | null;
  contentType: string | null;
  acceptRanges: string | null;
  latencyMs: number;
  success: boolean;
  error?: string;
}

type LogListener = (logs: TelemetryLogEntry[]) => void;

class TelemetryService {
  private logs: TelemetryLogEntry[] = [];
  private listeners: Set<LogListener> = new Set();
  private maxLogs = 100;
  private sseAbortController: AbortController | null = null;
  private isSseConnecting = false;

  constructor() {
    this.addLog({
      category: 'SYSTEM',
      level: 'info',
      message: '📱 Mobile Telemetry & Edge Diagnostic Engine Initialized',
    });
  }

  public getLogs(): TelemetryLogEntry[] {
    return [...this.logs];
  }

  public subscribe(listener: LogListener): () => void {
    this.listeners.add(listener);
    listener([...this.logs]);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public clearLogs(): void {
    this.logs = [];
    this.notify();
  }

  public addLog(entry: Omit<TelemetryLogEntry, 'id' | 'timestamp'>): TelemetryLogEntry {
    const fullEntry: TelemetryLogEntry = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: Date.now(),
      ...entry,
    };

    this.logs.unshift(fullEntry);
    if (this.logs.length > this.maxLogs) {
      this.logs.pop();
    }
    this.notify();

    // Asynchronously send to backend telemetry ingestion endpoint if available
    this.sendRemoteLog(fullEntry).catch(() => {});

    return fullEntry;
  }

  private notify(): void {
    const snapshot = [...this.logs];
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (err) {
        console.warn('[TelemetryService] Listener error:', err);
      }
    }
  }

  private async sendRemoteLog(entry: TelemetryLogEntry): Promise<void> {
    try {
      const baseUrl = getApiBaseUrl();
      const token = getSessionToken();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-enable-telemetry': 'true',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
        headers['x-tg-session'] = token;
      }

      await fetch(`${baseUrl}/api/logs/log`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          category: entry.category,
          level: entry.level,
          message: entry.message,
          meta: entry.meta,
        }),
      });
    } catch {
      // Non-blocking: remote telemetry fail should not impact app
    }
  }

  /**
   * Directly probes the backend /api/stream endpoint with an HTTP Range request
   * to measure Cloudflare Edge Cache headers, latency, and response status.
   */
  public async probeStream(mediaId: string, rangeHeader: string = 'bytes=0-1024'): Promise<StreamProbeResult> {
    const baseUrl = getApiBaseUrl();
    const token = getSessionToken();
    const url = `${baseUrl}/api/stream?media_id=${encodeURIComponent(mediaId)}${
      token ? `&session_token=${encodeURIComponent(token)}` : ''
    }`;

    const startTime = Date.now();
    this.addLog({
      category: 'STREAM',
      level: 'info',
      message: `⚡ [Stream Probe] Probing edge: ${mediaId.slice(0, 8)}... (${rangeHeader})`,
      meta: { mediaId, rangeHeader, url },
    });

    try {
      const headers: Record<string, string> = {
        Range: rangeHeader,
        'x-enable-telemetry': 'true',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
        headers['x-tg-session'] = token;
      }

      const res = await fetch(url, {
        method: 'GET',
        headers,
      });

      const latencyMs = Date.now() - startTime;
      const edgeCacheHeader = res.headers.get('x-edge-cache')?.toUpperCase() || 'UNKNOWN';
      const edgeCache: 'HIT' | 'MISS' | 'UNKNOWN' =
        edgeCacheHeader === 'HIT' ? 'HIT' : edgeCacheHeader === 'MISS' ? 'MISS' : 'UNKNOWN';
      const contentRange = res.headers.get('content-range');
      const contentLength = res.headers.get('content-length');
      const contentType = res.headers.get('content-type');
      const acceptRanges = res.headers.get('accept-ranges');

      const isSuccess = res.status === 206 || res.status === 200;

      const result: StreamProbeResult = {
        mediaId,
        url,
        status: res.status,
        statusText: res.statusText || (res.status === 206 ? 'Partial Content' : 'OK'),
        edgeCache,
        contentRange,
        contentLength,
        contentType,
        acceptRanges,
        latencyMs,
        success: isSuccess,
      };

      if (isSuccess) {
        const edgeTag = edgeCache === 'HIT' ? '🟢 [Edge HIT ⚡ Sub-3ms]' : '🟡 [Edge MISS -> Warm DO]';
        this.addLog({
          category: 'EDGE_CACHE',
          level: 'success',
          message: `${edgeTag} Status ${res.status} in ${latencyMs}ms | Range: ${contentRange || contentLength || 'unknown'}`,
          meta: result,
        });
      } else {
        this.addLog({
          category: 'STREAM',
          level: 'error',
          message: `❌ [Stream Probe Failed] HTTP ${res.status}: ${res.statusText || 'Error'} (${latencyMs}ms)`,
          meta: result,
        });
      }

      return result;
    } catch (err: any) {
      const latencyMs = Date.now() - startTime;
      const errorMsg = err?.message || String(err);
      this.addLog({
        category: 'ERROR',
        level: 'error',
        message: `❌ [Stream Network Error] ${errorMsg} (${latencyMs}ms)`,
        meta: { error: errorMsg },
      });

      return {
        mediaId,
        url,
        status: 0,
        statusText: 'Network Request Failed',
        edgeCache: 'UNKNOWN',
        contentRange: null,
        contentLength: null,
        contentType: null,
        acceptRanges: null,
        latencyMs,
        success: false,
        error: errorMsg,
      };
    }
  }

  /**
   * Connect to backend SSE telemetry stream (/api/logs/stream) to pipe backend & DO logs
   * into the app in real time.
   */
  public connectToRemoteStream(): void {
    if (this.isSseConnecting || this.sseAbortController) return;

    const baseUrl = getApiBaseUrl();
    const token = getSessionToken();
    const sseUrl = `${baseUrl}/api/logs/stream${token ? `?session_token=${encodeURIComponent(token)}` : ''}`;

    this.isSseConnecting = true;
    this.sseAbortController = new AbortController();

    this.addLog({
      category: 'SYSTEM',
      level: 'info',
      message: '🛰️ Connecting to Cloudflare Telemetry SSE stream...',
    });

    // Start background stream fetch using standard fetch with ReadableStream
    (async () => {
      try {
        const headers: Record<string, string> = {
          Accept: 'text/event-stream',
          'x-enable-telemetry': 'true',
        };
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
          headers['x-tg-session'] = token;
        }

        const res = await fetch(sseUrl, {
          method: 'GET',
          headers,
          signal: this.sseAbortController?.signal,
        });

        if (!res.ok) {
          this.isSseConnecting = false;
          this.sseAbortController = null;
          return;
        }

        this.addLog({
          category: 'SYSTEM',
          level: 'success',
          message: '🟢 Live Telemetry Stream Connected to Cloudflare Edge',
        });
        this.isSseConnecting = false;

        // In React Native / mobile environment, read SSE chunks if body reader exists
        const resBody = (res as any).body;
        if (resBody && typeof resBody.getReader === 'function') {
          const reader = resBody.getReader();
          const decoder = typeof (globalThis as any).TextDecoder === 'function' ? new (globalThis as any).TextDecoder() : null;
          let buffer = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunkStr = decoder
              ? decoder.decode(value, { stream: true })
              : String.fromCharCode.apply(null, Array.from(value as Uint8Array));
            buffer += chunkStr;
            const lines = buffer.split('\n\n');
            buffer = lines.pop() || '';

            for (const block of lines) {
              const trimmed = block.trim();
              if (trimmed.startsWith('data:')) {
                try {
                  const jsonStr = trimmed.replace(/^data:\s*/, '');
                  const parsed = JSON.parse(jsonStr);
                  if (parsed && parsed.message) {
                    // Add server-originated log
                    this.logs.unshift({
                      id: parsed.id || Math.random().toString(36).substring(2, 9),
                      timestamp: parsed.timestamp || Date.now(),
                      category: parsed.category || 'STREAM',
                      level: parsed.level || 'info',
                      message: `☁️ [Backend] ${parsed.message}`,
                      meta: parsed.meta,
                    });
                    if (this.logs.length > this.maxLogs) this.logs.pop();
                    this.notify();
                  }
                } catch {}
              }
            }
          }
        }
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          // Reconnection will happen on next viewer open
        }
      } finally {
        this.isSseConnecting = false;
        this.sseAbortController = null;
      }
    })();
  }

  public disconnectRemoteStream(): void {
    if (this.sseAbortController) {
      this.sseAbortController.abort();
      this.sseAbortController = null;
    }
    this.isSseConnecting = false;
  }
}

export const telemetryService = new TelemetryService();
