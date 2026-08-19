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

      // 2. Create a 320px compressed thumbnail
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
