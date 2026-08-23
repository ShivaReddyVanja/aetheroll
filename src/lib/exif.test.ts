import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decode } from "blurhash";
import { extractExifMetadata } from "./exif.ts";

describe("🖼️ Metadata, EXIF & Aspect Ratio Module", () => {
  it("should handle video files gracefully in extractExifMetadata without throwing invalid format error", async () => {
    const dummyVideoFile = new File([Buffer.from("dummy video")], "video.mp4", {
      type: "video/mp4",
      lastModified: 1700000000000,
    });
    const result = await extractExifMetadata(dummyVideoFile);
    assert.equal(result.capturedAt, new Date(1700000000000).toISOString());
    assert.equal(result.latitude, undefined);
    assert.equal(result.longitude, undefined);
  });

  it("should decode BlurHash strings into valid pixel arrays", () => {
    const blurHash = "LEHV6nWB2yk8pyo0adR*.7kCMdnj";
    const width = 32;
    const height = 32;
    const pixels = decode(blurHash, width, height);

    assert.ok(pixels instanceof Uint8ClampedArray);
    assert.equal(pixels.length, width * height * 4);
  });

  it("should calculate correct proportional widths for Google Photos row layout", () => {
    const targetHeight = 240;
    const item = { width: 1920, height: 1080 };
    const computedWidth = Math.round((item.width / item.height) * targetHeight);
    assert.equal(computedWidth, 427);
  });
});
