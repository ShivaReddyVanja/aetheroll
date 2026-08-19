import ExifReader from "exifreader";

export interface ExtractedMetadata {
  capturedAt?: string;
  latitude?: number;
  longitude?: number;
  cameraModel?: string;
}

/**
 * Extracts EXIF date, GPS, and camera metadata from an image File
 */
export async function extractExifMetadata(file: File): Promise<ExtractedMetadata> {
  try {
    const tags = await ExifReader.load(file, { expanded: true });
    const result: ExtractedMetadata = {};

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
    console.warn("Could not read EXIF data:", error);
    return {};
  }
}
