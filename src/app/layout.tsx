import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Aetheroll | Infinite Cloud Photo & Video Gallery",
  description: "Unlimited, private, zero-knowledge cloud camera roll and media gallery",
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
