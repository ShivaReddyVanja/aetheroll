import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Share,
  ActivityIndicator,
} from 'react-native';
import {
  X,
  Activity,
  RefreshCw,
  Share2,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Radio,
  Zap,
} from 'lucide-react-native';
import {
  telemetryService,
  TelemetryLogEntry,
  StreamProbeResult,
} from '../services/telemetryService';

interface StreamTelemetryModalProps {
  visible: boolean;
  onClose: () => void;
  mediaId?: string;
  isVideo?: boolean;
  playerState?: {
    isBuffering: boolean;
    isPlaying: boolean;
    currentTime: number;
    duration: number;
  };
}

export function StreamTelemetryModal({
  visible,
  onClose,
  mediaId,
  isVideo,
  playerState,
}: StreamTelemetryModalProps) {
  const [logs, setLogs] = useState<TelemetryLogEntry[]>([]);
  const [probeResult, setProbeResult] = useState<StreamProbeResult | null>(null);
  const [isProbing, setIsProbing] = useState(false);

  useEffect(() => {
    if (!visible) return;

    const unsubscribe = telemetryService.subscribe((updatedLogs) => {
      setLogs(updatedLogs);
    });

    // Auto-probe the media stream when modal opens
    if (mediaId) {
      runProbe(mediaId);
    }

    return () => {
      unsubscribe();
    };
  }, [visible, mediaId]);

  const runProbe = async (id: string) => {
    setIsProbing(true);
    try {
      const res = await telemetryService.probeStream(id, 'bytes=0-2097151');
      setProbeResult(res);
    } finally {
      setIsProbing(false);
    }
  };

  const handleShareLogs = async () => {
    try {
      const text = logs
        .map(
          (l) =>
            `[${new Date(l.timestamp).toLocaleTimeString()}] [${l.category}] [${l.level.toUpperCase()}] ${l.message}`
        )
        .join('\n');
      await Share.share({
        title: 'Aetheroll Edge Stream Telemetry Logs',
        message: text,
      });
    } catch {}
  };

  const formatBytes = (bytesStr: string | null) => {
    if (!bytesStr) return '--';
    const bytes = parseInt(bytesStr, 10);
    if (isNaN(bytes)) return bytesStr;
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${bytes} B`;
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheetContainer}>
          {/* Header */}
          <View style={styles.headerRow}>
            <View style={styles.headerTitleRow}>
              <View style={styles.livePulseOuter}>
                <View style={styles.livePulseDot} />
              </View>
              <Text style={styles.headerTitle}>Edge Stream Telemetry</Text>
            </View>

            <View style={styles.headerActions}>
              {mediaId && (
                <TouchableOpacity
                  style={styles.iconButton}
                  onPress={() => runProbe(mediaId)}
                  disabled={isProbing}
                >
                  {isProbing ? (
                    <ActivityIndicator size="small" color="#38BDF8" />
                  ) : (
                    <RefreshCw size={17} color="#38BDF8" />
                  )}
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.iconButton} onPress={handleShareLogs}>
                <Share2 size={17} color="#94A3B8" />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.iconButton}
                onPress={() => telemetryService.clearLogs()}
              >
                <Trash2 size={17} color="#94A3B8" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.closeButton} onPress={onClose}>
                <X size={18} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
          </View>

          {/* Quick Metrics Cards */}
          <View style={styles.metricsGrid}>
            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>HTTP STATUS</Text>
              <View style={styles.metricValueRow}>
                {probeResult?.success ? (
                  <CheckCircle2 size={14} color="#10B981" />
                ) : (
                  <AlertTriangle size={14} color="#F59E0B" />
                )}
                <Text
                  style={[
                    styles.metricValue,
                    { color: probeResult?.success ? '#10B981' : '#F59E0B' },
                  ]}
                >
                  {probeResult ? `${probeResult.status} ${probeResult.statusText}` : 'Probing...'}
                </Text>
              </View>
            </View>

            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>EDGE CACHE</Text>
              <View style={styles.metricValueRow}>
                <Zap
                  size={14}
                  color={
                    probeResult?.edgeCache === 'HIT'
                      ? '#10B981'
                      : probeResult?.edgeCache === 'MISS'
                      ? '#F59E0B'
                      : '#94A3B8'
                  }
                />
                <Text
                  style={[
                    styles.metricValue,
                    {
                      color:
                        probeResult?.edgeCache === 'HIT'
                          ? '#10B981'
                          : probeResult?.edgeCache === 'MISS'
                          ? '#F59E0B'
                          : '#E2E8F0',
                    },
                  ]}
                >
                  {probeResult?.edgeCache === 'HIT'
                    ? 'HIT (⚡ 2ms)'
                    : probeResult?.edgeCache === 'MISS'
                    ? 'MISS (MTProto DO)'
                    : 'Unknown'}
                </Text>
              </View>
            </View>

            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>LATENCY</Text>
              <Text style={[styles.metricValue, { color: '#38BDF8' }]}>
                {probeResult ? `${probeResult.latencyMs} ms` : '--'}
              </Text>
            </View>

            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>EXOPLAYER STATE</Text>
              <Text
                style={[
                  styles.metricValue,
                  {
                    color: playerState?.isBuffering
                      ? '#F59E0B'
                      : playerState?.isPlaying
                      ? '#10B981'
                      : '#94A3B8',
                  },
                ]}
              >
                {playerState
                  ? playerState.isBuffering
                    ? 'Buffering...'
                    : playerState.isPlaying
                    ? 'Streaming ▶'
                    : 'Paused ⏸'
                  : 'Ready'}
              </Text>
            </View>
          </View>

          {/* Range & Payload Details */}
          {probeResult && (
            <View style={styles.rangeDetailsBox}>
              <Text style={styles.rangeText}>
                <Text style={styles.rangeBold}>Range: </Text>
                {probeResult.contentRange || 'full'}
                {'  •  '}
                <Text style={styles.rangeBold}>Size: </Text>
                {formatBytes(probeResult.contentLength)}
                {'  •  '}
                <Text style={styles.rangeBold}>Type: </Text>
                {probeResult.contentType || 'video/mp4'}
              </Text>
            </View>
          )}

          {/* Terminal Log Output */}
          <View style={styles.terminalHeader}>
            <Radio size={13} color="#38BDF8" />
            <Text style={styles.terminalTitle}>
              Real-Time Stream Telemetry Log ({logs.length} events)
            </Text>
          </View>

          <ScrollView style={styles.terminalBody} showsVerticalScrollIndicator>
            {logs.length === 0 ? (
              <Text style={styles.emptyLogText}>No telemetry events yet. Probing stream...</Text>
            ) : (
              logs.map((log) => {
                const categoryColor =
                  log.category === 'EDGE_CACHE'
                    ? '#10B981'
                    : log.category === 'STREAM'
                    ? '#38BDF8'
                    : log.category === 'EXOPLAYER'
                    ? '#A78BFA'
                    : log.category === 'ERROR'
                    ? '#EF4444'
                    : '#94A3B8';

                const levelColor =
                  log.level === 'error'
                    ? '#EF4444'
                    : log.level === 'warn'
                    ? '#F59E0B'
                    : log.level === 'success'
                    ? '#10B981'
                    : '#E2E8F0';

                return (
                  <View key={log.id} style={styles.logRow}>
                    <Text style={styles.logTime}>
                      {new Date(log.timestamp).toTimeString().split(' ')[0]}
                    </Text>
                    <View style={[styles.logTag, { borderColor: categoryColor }]}>
                      <Text style={[styles.logTagText, { color: categoryColor }]}>
                        {log.category}
                      </Text>
                    </View>
                    <Text style={[styles.logMessage, { color: levelColor }]}>
                      {log.message}
                    </Text>
                  </View>
                );
              })
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'flex-end',
  },
  sheetContainer: {
    backgroundColor: '#0F172A',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    maxHeight: '85%',
    minHeight: 480,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 24,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  livePulseOuter: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: 'rgba(16, 185, 129, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  livePulseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  iconButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginVertical: 12,
  },
  metricCard: {
    flex: 1,
    minWidth: '46%',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 10,
    padding: 10,
  },
  metricLabel: {
    color: '#64748B',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  metricValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  metricValue: {
    fontSize: 13,
    fontWeight: '600',
  },
  rangeDetailsBox: {
    backgroundColor: 'rgba(2, 6, 23, 0.6)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.2)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 10,
  },
  rangeText: {
    color: '#94A3B8',
    fontSize: 11,
    fontFamily: 'monospace',
  },
  rangeBold: {
    color: '#38BDF8',
    fontWeight: '700',
  },
  terminalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
  },
  terminalTitle: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  terminalBody: {
    flex: 1,
    backgroundColor: '#020617',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.07)',
    padding: 10,
  },
  emptyLogText: {
    color: '#64748B',
    fontSize: 12,
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 24,
  },
  logRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 7,
    gap: 6,
  },
  logTime: {
    color: '#475569',
    fontSize: 10,
    fontFamily: 'monospace',
    marginTop: 2,
  },
  logTag: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  logTagText: {
    fontSize: 9,
    fontWeight: '700',
  },
  logMessage: {
    flex: 1,
    fontSize: 11,
    fontFamily: 'monospace',
    lineHeight: 15,
  },
});
