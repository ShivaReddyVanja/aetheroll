import { SITE_URL, GITHUB_REPO_URL } from "@/lib/brand";

export async function GET() {
  const baseUrl = SITE_URL;

  const content = `# Aetheroll: Zero-Knowledge Infinite Media Gallery on Telegram

> Aetheroll is an open-source, zero-knowledge, unlimited photo and 4K video cloud gallery powered by private Telegram channels and Cloudflare serverless edge infrastructure. It functions as a free, unmetered, privacy-first alternative to Google Photos and Apple iCloud.

## Core Capabilities
- **Infinite Uncompressed Storage**: Leverages Telegram's unlimited file backend (up to 2 GB per file, or 4 GB with Telegram Premium) with $0/month cloud storage bills.
- **10-Worker MTProto 4K Range Streaming**: Splits multi-gigabyte 4K HDR videos into 16 MB pre-buffered slices via Cloudflare Durable Objects, providing sub-5ms seek times without full file downloads.
- **Dual-Key HKDF-SHA256 Envelope Encryption**: MTProto session strings are encrypted using keys derived from a client-side secret cookie and a server master key. The server database (Cloudflare D1) contains only AES-256-GCM ciphertext, preventing unauthorized decryption even during full database exposure.
- **100% Original Quality & EXIF Telemetry**: Preserves raw camera sensor data, lens apertures, focal lengths, ISO settings, timestamps, and GPS coordinates without lossy recompression.
- **Append-Only Write-Ahead Log (WAL)**: User metadata (tags, favorites, trip groupings) is written as structured replies (\`[GP_EVENT:v1]\`) directly in Telegram message threads, enabling complete disaster recovery replay if the local database is wiped.
- **Global Token-Bucket Rate Pacer**: Restricts Telegram API calls to <= 25 req/s to prevent FLOOD_WAIT account penalties during bulk uploads and background syncing.

## Web Application Routes
- Main Landing: ${baseUrl}/
- Web Gallery App: ${baseUrl}/app
- Google Photos Comparison: ${baseUrl}/compare/google-photos
- TeleDrive Comparison: ${baseUrl}/compare/teledrive
- Apple iCloud Comparison: ${baseUrl}/compare/icloud
- Privacy Policy: ${baseUrl}/privacy

## Technology Stack
- **Frontend**: Next.js 15, React 19, Tailwind CSS, Lucide Icons, BlurHash
- **Backend Edge**: Cloudflare Workers, Cloudflare Durable Objects, Cloudflare D1 (SQLite), Cloudflare R2
- **Protocol**: GramJS (MTProto 2.0 implementation), WebSockets, WebCrypto (AES-256-GCM, HKDF-SHA256)
- **License**: GNU AGPL-3.0 Open Source

## Developer & Repository Information
- Repository: ${GITHUB_REPO_URL}
`;

  return new Response(content, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=86400, s-maxage=86400",
    },
  });
}
