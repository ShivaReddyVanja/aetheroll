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
  Trash2,
  Cloud,
} from "lucide-react";
import { generateBlurHashAndThumbnail, generateVideoThumbnailAndMetadata } from "@/lib/blurhash";
import { extractExifMetadata } from "@/lib/exif";

/**
 * The Cloudflare Worker URL used for direct uploads.
 * Chunks go browser → worker directly, bypassing the Next.js dev proxy which
 * drops long-running connections with ECONNRESET on large binary bodies.
 */
const WORKER_URL = (
  process.env.NEXT_PUBLIC_REMOTE_API_URL ||
  "https://telegram-gallery.shivareddyvanja.workers.dev"
).replace(/\/$/, "");

/**
 * Read the session token for cross-origin upload headers.
 * The tg_session cookie is HttpOnly (not readable by JS), so at login we also
 * persist the token in localStorage under "tg_session_token".
 */
function getSessionToken(): string {
  if (typeof localStorage === "undefined") return "";
  return localStorage.getItem("tg_session_token") ?? "";
}

interface UploaderModalProps {
  channelId: string;
  channelName: string;
  onClose: () => void;
  onUploadComplete: () => void;
}

interface UploadTask {
  id: string;
  file: File;
  status: "pending" | "processing" | "uploading" | "cloud_saving" | "done" | "error";
  progress: number;
  step1Progress?: number;
  step2Progress?: number;
  step1Text?: string;
  step2Text?: string;
  error?: string;
  previewUrl?: string;
  isVideo: boolean;
  sizeFormatted: string;
  uploadedText?: string;
}

