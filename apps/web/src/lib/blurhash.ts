import { encode, decode } from "blurhash";

/**
 * Encodes an image File/Blob into a BlurHash string and a base64 thumbnail
 */
export async function generateBlurHashAndThumbnail(file: File): Promise<{
  blurHash: string;
  width: number;
  height: number;
  thumbnailBase64: string;
}> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      const width = img.naturalWidth || img.width;
      const height = img.naturalHeight || img.height;

      // 1. Create a 32x32 downscaled canvas for BlurHash calculation
      const bhCanvas = document.createElement("canvas");
      bhCanvas.width = 32;
      bhCanvas.height = 32;
      const bhCtx = bhCanvas.getContext("2d");

      if (!bhCtx) {
        return resolve({
          blurHash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
          width,
          height,
          thumbnailBase64: "",
        });
      }

      bhCtx.drawImage(img, 0, 0, 32, 32);
      const imageData = bhCtx.getImageData(0, 0, 32, 32);
      const blurHash = encode(imageData.data, 32, 32, 4, 4);

      // 2. Create a 360px compressed thumbnail (JPEG format for universal mobile compatibility)
      const maxThumb = 360;
      const scale = Math.min(maxThumb / width, maxThumb / height, 1);
      const thumbW = Math.round(width * scale);
      const thumbH = Math.round(height * scale);

      const thumbCanvas = document.createElement("canvas");
      thumbCanvas.width = thumbW;
      thumbCanvas.height = thumbH;
      const thumbCtx = thumbCanvas.getContext("2d");

      let thumbnailBase64 = "";
      if (thumbCtx) {
        thumbCtx.drawImage(img, 0, 0, thumbW, thumbH);
        thumbnailBase64 = thumbCanvas.toDataURL("image/jpeg", 0.8);
      }

      resolve({
        blurHash,
        width,
        height,
        thumbnailBase64,
      });
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image for BlurHash"));
    };

    img.src = url;
  });
}

// Global sequential queue for video decoders to prevent exceeding Android MediaCodec hardware limits
let videoQueue: Promise<void> = Promise.resolve();

/**
 * Captures the first frame of a video File and generates BlurHash + JPEG thumbnail + dimensions
 * Sequentially queued to prevent overloading mobile hardware decoders.
 */
export async function generateVideoThumbnailAndMetadata(file: File): Promise<{
  blurHash: string;
  width: number;
  height: number;
  duration: number;
  thumbnailBase64: string;
}> {
  return new Promise((resolve) => {
    videoQueue = videoQueue
      .then(async () => {
        const res = await processSingleVideoThumbnail(file);
        resolve(res);
      })
      .catch(() => {
        resolve({
          blurHash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
          width: 1920,
          height: 1080,
          duration: 0,
          thumbnailBase64: "",
        });
      });
  });
}

async function processSingleVideoThumbnail(file: File): Promise<{
  blurHash: string;
  width: number;
  height: number;
  duration: number;
  thumbnailBase64: string;
}> {
  return new Promise((resolve) => {
    let resolved = false;

    // Adaptive timeout based on video size (8s min to 25s max for heavy files on mobile)
    const timeoutMs = Math.max(8000, Math.min(25000, Math.ceil(file.size / (10 * 1024 * 1024)) * 3000));

    const finish = (res: { blurHash: string; width: number; height: number; duration: number; thumbnailBase64: string }) => {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve(res);
      }
    };

    const timer = setTimeout(() => {
      finish({
        blurHash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
        width: 1920,
        height: 1080,
        duration: 0,
        thumbnailBase64: "",
      });
    }, timeoutMs);

    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "true");
    video.setAttribute("webkit-playsinline", "true");
    video.setAttribute("muted", "true");

    const url = URL.createObjectURL(file);

    const cleanup = () => {
      clearTimeout(timer);
      try {
        video.pause();
        video.onloadeddata = null;
        video.onloadedmetadata = null;
        video.onseeked = null;
        video.onerror = null;
        video.removeAttribute("src");
        video.load(); // Release Android MediaCodec hardware decoder slot
      } catch {}
      try {
        URL.revokeObjectURL(url);
      } catch {}
    };

    video.onloadedmetadata = () => {
      try {
        const targetTime = Math.min(0.3, (video.duration || 1) / 2);
        if (video.readyState >= 2) {
          video.currentTime = targetTime;
        } else {
          // Retry on seeked/loadeddata if readyState is loading
          video.currentTime = targetTime;
        }
      } catch {
        finish({
          blurHash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
          width: 1920,
          height: 1080,
          duration: 0,
          thumbnailBase64: "",
        });
      }
    };

    video.onseeked = () => {
      const width = video.videoWidth || 1920;
      const height = video.videoHeight || 1080;
      const duration = Math.round(video.duration) || 0;

      // 1. 32x32 Canvas for BlurHash
      const bhCanvas = document.createElement("canvas");
      bhCanvas.width = 32;
      bhCanvas.height = 32;
      const bhCtx = bhCanvas.getContext("2d");

      let blurHash = "LEHV6nWB2yk8pyo0adR*.7kCMdnj";
      if (bhCtx) {
        try {
          bhCtx.drawImage(video, 0, 0, 32, 32);
          const imageData = bhCtx.getImageData(0, 0, 32, 32);
          blurHash = encode(imageData.data, 32, 32, 4, 4);
        } catch {}
      }

      // 2. 360px JPEG Thumbnail
      const maxThumb = 360;
      const scale = Math.min(maxThumb / width, maxThumb / height, 1);
      const thumbW = Math.round(width * scale);
      const thumbH = Math.round(height * scale);

      const thumbCanvas = document.createElement("canvas");
      thumbCanvas.width = thumbW;
      thumbCanvas.height = thumbH;
      const thumbCtx = thumbCanvas.getContext("2d");

      let thumbnailBase64 = "";
      if (thumbCtx) {
        try {
          thumbCtx.drawImage(video, 0, 0, thumbW, thumbH);
          thumbnailBase64 = thumbCanvas.toDataURL("image/jpeg", 0.8);
        } catch {}
      }

      finish({
        blurHash,
        width,
        height,
        duration,
        thumbnailBase64,
      });
    };

    video.onerror = () => {
      finish({
        blurHash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
        width: 1920,
        height: 1080,
        duration: 0,
        thumbnailBase64: "",
      });
    };

    video.src = url;
    video.load(); // Explicitly trigger load for mobile WebKit engines
  });
}

/**
 * Decodes a BlurHash string onto an HTML canvas
 */
export function drawBlurHashToCanvas(
  canvas: HTMLCanvasElement,
  blurHash: string,
  width: number = 32,
  height: number = 32
) {
  try {
    const pixels = decode(blurHash, width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const imageData = ctx.createImageData(width, height);
    imageData.data.set(pixels);
    ctx.putImageData(imageData, 0, 0);
  } catch (e) {
    console.warn("Error drawing BlurHash:", e);
  }
}

