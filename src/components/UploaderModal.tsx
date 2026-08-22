"use client";

import React, { useState, useRef } from "react";
import {
  X,
  Upload,
  CheckCircle2,
  AlertCircle,
  FileImage,
  Film,
  RefreshCw,
  Plus,
} from "lucide-react";
import { generateBlurHashAndThumbnail, generateVideoThumbnailAndMetadata } from "@/lib/blurhash";
import { extractExifMetadata } from "@/lib/exif";
import { AETHEROLL_WORKER_URL } from "@/lib/config";

const WORKER_URL = AETHEROLL_WORKER_URL;
export const MAX_TELEGRAM_FILE_SIZE = 2000 * 1024 * 1024;

interface UploaderModalProps {
  channelId: string;
  channelName: string;
  onClose: () => void;
  onUploadComplete: () => void;
}

interface UploadTask {
  id: string;
  file: File;
  status: "pending" | "processing" | "uploading" | "done" | "error";
  progress: number;
  uploadedBytes?: number;
  speedFormatted?: string;
  durationFormatted?: string;
  error?: string;
  previewUrl?: string;
  isVideo: boolean;
  sizeFormatted: string;
}

export function UploaderModal({
  channelId,
  channelName,
  onClose,
  onUploadComplete,
}: UploaderModalProps) {
  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [currentSpeed, setCurrentSpeed] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeWsRef = useRef<WebSocket | null>(null);
  const isCancelledRef = useRef(false);

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const formatSpeed = (bytesPerSec: number) => {
    if (bytesPerSec <= 0) return "0 KB/s";
    if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
    return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
  };

  const formatDuration = (ms: number) => {
    const totalSec = Math.round(ms / 1000);
    if (totalSec < 60) return `${totalSec}s`;
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${mins}m ${secs}s`;
  };

  const handleFilesSelected = (files: FileList | File[] | null) => {
    if (!files) return;
    const newTasks: UploadTask[] = Array.from(files).map((f) => {
      const isOversized = f.size > MAX_TELEGRAM_FILE_SIZE;
      return {
        id: crypto.randomUUID(),
        file: f,
        status: isOversized ? ("error" as const) : ("pending" as const),
        progress: 0,
        previewUrl: f.type.startsWith("image/") ? URL.createObjectURL(f) : undefined,
        isVideo: f.type.startsWith("video/"),
        sizeFormatted: formatFileSize(f.size),
        error: isOversized ? "Exceeds 2 GB limit" : undefined,
      };
    });
    setTasks((prev) => [...prev, ...newTasks]);
  };

  const handleRemoveTask = (id: string) => {
    // If the removed task is currently uploading/processing, close its WebSocket
    const target = tasks.find((t) => t.id === id);
    if (target && (target.status === "uploading" || target.status === "processing")) {
      try {
        activeWsRef.current?.close();
      } catch {}
    }
    setTasks((prev) => prev.filter((t) => t.id !== id));
  };

  const cancelAllUploads = () => {
    isCancelledRef.current = true;
    try {
      activeWsRef.current?.close();
    } catch {}
    setIsUploading(false);
    setCurrentSpeed(null);
    setShowCancelConfirm(false);
    onClose();
  };

  const handleCloseOrCancel = () => {
    if (isUploading) {
      setShowCancelConfirm(true);
    } else {
      onClose();
    }
  };

  const startUpload = async () => {
    const validTasks = tasks.filter((t) => t.status === "pending" && t.file.size <= MAX_TELEGRAM_FILE_SIZE);
    if (validTasks.length === 0 || isUploading) return;
    setIsUploading(true);
    isCancelledRef.current = false;

    for (let i = 0; i < tasks.length; i++) {
      if (isCancelledRef.current) break;
      const task = tasks[i];
      if (task.status === "done" || task.status === "error" || task.file.size > MAX_TELEGRAM_FILE_SIZE) continue;

      setTasks((prev) =>
        prev.map((t, idx) => (idx === i ? { ...t, status: "processing", progress: 5 } : t))
      );

      try {
        const file = task.file;
        const isVideo = file.type.startsWith("video/");
        let width = 1920;
        let height = 1080;
        let blurHash = "LEHV6nWB2yk8pyo0adR*.7kCMdnj";
        let thumbnailBase64 = "";
        let duration = 0;

        if (!isVideo) {
          try {
            const bhResult = await generateBlurHashAndThumbnail(file);
            width = bhResult.width;
            height = bhResult.height;
            blurHash = bhResult.blurHash;
            thumbnailBase64 = bhResult.thumbnailBase64;
          } catch (e) {
            console.warn("BlurHash skipped for image", file.name, e);
          }
        } else {
          try {
            const vResult = await generateVideoThumbnailAndMetadata(file);
            width = vResult.width;
            height = vResult.height;
            blurHash = vResult.blurHash;
            thumbnailBase64 = vResult.thumbnailBase64;
            duration = vResult.duration;
          } catch (e) {
            console.warn("Video thumbnail generation skipped for", file.name, e);
          }
        }

        const exif = await extractExifMetadata(file);
        const CHUNK_SIZE = 512 * 1024; // Aligned directly with Telegram 512KB MTProto parts
        const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

        setTasks((prev) =>
          prev.map((t, idx) =>
            idx === i
              ? {
                  ...t,
                  status: "uploading",
                  progress: 0,
                }
              : t
          )
        );

        const completeData = await new Promise<{ success: boolean; item?: any; mediaId?: string; error?: string }>((resolve, reject) => {
          const wsBaseUrl = WORKER_URL.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
          const ws = new WebSocket(`${wsBaseUrl}/api/media/upload/ws`);
          ws.binaryType = "arraybuffer";
          activeWsRef.current = ws;

          let nextChunkToSend = 0;
          let ackedChunks = 0;
          let settled = false; // Guard against double resolve/reject
          const PIPELINE_WINDOW = 4; // Sliding window of 4 active parts

          const uploadStartTime = Date.now();
          let lastSampleTime = Date.now();
          let lastSampleAckedBytes = 0;

          const settledResolve = (val: any) => { if (!settled) { settled = true; resolve(val); } };
          const settledReject = (err: any) => { if (!settled) { settled = true; reject(err); } };

          // 45-second inactivity watchdog
          let watchdogTimer: any = null;
          const resetWatchdog = () => {
            if (watchdogTimer) clearTimeout(watchdogTimer);
            watchdogTimer = setTimeout(() => {
              try { ws.close(); } catch {}
              settledReject(new Error("Upload connection timed out (no response from server)"));
            }, 45000);
          };

          const sendChunk = async (chunkIndex: number) => {
            if (chunkIndex >= totalChunks) return;
            const startByte = chunkIndex * CHUNK_SIZE;
            const endByte = Math.min(startByte + CHUNK_SIZE, file.size);
            const sliceBlob = file.slice(startByte, endByte);
            const sliceBuffer = await sliceBlob.arrayBuffer();

            const frameBuffer = new Uint8Array(4 + sliceBuffer.byteLength);
            const view = new DataView(frameBuffer.buffer);
            view.setInt32(0, chunkIndex, false);
            frameBuffer.set(new Uint8Array(sliceBuffer), 4);

            if (ws.readyState === WebSocket.OPEN) {
              ws.send(frameBuffer);
              resetWatchdog();
            }
          };

          const pumpPipeline = async () => {
            while (nextChunkToSend < totalChunks && (nextChunkToSend - ackedChunks) < PIPELINE_WINDOW) {
              const toSend = nextChunkToSend++;
              await sendChunk(toSend); // await ensures slice completes before advancing window
            }
          };

          ws.onopen = () => {
            resetWatchdog();
            ws.send(JSON.stringify({
              type: "init",
              fileName: file.name,
              fileSize: file.size,
              channelId,
              mimeType: file.type || (isVideo ? "video/mp4" : "image/jpeg"),
              totalChunks,
              width,
              height,
              duration: isVideo && duration > 0 ? duration : null,
              blurHash,
              thumbnailBase64,
              capturedAt: exif.capturedAt || new Date().toISOString(),
            }));
          };

          ws.onmessage = async (event) => {
            resetWatchdog();
            try {
              const data = JSON.parse(event.data);
              if (data.type === "init_ok") {
                nextChunkToSend = 0;
                ackedChunks = 0;
                await pumpPipeline();
              } else if (data.type === "part_ack") {
                ackedChunks++;
                const uploadedBytes = Math.min(ackedChunks * CHUNK_SIZE, file.size);
                const percent = data.progressPercent ?? Math.min(Math.round((uploadedBytes / file.size) * 100), 100);

                // Compute rolling speed sample every 400ms+
                const now = Date.now();
                const deltaMs = now - lastSampleTime;
                if (deltaMs >= 400) {
                  const bytesDelta = uploadedBytes - lastSampleAckedBytes;
                  const instantSpeed = (bytesDelta / deltaMs) * 1000;
                  const speedText = formatSpeed(instantSpeed);
                  setCurrentSpeed(speedText);
                  lastSampleTime = now;
                  lastSampleAckedBytes = uploadedBytes;
                }

                setTasks((prev) =>
                  prev.map((t, idx) =>
                    idx === i
                      ? {
                          ...t,
                          status: "uploading",
                          progress: percent,
                          uploadedBytes,
                        }
                      : t
                  )
                );

                await pumpPipeline();
              } else if (data.type === "complete") {
                if (watchdogTimer) clearTimeout(watchdogTimer);
                const totalElapsedMs = Math.max(Date.now() - uploadStartTime, 1000);
                const avgSpeedBytesPerSec = (file.size / totalElapsedMs) * 1000;
                const durationFormatted = formatDuration(totalElapsedMs);
                const speedFormatted = formatSpeed(avgSpeedBytesPerSec);

                setTasks((prev) =>
                  prev.map((t, idx) =>
                    idx === i
                      ? {
                          ...t,
                          status: "done",
                          progress: 100,
                          uploadedBytes: file.size,
                          durationFormatted,
                          speedFormatted,
                        }
                      : t
                  )
                );
                try { ws.close(); } catch {}
                settledResolve(data);
              } else if (data.type === "error") {
                if (watchdogTimer) clearTimeout(watchdogTimer);
                try { ws.close(); } catch {}
                settledReject(new Error(data.error || "Upload failed"));
              }
            } catch (parseErr) {
              console.error("[Upload WS Parse Error]:", parseErr);
            }
          };

          ws.onerror = () => {
            if (watchdogTimer) clearTimeout(watchdogTimer);
            settledReject(new Error("WebSocket upload connection failed"));
          };

          ws.onclose = (ev) => {
            if (watchdogTimer) clearTimeout(watchdogTimer);
            if (!ev.wasClean && ackedChunks < totalChunks) {
              settledReject(new Error(`WebSocket connection closed unexpectedly (Code: ${ev.code})`));
            }
          };
        });

        if (!completeData.success) {
          throw new Error(completeData.error || "Failed finalizing upload");
        }

        const mediaId = completeData.item?.id || completeData.mediaId;

        if (exif.latitude && exif.longitude && mediaId) {
          try {
            await fetch("/api/tags/media-location", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                media_item_id: mediaId,
                name: `GPS (${exif.latitude.toFixed(4)}, ${exif.longitude.toFixed(4)})`,
                latitude: exif.latitude,
                longitude: exif.longitude,
                place_type: "landmark",
                source: "exif",
              }),
            });
          } catch {}
        }

        setTasks((prev) =>
          prev.map((t, idx) =>
            idx === i
              ? {
                  ...t,
                  status: "done",
                  progress: 100,
                }
              : t
          )
        );
      } catch (err: any) {
        setTasks((prev) =>
          prev.map((t, idx) =>
            idx === i ? { ...t, status: "error", error: err.message || "Upload failed" } : t
          )
        );
      }
    }

    activeWsRef.current = null;
    setIsUploading(false);
    setCurrentSpeed(null);
    onUploadComplete();
  };

  const completedCount = tasks.filter((t) => t.status === "done").length;
  const totalCount = tasks.length;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-t-3xl sm:rounded-3xl w-full sm:max-w-md shadow-2xl flex flex-col animate-scaleIn overflow-hidden max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-[var(--border-color)] flex-shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-full bg-blue-500/10 text-blue-500 flex items-center justify-center flex-shrink-0">
              <Upload className="w-4 h-4" />
            </div>
            <div className="truncate">
              <h2 className="text-sm font-semibold text-[var(--text-primary)] truncate">
                Upload to {channelName}
              </h2>
            </div>
          </div>
          
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Live Upload Speed Badge beside X */}
            {isUploading && currentSpeed && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-blue-500/10 text-blue-500 border border-blue-500/20 animate-pulse">
                ⚡ {currentSpeed}
              </span>
            )}
            <button
              onClick={handleCloseOrCancel}
              className="p-1.5 rounded-full text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div className="p-4 overflow-y-auto flex flex-col gap-3">
          {tasks.length === 0 ? (
            /* Dropzone */
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                handleFilesSelected(e.dataTransfer.files);
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-8 flex flex-col items-center justify-center text-center cursor-pointer transition-all ${
                isDragging
                  ? "border-blue-500 bg-blue-500/10"
                  : "border-[var(--border-color)] hover:border-blue-500/60 bg-[var(--bg-secondary)] hover:bg-[var(--bg-hover)]"
              }`}
            >
              <div className="w-12 h-12 rounded-full bg-blue-500/10 text-blue-500 flex items-center justify-center mb-3">
                <Upload className="w-6 h-6 stroke-[1.75]" />
              </div>
              <p className="text-sm font-medium text-[var(--text-primary)]">
                Choose files or drag & drop
              </p>
              <p className="text-xs text-[var(--text-tertiary)] mt-1">
                Photos and videos up to 2 GB
              </p>
            </div>
          ) : (
            /* Compact File Items */
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-[var(--text-secondary)] px-1">
                <span>
                  {tasks.length} {tasks.length === 1 ? "file" : "files"}
                </span>
                {!isUploading && (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="text-blue-500 hover:underline flex items-center gap-1 font-medium"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add more</span>
                  </button>
                )}
              </div>

              {tasks.map((task) => {
                const isDone = task.status === "done";
                const isErr = task.status === "error";
                const isProcessing = task.status === "processing";
                const isUploadingState = task.status === "uploading";

                return (
                  <div
                    key={task.id}
                    className="flex items-center gap-3 p-2.5 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)]"
                  >
                    {/* Media Thumbnail */}
                    <div className="w-10 h-10 rounded-lg bg-[var(--bg-surface)] overflow-hidden flex-shrink-0 flex items-center justify-center border border-[var(--border-color)]">
                      {task.previewUrl ? (
                        <img
                          src={task.previewUrl}
                          alt="Preview"
                          className="w-full h-full object-cover"
                        />
                      ) : task.isVideo ? (
                        <Film className="w-5 h-5 text-blue-400" />
                      ) : (
                        <FileImage className="w-5 h-5 text-slate-400" />
                      )}
                    </div>

                    {/* File Info + Single Clean Progress */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-[var(--text-primary)] truncate">
                          {task.file.name}
                        </span>
                        <span className="text-[11px] font-medium text-[var(--text-tertiary)] flex-shrink-0">
                          {isDone ? (
                            <span className="text-emerald-500 font-semibold">
                              ✓ {task.durationFormatted ? `${task.durationFormatted}` : "Completed"} {task.speedFormatted ? `(${task.speedFormatted})` : ""}
                            </span>
                          ) : isUploadingState ? (
                            <span className="text-blue-500 font-medium">
                              <span className="font-semibold">{task.progress}%</span>
                              <span className="text-[var(--text-tertiary)] ml-1 font-normal">
                                ({formatFileSize(task.uploadedBytes || 0)} / {task.sizeFormatted})
                              </span>
                            </span>
                          ) : isProcessing ? (
                            <span className="text-amber-500">Preparing...</span>
                          ) : (
                            task.sizeFormatted
                          )}
                        </span>
                      </div>

                      {/* Progress Bar */}
                      <div className="mt-1.5 h-1.5 bg-[var(--border-color)] rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-200 ease-out ${
                            isDone
                              ? "bg-emerald-500"
                              : isErr
                              ? "bg-rose-500"
                              : "bg-blue-600"
                          }`}
                          style={{
                            width: isDone
                              ? "100%"
                              : isErr
                              ? "100%"
                              : `${task.progress}%`,
                          }}
                        />
                      </div>

                      {isErr && (
                        <p className="text-[10px] text-rose-500 mt-1 truncate">
                          {task.error || "Upload failed"}
                        </p>
                      )}
                    </div>

                    {/* Status Icons / Action */}
                    <div className="flex-shrink-0 flex items-center gap-1">
                      {isDone && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                      {isErr && <AlertCircle className="w-4 h-4 text-rose-500" />}
                      {isProcessing && <RefreshCw className="w-3.5 h-3.5 text-amber-500 animate-spin" />}
                      
                      {/* Allow removing pending, errored, or cancelling in-flight task */}
                      {!isDone && (
                        <button
                          onClick={() => handleRemoveTask(task.id)}
                          title={isUploadingState || isProcessing ? "Cancel this upload" : "Remove from queue"}
                          className="p-1 text-[var(--text-tertiary)] hover:text-rose-500 hover:bg-[var(--bg-hover)] rounded-full transition-colors"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,video/*"
          className="hidden"
          onChange={(e) => handleFilesSelected(e.target.files)}
        />

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-2.5 px-5 py-3.5 border-t border-[var(--border-color)] bg-[var(--bg-surface)] flex-shrink-0">
          <button
            onClick={handleCloseOrCancel}
            className="px-4 py-2 rounded-full text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
          >
            {completedCount === totalCount && totalCount > 0 ? "Done" : "Cancel"}
          </button>

          {tasks.length > 0 && completedCount < totalCount && (
            <button
              onClick={startUpload}
              disabled={isUploading}
              className="px-5 py-2 rounded-full bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md flex items-center gap-2 transition-all disabled:opacity-60"
            >
              {isUploading ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Uploading ({completedCount}/{totalCount})...</span>
                </>
              ) : (
                <>
                  <Upload className="w-3.5 h-3.5" />
                  <span>
                    Upload {tasks.length} {tasks.length === 1 ? "file" : "files"}
                  </span>
                </>
              )}
            </button>
          )}
        </div>

        {/* Confirmation Modal when canceling active upload */}
        {showCancelConfirm && (
          <div className="absolute inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-5 animate-fadeIn">
            <div className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-2xl p-5 max-w-xs w-full shadow-2xl text-center flex flex-col items-center">
              <div className="w-11 h-11 rounded-full bg-rose-500/10 text-rose-500 flex items-center justify-center mb-3">
                <AlertCircle className="w-6 h-6 stroke-[1.75]" />
              </div>
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                Cancel all uploads?
              </h3>
              <p className="text-xs text-[var(--text-secondary)] mt-1.5 leading-relaxed">
                Upload is currently in progress. Canceling will stop in-flight transfers and discard remaining queue items.
              </p>
              <div className="flex items-center gap-2.5 mt-5 w-full">
                <button
                  onClick={() => setShowCancelConfirm(false)}
                  className="flex-1 px-3 py-2 rounded-xl text-xs font-medium bg-[var(--bg-secondary)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] border border-[var(--border-color)] transition-colors"
                >
                  Continue Upload
                </button>
                <button
                  onClick={cancelAllUploads}
                  className="flex-1 px-3 py-2 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white shadow-md transition-colors"
                >
                  Yes, Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
