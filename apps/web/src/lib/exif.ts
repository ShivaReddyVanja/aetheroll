import ExifReader from "exifreader";

export interface ExtractedMetadata {
  capturedAt?: string;
  latitude?: number;
  longitude?: number;
  cameraModel?: string;
}

/**
 * Extracts EXIF date, GPS, and camera metadata from an image/video File
 */
export async function extractExifMetadata(file: File): Promise<ExtractedMetadata> {
  const result: ExtractedMetadata = {};

  // For video files, default to file's last modified timestamp
  if (file.type.startsWith("video/")) {
    if (file.lastModified) {
      result.capturedAt = new Date(file.lastModified).toISOString();
    }
    return result;
  }

  try {
    const tags = await ExifReader.load(file, { expanded: true });

    // 1. Captured Date
    const dateTag = tags.exif?.DateTimeOriginal?.description || tags.exif?.DateTimeDigitized?.description;
    if (dateTag) {
      // EXIF format: "YYYY:MM:DD HH:MM:SS"
      const parts = dateTag.split(/[: ]/);
      if (parts.length >= 6) {
        const iso = `${parts[0]}-${parts[1]}-${parts[2]}T${parts[3]}:${parts[4]}:${parts[5]}Z`;
        const d = new Date(iso);
        if (!isNaN(d.getTime())) {
          result.capturedAt = d.toISOString();
        }
      }
    }

    if (!result.capturedAt && file.lastModified) {
      result.capturedAt = new Date(file.lastModified).toISOString();
    }

    // 2. GPS Coordinates
    if (tags.gps?.Latitude && tags.gps?.Longitude) {
      result.latitude = tags.gps.Latitude;
      result.longitude = tags.gps.Longitude;
    }

    // 3. Camera
    if (tags.exif?.Model?.description) {
      result.cameraModel = tags.exif.Model.description;
    }

    return result;
  } catch (error) {
    // Fallback gracefully without console error
    if (file.lastModified) {
      result.capturedAt = new Date(file.lastModified).toISOString();
    }
    return result;
  }
}
