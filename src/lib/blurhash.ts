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

      // 2. Create a 360px compressed thumbnail
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
        thumbnailBase64 = thumbCanvas.toDataURL("image/webp", 0.75);
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

/**
 * Captures the first frame of a video File and generates BlurHash + WebP thumbnail + dimensions
 */
export async function generateVideoThumbnailAndMetadata(file: File): Promise<{
  blurHash: string;
  width: number;
  height: number;
  duration: number;
  thumbnailBase64: string;
}> {
  return new Promise((resolve) => {
    let resolved = false;
    const finish = (res: { blurHash: string; width: number; height: number; duration: number; thumbnailBase64: string }) => {
      if (!resolved) {
        resolved = true;
        try {
          URL.revokeObjectURL(url);
        } catch {}
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
    }, 2500);

    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    const url = URL.createObjectURL(file);

    video.onloadeddata = () => {
      try {
        video.currentTime = Math.min(0.3, (video.duration || 1) / 2);
      } catch {
        clearTimeout(timer);
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
      clearTimeout(timer);
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

      // 2. 360px WebP Thumbnail
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
          thumbnailBase64 = thumbCanvas.toDataURL("image/webp", 0.75);
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
      clearTimeout(timer);
      finish({
        blurHash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
        width: 1920,
        height: 1080,
        duration: 0,
        thumbnailBase64: "",
      });
    };

    video.src = url;
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
