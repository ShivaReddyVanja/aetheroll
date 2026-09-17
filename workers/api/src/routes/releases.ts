import { Hono } from "hono";

const ANDROID_LATEST_MANIFEST_KEY = "android/latest.json";

interface AndroidReleaseManifest {
  version: string;
  versionCode: number;
  publishedAt: string;
  sha256: string;
  sizeBytes: number;
  releaseNotes: string[];
  minSupportedVersionCode?: number;
  apkKey: string;
}

export const releasesRouter = new Hono();

function releasesBucket(c: any): any | null {
  return c.env?.RELEASES_BUCKET && typeof c.env.RELEASES_BUCKET.get === "function"
    ? c.env.RELEASES_BUCKET
    : null;
}

async function getLatestManifest(c: any): Promise<{ manifest: AndroidReleaseManifest; object: any } | null> {
  const bucket = releasesBucket(c);
  if (!bucket) return null;

  const object = await bucket.get(ANDROID_LATEST_MANIFEST_KEY);
  if (!object?.body) return null;

  const manifest = await new Response(object.body).json() as AndroidReleaseManifest;
  if (!manifest.version || !Number.isInteger(manifest.versionCode) || !manifest.apkKey || !manifest.sha256) {
    throw new Error("Invalid Android release manifest");
  }
  return { manifest, object };
}

releasesRouter.get("/android/latest", async (c) => {
  try {
    if (!releasesBucket(c)) return c.json({ error: "Release storage is not configured" }, 503);
    const result = await getLatestManifest(c);
    if (!result) return c.json({ error: "No Android release is published" }, 404);

    return c.json(result.manifest, 200, {
      "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
    });
  } catch (error: any) {
    console.error("Failed to read Android release manifest", error);
    return c.json({ error: "Release metadata is unavailable" }, 500);
  }
});

releasesRouter.get("/android/latest/download", async (c) => {
  try {
    const bucket = releasesBucket(c);
    if (!bucket) return c.json({ error: "Release storage is not configured" }, 503);
    const result = await getLatestManifest(c);
    if (!result) return c.json({ error: "No Android release is published" }, 404);

    const apk = await bucket.get(result.manifest.apkKey);
    if (!apk?.body) return c.json({ error: "Release APK is unavailable" }, 404);

    const headers = new Headers({
      "Content-Type": "application/vnd.android.package-archive",
      "Content-Disposition": `attachment; filename=\"aetheroll-${result.manifest.version}.apk\"`,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    });
    apk.writeHttpMetadata?.(headers);
    headers.set("Content-Type", "application/vnd.android.package-archive");

    return new Response(apk.body, { headers });
  } catch (error: any) {
    console.error("Failed to serve Android release APK", error);
    return c.json({ error: "Release APK is unavailable" }, 500);
  }
});
