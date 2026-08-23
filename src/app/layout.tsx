import type { Metadata, Viewport } from "next";
import { BRAND_NAME, BRAND_TAGLINE, BRAND_DESCRIPTION } from "@/lib/brand";
import { FAQ_ITEMS } from "@/lib/faq";
import "./globals.css";

const SITE_URL = "https://aetheroll.builtbyshiva.com";

export const viewport: Viewport = {
  themeColor: "#09090b",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${BRAND_NAME} — Infinite Cloud Photo & Video Gallery on Telegram`,
    template: `%s | ${BRAND_NAME}`,
  },
  description:
    "A zero-knowledge, unlimited photo and 4K video cloud gallery powered by Telegram. 100% original EXIF preservation, sub-5ms edge streaming, and zero cloud bills.",
  keywords: [
    "telegram cloud storage",
    "google photos alternative",
    "google photos storage full alternative",
    "free unlimited photo storage",
    "telegram photo gallery",
    "teledrive alternative",
    "teldrive alternative",
    "icloud photos alternative free",
    "backup iphone photos to telegram",
    "zero knowledge photo vault",
    "self hosted cloud gallery",
    "telegram 4k video streaming",
    "raw exif photo viewer",
    "telegram media vault",
    "open source google photos alternative",
    "telegram drive for photos",
  ],
  authors: [{ name: "Shiva Reddy", url: "https://github.com/ShivaReddyVanja" }],
  creator: "Shiva Reddy",
  publisher: BRAND_NAME,
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  openGraph: {
    title: `${BRAND_NAME} — Infinite Cloud Photo & Video Gallery on Telegram`,
    description:
      "Turn your Telegram channels into a private, unlimited Google Photos vault with 100% original quality EXIF and sub-5ms 4K video streaming.",
    url: SITE_URL,
    siteName: BRAND_NAME,
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: `${BRAND_NAME} — Infinite Cloud Photo & Video Gallery`,
    description:
      "Turn your Telegram channels into a zero-cost, private Google Photos vault with sub-5ms 4K video streaming.",
    creator: "@ShivaReddy",
  },
  alternates: {
    canonical: SITE_URL,
  },
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
    shortcut: "/favicon.svg",
    apple: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "SoftwareApplication",
        "@id": `${SITE_URL}/#software`,
        "name": BRAND_NAME,
        "headline": BRAND_TAGLINE,
        "description": BRAND_DESCRIPTION,
        "applicationCategory": "MultimediaApplication",
        "operatingSystem": "Web, Cloudflare Edge",
        "offers": {
          "@type": "Offer",
          "price": "0",
          "priceCurrency": "USD",
        },
        "featureList": [
          "Unlimited free cloud storage via Telegram",
          "10-worker MTProto parallel 4K video streaming",
          "Dual-Key HKDF-SHA256 zero-knowledge encryption",
          "100% uncompressed RAW & EXIF preservation",
          "Append-only Telegram Write-Ahead Log (WAL) disaster recovery",
          "$0/month serverless edge architecture",
        ],
        "author": {
          "@type": "Person",
          "name": "Shiva Reddy",
          "url": "https://github.com/ShivaReddyVanja",
        },
      },
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        "url": SITE_URL,
        "name": BRAND_NAME,
        "description": BRAND_DESCRIPTION,
        "inLanguage": "en-US",
      },
      {
        "@type": "Organization",
        "@id": `${SITE_URL}/#organization`,
        "name": BRAND_NAME,
        "url": SITE_URL,
        "logo": `${SITE_URL}/favicon.svg`,
        "sameAs": ["https://github.com/ShivaReddyVanja/aetheroll"],
      },
      {
        "@type": "FAQPage",
        "@id": `${SITE_URL}/#faq`,
        "mainEntity": FAQ_ITEMS.map((item) => ({
          "@type": "Question",
          "name": item.question,
          "acceptedAnswer": {
            "@type": "Answer",
            "text": item.answer,
          },
        })),
      },
    ],
  };

  return (
    <html lang="en" className="dark scroll-smooth">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body className="bg-zinc-950 text-zinc-100 min-h-screen antialiased selection:bg-zinc-800 selection:text-white">
        {children}
      </body>
    </html>
  );
}
