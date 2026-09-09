export interface FaqItem {
  question: string;
  answer: string;
}

export const FAQ_ITEMS: FaqItem[] = [
  {
    question: "Is photo and video storage on Telegram truly unlimited?",
    answer:
      "Yes. Telegram permits users to upload individual files up to 2 GB each (4 GB with Telegram Premium) with no overall account storage quota in Saved Messages, private channels, or private groups. Aetheroll leverages these private channels as unmetered, high-speed storage backends.",
  },
  {
    question: "How does Aetheroll protect my privacy and Telegram credentials?",
    answer:
      "Aetheroll utilizes Dual-Key HKDF-SHA256 Envelope Encryption. Your MTProto session string is encrypted with a master key derived from a client secret cookie and a server master key. The server database stores only AES-256-GCM ciphertext. An attacker with full database access cannot decrypt your Telegram session without your client cookie.",
  },
  {
    question: "Does Aetheroll compress my photos or re-encode my videos?",
    answer:
      "No. All media is stored in its 100% original binary format. Aetheroll extracts EXIF camera metadata, lens focal lengths, ISO settings, and GPS coordinates during indexing without altering the original files.",
  },
  {
    question: "How does the 10-worker 4K video streaming engine work?",
    answer:
      "Aetheroll employs a 10-worker MTProto parallel segment fetcher inside Cloudflare Durable Objects. It splits video streams into 16 MB pre-buffered slices using HTTP Range requests, enabling instant scrubbing across multi-gigabyte 4K HDR videos with sub-5ms seek latency.",
  },
  {
    question: "What is the Append-Only WAL disaster recovery system?",
    answer:
      "All user interactions—including tags, trip groupings, and favorites—are recorded as encrypted event messages inside your Telegram message threads. If your Cloudflare D1 database is wiped, clicking 'Sync Channel' replays the event ledger directly from Telegram to restore 100% of your metadata.",
  },
  {
    question: "How much does it cost to self-host Aetheroll?",
    answer:
      "Zero dollars. Aetheroll is optimized for Cloudflare's generous free tier (Cloudflare Workers, Durable Objects, D1 SQLite, and R2). You can host your personal, unlimited photo vault for $0.00/month indefinitely.",
  },
];