export function UploaderModal({
  channelId,
  channelName,
  onClose,
  onUploadComplete,
}: UploaderModalProps) {
  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleFilesSelected = (files: FileList | File[] | null) => {
    if (!files) return;
    const newTasks: UploadTask[] = Array.from(files).map((f) => ({
      id: crypto.randomUUID(),
      file: f,
      status: "pending",
      progress: 0,
      previewUrl: f.type.startsWith("image/") ? URL.createObjectURL(f) : undefined,
      isVideo: f.type.startsWith("video/"),
      sizeFormatted: formatFileSize(f.size),
    }));
    setTasks((prev) => [...prev, ...newTasks]);
  };

  const handleRemoveTask = (id: string) => {
    if (isUploading) return;
    setTasks((prev) => prev.filter((t) => t.id !== id));
  };

  const startUpload = async () => {
    if (tasks.length === 0 || isUploading) return;
    setIsUploading(true);

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      if (task.status === "done") continue;

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

        // 1. Client-Side Dimension & BlurHash / Thumbnail Generation
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

        // 2. Client-Side EXIF Metadata
        const exif = await extractExifMetadata(file);

        // 1MB binary WebSocket frames directly to Cloudflare Durable Object (which relays 512KB slices to MTProto)
        const CHUNK_SIZE = 1024 * 1024;
        const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
        const sessionToken = getSessionToken();

        setTasks((prev) =>
          prev.map((t, idx) =>
            idx === i
              ? {
                  ...t,
                  status: "uploading",
                  progress: 0,
                  step1Progress: 0,
                  step2Progress: 0,
                  step1Text: "Connecting stream...",
                  step2Text: "Waiting for stream...",
                  uploadedText: "Uploading...",
                }
              : t
          )
        );

        // Upload via persistent WebSocket pipeline directly to Cloudflare Durable Object
        const completeData = await new Promise<{ success: boolean; item?: any; mediaId?: string; error?: string }>((resolve, reject) => {
          const wsBaseUrl = WORKER_URL.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
          const ws = new WebSocket(`${wsBaseUrl}/api/media/upload/ws`);
          ws.binaryType = "arraybuffer";

          let nextChunkToSend = 0;
          let ackedChunks = 0;
          const PIPELINE_WINDOW = 2; // Up to 2 concurrent in-flight frames

          const sendChunk = async (chunkIndex: number) => {
            if (chunkIndex >= totalChunks) return;
            const startByte = chunkIndex * CHUNK_SIZE;
            const endByte = Math.min(startByte + CHUNK_SIZE, file.size);
            const sliceBlob = file.slice(startByte, endByte);
            const sliceBuffer = await sliceBlob.arrayBuffer();

            // Frame: [4-byte big-endian Int32 chunkIndex | chunk bytes]
            const frameBuffer = new Uint8Array(4 + sliceBuffer.byteLength);
            const view = new DataView(frameBuffer.buffer);
            view.setInt32(0, chunkIndex, false); // big-endian
            frameBuffer.set(new Uint8Array(sliceBuffer), 4);

            if (ws.readyState === WebSocket.OPEN) {
              ws.send(frameBuffer);
            }
          };

          const pumpPipeline = async () => {
            while (nextChunkToSend < totalChunks && (nextChunkToSend - ackedChunks) < PIPELINE_WINDOW) {
              const toSend = nextChunkToSend++;
              sendChunk(toSend);
            }
          };

          ws.onopen = () => {
            // Step 1: Send JSON init handshake
            ws.send(JSON.stringify({
              type: "init",
              token: sessionToken,
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
            try {
              const data = JSON.parse(event.data);
              if (data.type === "debug_log") {
                console.log(`%c[SERVER] %c${data.stage}`, "color: #ff007f; font-weight: bold", "color: #00e5ff; font-weight: 500;", data.detail || "");
              } else if (data.type === "init_ok") {
                nextChunkToSend = 0;
                ackedChunks = 0;
                await pumpPipeline();
              } else if (data.type === "chunk_ack") {
                ackedChunks++;
                const step1Percent = Math.min(Math.round((ackedChunks / totalChunks) * 100), 100);
                const loadedMb = (Math.min(ackedChunks * CHUNK_SIZE, file.size) / (1024 * 1024)).toFixed(1);
                const totalMb = (file.size / (1024 * 1024)).toFixed(1);
                const step1Text = step1Percent >= 100 ? `${totalMb} MB (100%)` : `${loadedMb} / ${totalMb} MB (${step1Percent}%)`;

                setTasks((prev) =>
                  prev.map((t, idx) =>
                    idx === i
                      ? {
                          ...t,
                          status: "uploading",
                          step1Progress: step1Percent,
                          step1Text,
                          uploadedText: step1Percent < 100 ? `Step 1: ${step1Percent}%` : `Step 2: ${t.step2Progress || 0}%`,
                        }
                      : t
                  )
                );

                await pumpPipeline();
              } else if (data.type === "telegram_progress") {
                const step2Percent = data.progressPercent || 0;
                const totalMb = (file.size / (1024 * 1024)).toFixed(1);
                const step2Text = step2Percent >= 100 ? `Saved (100%)` : `${step2Percent}% of ${totalMb} MB`;

                setTasks((prev) =>
                  prev.map((t, idx) =>
                    idx === i
                      ? {
                          ...t,
                          status: "uploading",
                          step2Progress: step2Percent,
                          step2Text,
                          uploadedText: (t.step1Progress || 0) < 100 ? `Step 1: ${t.step1Progress}%` : `Step 2: ${step2Percent}%`,
                        }
                      : t
                  )
                );
              } else if (data.type === "complete") {
                setTasks((prev) =>
                  prev.map((t, idx) =>
                    idx === i
                      ? {
                          ...t,
                          status: "done",
                          progress: 100,
                          step1Progress: 100,
                          step2Progress: 100,
                          step1Text: "Complete (100%)",
                          step2Text: "Complete (100%)",
                          uploadedText: "Uploaded to Telegram",
                        }
                      : t
                  )
                );
                try { ws.close(); } catch {}
                resolve(data);
              } else if (data.type === "error") {
                try { ws.close(); } catch {}
                reject(new Error(data.error || "Upload failed"));
              }
            } catch (parseErr) {
              console.error("[Upload WS Parse Error]:", parseErr);
            }
          };

          ws.onerror = () => {
            reject(new Error("WebSocket upload connection failed"));
          };

          ws.onclose = (ev) => {
            if (!ev.wasClean && ackedChunks < totalChunks) {
              reject(new Error(`WebSocket connection closed unexpectedly (Code: ${ev.code})`));
            }
          };
        });

        if (!completeData.success) {
          throw new Error(completeData.error || "Failed finalizing upload");
        }

        const mediaId = completeData.item?.id || completeData.mediaId;

        // Attach EXIF Location Tag if present
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
                  uploadedText: "Completed",
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

    setIsUploading(false);
    onUploadComplete();
  };

  const completedCount = tasks.filter((t) => t.status === "done").length;
  const totalCount = tasks.length;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-3xl max-w-xl w-full p-6 shadow-2xl flex flex-col max-h-[85vh] space-y-5 animate-scaleIn">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-color)] pb-3 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-500/10 text-blue-500 flex items-center justify-center">
              <Upload className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[var(--text-primary)]">
                Upload to {channelName}
              </h2>
              <p className="text-xs text-[var(--text-secondary)]">
                Files are stored directly in your Telegram vault with zero compression.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isUploading}
            className="p-1.5 rounded-full text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-30 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Dropzone Area */}
        {tasks.length === 0 ? (
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
            className={`border-2 border-dashed rounded-3xl p-10 flex flex-col items-center justify-center text-center cursor-pointer transition-all ${
              isDragging
                ? "border-blue-500 bg-blue-500/10 scale-[1.01]"
                : "border-[var(--border-color)] hover:border-blue-500/60 bg-[var(--bg-secondary)] hover:bg-[var(--bg-hover)]"
            }`}
          >
            <div className="w-14 h-14 rounded-full bg-blue-500/10 text-blue-500 flex items-center justify-center mb-3">
              <Upload className="w-7 h-7 stroke-[1.75]" />
            </div>
            <p className="text-sm font-medium text-[var(--text-primary)]">
              Drag and drop photos and videos here
            </p>
            <p className="text-xs text-[var(--text-tertiary)] mt-1">
              or click to browse from your device (JPEG, PNG, WebP, MP4, MOV)
            </p>
          </div>
        ) : (
          /* File Preview Grid & Progress List */
          <div className="flex-1 overflow-y-auto space-y-2 pr-1 max-h-[50vh]">
            <div className="flex items-center justify-between text-xs font-semibold text-[var(--text-secondary)] px-1 mb-1">
              <span>
                {tasks.length} {tasks.length === 1 ? "file" : "files"} selected
              </span>
              {!isUploading && (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="text-blue-500 hover:underline flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add more</span>
                </button>
              )}
            </div>

            {tasks.map((task) => (
              <div
                key={task.id}
                className="flex items-center justify-between p-3 rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-color)] gap-3"
              >
                {/* Thumbnail Preview */}
                <div className="w-12 h-12 rounded-xl bg-[var(--bg-surface)] overflow-hidden flex-shrink-0 flex items-center justify-center border border-[var(--border-color)] relative">
                  {task.previewUrl ? (
                    <img
                      src={task.previewUrl}
                      alt="Preview"
                      className="w-full h-full object-cover"
                    />
                  ) : task.isVideo ? (
                    <Film className="w-6 h-6 text-blue-400" />
                  ) : (
                    <FileImage className="w-6 h-6 text-slate-400" />
                  )}
                  {task.isVideo && (
                    <span className="absolute bottom-1 right-1 text-[9px] bg-black/70 text-white px-1 rounded font-bold">
                      MOV
                    </span>
                  )}
                </div>

                {/* File Info & Status */}
                <div className="flex-1 overflow-hidden">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-[var(--text-primary)] truncate max-w-[200px]">
                      {task.file.name}
                    </span>
                    <span className="text-[11px] text-[var(--text-tertiary)] flex-shrink-0 font-medium">
                      {task.uploadedText || task.sizeFormatted}
                    </span>
                  </div>

                  {/* Progress / Status Bar */}
                  <div className="mt-2 flex flex-col gap-1">
                    {task.status === "pending" && (
                      <span className="text-[11px] text-[var(--text-tertiary)]">Ready to upload</span>
                    )}

                    {task.status === "processing" && (
                      <span className="text-[11px] text-blue-500 flex items-center gap-1.5">
                        <RefreshCw className="w-3 h-3 animate-spin" />
                        Analyzing video & frame thumbnail...
                      </span>
                    )}

                    {task.status === "uploading" && (
                      <div className="w-full flex flex-col gap-2 mt-1.5">
                        {/* Step 1: Uploading to Edge */}
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="flex items-center gap-1.5 font-medium text-[var(--text-secondary)]">
                              <span
                                className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[8px] font-bold transition-colors ${
                                  (task.step1Progress ?? 0) >= 100
                                    ? "bg-emerald-500 text-white"
                                    : "bg-blue-600 text-white"
                                }`}
                              >
                                {(task.step1Progress ?? 0) >= 100 ? "✓" : "1"}
                              </span>
                              <span className="text-[var(--text-primary)] text-[11px] font-medium">Step 1: Upload to Edge</span>
                            </span>
                            <span className="text-[var(--text-tertiary)] font-mono text-[10px]">
                              {task.step1Text || `${task.step1Progress ?? 0}%`}
                            </span>
                          </div>
                          <div className="h-1.5 bg-[var(--border-color)] rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-300 ease-out ${
                                (task.step1Progress ?? 0) >= 100 ? "bg-emerald-500" : "bg-blue-600"
                              }`}
                              style={{ width: `${task.step1Progress ?? 0}%` }}
                            />
                          </div>
                        </div>

                        {/* Step 2: Vaulting to Telegram */}
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="flex items-center gap-1.5 font-medium text-[var(--text-secondary)]">
                              <span
                                className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[8px] font-bold transition-colors ${
                                  (task.step2Progress ?? 0) >= 100
                                    ? "bg-emerald-500 text-white"
                                    : (task.step2Progress ?? 0) > 0
                                    ? "bg-indigo-600 text-white"
                                    : "bg-[var(--border-color)] text-[var(--text-tertiary)]"
                                }`}
                              >
                                {(task.step2Progress ?? 0) >= 100 ? "✓" : "2"}
                              </span>
                              <span className="text-[var(--text-primary)] text-[11px] font-medium">Step 2: Vault to Telegram</span>
                            </span>
                            <span className="text-[var(--text-tertiary)] font-mono text-[10px]">
                              {task.step2Text || `${task.step2Progress ?? 0}%`}
                            </span>
                          </div>
                          <div className="h-1.5 bg-[var(--border-color)] rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-300 ease-out ${
                                (task.step2Progress ?? 0) >= 100 ? "bg-emerald-500" : "bg-indigo-600"
                              }`}
                              style={{ width: `${task.step2Progress ?? 0}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    {task.status === "cloud_saving" && (
                      <div className="flex items-center gap-1.5 text-[11px] text-blue-500 font-medium animate-pulse">
                        <Cloud className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                        <span>Saving to Telegram MTProto cloud vault...</span>
                      </div>
                    )}

                    {task.status === "done" && (
                      <span className="text-[11px] text-emerald-500 flex items-center gap-1 font-medium">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Uploaded to Telegram
                      </span>
                    )}

                    {task.status === "error" && (
                      <span className="text-[11px] text-rose-500 flex items-center gap-1 truncate">
                        <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                        {task.error || "Upload failed"}
                      </span>
                    )}
                  </div>
                </div>

                {/* Remove Button */}
                {!isUploading && task.status !== "done" && (
                  <button
                    onClick={() => handleRemoveTask(task.id)}
                    className="p-1.5 text-[var(--text-tertiary)] hover:text-rose-500 hover:bg-[var(--bg-hover)] rounded-full transition-colors flex-shrink-0"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,video/*"
          className="hidden"
          onChange={(e) => handleFilesSelected(e.target.files)}
        />

        {/* Footer Actions */}
        <div className="flex items-center justify-between pt-3 border-t border-[var(--border-color)] flex-shrink-0">
          <div className="text-xs text-[var(--text-tertiary)] flex items-center gap-1.5">
            <Cloud className="w-4 h-4 text-blue-500" />
            <span>Vault: {channelName}</span>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={onClose}
              disabled={isUploading}
              className="px-4 py-2 rounded-full text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors disabled:opacity-40"
            >
              {completedCount === totalCount && totalCount > 0 ? "Done" : "Cancel"}
            </button>

            {tasks.length > 0 && completedCount < totalCount && (
              <button
                onClick={startUpload}
                disabled={isUploading}
                className="px-6 py-2 rounded-full bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md shadow-blue-500/20 flex items-center gap-2 transition-all disabled:opacity-60"
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
                      Upload {tasks.length} {tasks.length === 1 ? "Item" : "Items"}
                    </span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
