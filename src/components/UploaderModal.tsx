"use client";

import React, { useState, useRef, useEffect } from "react";
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
  MapPin,
  Calendar,
  Cloud,
} from "lucide-react";
import { generateBlurHashAndThumbnail } from "@/lib/blurhash";
import { extractExifMetadata } from "@/lib/exif";

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
  error?: string;
  previewUrl?: string;
  isVideo: boolean;
  sizeFormatted: string;
  exifDate?: string;
  hasGps?: boolean;
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
        prev.map((t, idx) => (idx === i ? { ...t, status: "processing", progress: 15 } : t))
      );

      try {
        const file = task.file;
        const isVideo = file.type.startsWith("video/");
        let width = 1920;
        let height = 1080;
        let blurHash = "LEHV6nWB2yk8pyo0adR*.7kCMdnj";
        let thumbnailBase64 = "";

        // 1. Client-Side BlurHash & Thumbnail Generation
        if (!isVideo) {
          try {
            const bhResult = await generateBlurHashAndThumbnail(file);
            width = bhResult.width;
            height = bhResult.height;
            blurHash = bhResult.blurHash;
            thumbnailBase64 = bhResult.thumbnailBase64;
          } catch (e) {
            console.warn("BlurHash skipped for", file.name, e);
          }
        }

        // 2. Client-Side EXIF Metadata
        const exif = await extractExifMetadata(file);

        setTasks((prev) =>
          prev.map((t, idx) => (idx === i ? { ...t, status: "uploading", progress: 50 } : t))
        );

        // 3. Upload binary file directly to Telegram Channel via MTProto
        const formData = new FormData();
        formData.append("file", file);
        formData.append("channel_id", channelId);
        formData.append("blur_hash", blurHash);
        formData.append("captured_at", exif.capturedAt || new Date().toISOString());
        if (thumbnailBase64) {
          formData.append("thumbnail_base64", thumbnailBase64);
        }

        const res = await fetch("/api/media/upload", {
          method: "POST",
          body: formData,
        });

        const data = await res.json();
        if (data.error) throw new Error(data.error);

        // Attach EXIF Location Tag if present
        if (exif.latitude && exif.longitude && data.mediaId) {
          try {
            await fetch("/api/tags/media-location", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                media_item_id: data.mediaId,
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
          prev.map((t, idx) => (idx === i ? { ...t, status: "done", progress: 100 } : t))
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
  const hasErrors = tasks.some((t) => t.status === "error");

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
              <span>{tasks.length} {tasks.length === 1 ? "file" : "files"} selected</span>
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
                className="flex items-center justify-between p-2.5 rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-color)] gap-3"
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
                    <span className="text-xs font-medium text-[var(--text-primary)] truncate max-w-[220px]">
                      {task.file.name}
                    </span>
                    <span className="text-[11px] text-[var(--text-tertiary)] flex-shrink-0">
                      {task.sizeFormatted}
                    </span>
                  </div>

                  {/* Progress / Status Bar */}
                  <div className="mt-1.5 flex items-center gap-2">
                    {task.status === "pending" && (
                      <span className="text-[11px] text-[var(--text-tertiary)]">Ready to upload</span>
                    )}
                    {task.status === "processing" && (
                      <span className="text-[11px] text-blue-500 flex items-center gap-1">
                        <RefreshCw className="w-3 h-3 animate-spin" />
                        Generating BlurHash & EXIF...
                      </span>
                    )}
                    {task.status === "uploading" && (
                      <div className="w-full flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-[var(--border-color)] rounded-full overflow-hidden">
                          <div className="w-2/3 h-full bg-blue-500 rounded-full animate-pulse" />
                        </div>
                        <span className="text-[10px] text-blue-500 font-semibold">MTProto...</span>
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
                    <span>Upload {tasks.length} {tasks.length === 1 ? "Item" : "Items"}</span>
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
