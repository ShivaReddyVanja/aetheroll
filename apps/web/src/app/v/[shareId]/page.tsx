import type { Metadata } from "next";
import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { getApiBaseUrl, getPublicStreamUrl } from "@/lib/config";
import { BRAND_NAME } from "@/lib/brand";
import type { PublicShareInfo } from "@aetheroll/types";
import { SharePlayer } from "./SharePlayer";

interface PageProps {
  params: Promise<{ shareId: string }>;
}

async function getShareInfo(shareId: string): Promise<PublicShareInfo | null> {
  try {
    const baseUrl = getApiBaseUrl(true) || "https://aetheroll-api.builtbyshiva.com";
    const res = await fetch(`${baseUrl}/api/shares/info/${encodeURIComponent(shareId)}`, {
      cache: "no-store",
    });

    if (!res.ok) return null;
    const data = await res.json();
    return data.success ? data.info : null;
  } catch (err) {
    console.error("[SharePage] Fetch info error:", err);
    return null;
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { shareId } = await params;
  const info = await getShareInfo(shareId);

  if (!info) {
    return {
      title: `Shared Media — ${BRAND_NAME}`,
      description: "Private shared media link",
    };
  }

  const isVideo = info.file_type === "video";
  const title = info.title || (isVideo ? "Shared Video" : "Shared Photo");
  const description = `Watch "${title}" in full original quality on ${BRAND_NAME}.`;

  const pageUrl = `https://aetheroll.builtbyshiva.com/v/${encodeURIComponent(shareId)}`;
  const width = info.width || 1280;
  const height = info.height || 720;
  const mimeType = info.mime_type || "video/mp4";

  return {
    title: `${title} | ${BRAND_NAME}`,
    description,
    openGraph: {
      title,
      description,
      url: pageUrl,
      type: isVideo ? "video.other" : "article",
      videos: isVideo
        ? [
            {
              url: info.stream_url,
              secureUrl: info.stream_url,
              type: mimeType,
              width,
              height,
            },
          ]
        : undefined,
      images: info.thumbnail_url
        ? [
            {
              url: info.thumbnail_url,
              secureUrl: info.thumbnail_url,
              width,
              height,
              type: "image/jpeg",
            },
          ]
        : undefined,
    },
    twitter: isVideo
      ? {
          card: "player",
          title,
          description,
          images: info.thumbnail_url ? [info.thumbnail_url] : undefined,
          players: [
            {
              playerUrl: pageUrl,
              streamUrl: info.stream_url,
              width,
              height,
            },
          ],
        }
      : {
          card: "summary_large_image",
          title,
          description,
          images: info.thumbnail_url ? [info.thumbnail_url] : undefined,
        },
  };
}

export default async function PublicSharePage({ params }: PageProps) {
  const { shareId } = await params;
  const info = await getShareInfo(shareId);

  if (!info) {
    return (
      <main className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center p-6 selection:bg-indigo-500 selection:text-white">
        <div className="max-w-md w-full text-center space-y-6 bg-zinc-900/60 p-8 rounded-2xl border border-zinc-800/80 backdrop-blur-xl shadow-2xl">
          <div className="w-16 h-16 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-400 mx-auto flex items-center justify-center">
            <AlertCircle className="w-8 h-8" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-bold tracking-tight text-white">Link Expired or Revoked</h1>
            <p className="text-sm text-zinc-400 leading-relaxed">
              This shared link is no longer available. The owner may have revoked access or the link reached its expiration limit.
            </p>
          </div>
          <Link
            href="/"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-sm font-medium text-white transition-colors"
          >
            Go to Aetheroll Home
          </Link>
        </div>
      </main>
    );
  }

  const isVideo = info.file_type === "video";
  const streamUrl = getPublicStreamUrl(shareId);

  return (
    <SharePlayer
      shareId={shareId}
      streamUrl={streamUrl}
      isVideo={isVideo}
      info={info}
    />
  );
}



