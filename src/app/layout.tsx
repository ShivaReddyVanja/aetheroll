import type { Metadata } from "next";
import { BRAND_NAME, BRAND_TAGLINE, BRAND_DESCRIPTION } from "@/lib/brand";
import "./globals.css";

export const metadata: Metadata = {
  title: `${BRAND_NAME} | ${BRAND_TAGLINE}`,
  description: BRAND_DESCRIPTION,
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
    shortcut: "/favicon.svg",
    apple: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="bg-slate-950 text-slate-100 min-h-screen antialiased selection:bg-blue-600 selection:text-white">
        {children}
      </body>
    </html>
  );
}
