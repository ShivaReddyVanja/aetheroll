import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decode } from "blurhash";
import { extractExifMetadata } from "../src/lib/exif.ts";

describe("🖼️ Metadata, EXIF & Aspect Ratio Module", () => {
  it("should handle video files gracefully in extractExifMetadata without throwing invalid format error", async () => {
    const mockVideoFile = new File([new ArrayBuffer(1024)], "cat_video.mp4", {
      type: "video/mp4",
      lastModified: 1723996487304, // Aug 18, 2024
    });

    const result = await extractExifMetadata(mockVideoFile);
    assert.ok(result.capturedAt, "Captured date should fallback to lastModified");
    assert.equal(new Date(result.capturedAt!).getTime(), 1723996487304);
  });

  it("should decode BlurHash strings into valid pixel arrays", () => {
    const validBlurHash = "LEHV6nWB2yk8pyo0adR*.7kCMdnj";
    const width = 32;
    const height = 32;

    const pixels = decode(validBlurHash, width, height);
    assert.ok(pixels instanceof Uint8ClampedArray, "Decoded pixels must be a Uint8ClampedArray");
    assert.equal(pixels.length, width * height * 4, "Pixel length must equal width * height * 4 (RGBA)");
  });

  it("should calculate correct proportional widths for Google Photos row layout", () => {
    const rowHeight = 208; // px

    // 9:16 Portrait Video (1080 x 1920)
    const portraitW = Math.round(rowHeight * (1080 / 1920));
    assert.equal(portraitW, 117);

    // 16:9 Landscape Video (1920 x 1080)
    const landscapeW = Math.round(rowHeight * (1920 / 1080));
    assert.equal(landscapeW, 370);

    // 4:3 Standard Photo (4032 x 3024)
    const photo43W = Math.round(rowHeight * (4032 / 3024));
    assert.equal(photo43W, 277);

    // 1:1 Square Photo (1080 x 1080)
    const squareW = Math.round(rowHeight * (1080 / 1080));
    assert.equal(squareW, 208);
  });
});
