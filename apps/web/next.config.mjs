import path from "path";

const backendMode = (
  process.env.BACKEND_MODE ||
  process.env.NEXT_PUBLIC_BACKEND_MODE ||
  "prod"
).toLowerCase().trim();

const isProdBackend = backendMode === "prod" || backendMode === "remote";

const remoteUrl =
  process.env.REMOTE_API_URL ||
  process.env.NEXT_PUBLIC_REMOTE_API_URL ||
  "";

console.log(
  `\x1b[36m[Backend Switch]\x1b[0m Active Backend: \x1b[1m${
    isProdBackend
      ? `🟢 PROD / REMOTE (${remoteUrl || "same-origin / Cloudflare Pages"})`
      : "🟠 DEV / LOCAL (Node.js + SQLite)"
  }\x1b[0m`
);

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: process.env.NEXT_EXPORT === "true" ? "export" : undefined,
  images: { unoptimized: true },
  reactStrictMode: true,
  turbopack: {
    root: path.resolve(process.cwd()),
  },
  serverExternalPackages: ["telegram", "better-sqlite3"],
  experimental: {
    middlewareClientMaxBodySize: "100mb",
    serverActions: {
      bodySizeLimit: "100mb",
    },
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        crypto: false,
        child_process: false,
        path: false,
        os: false,
      };
    }
    return config;
  },
  async rewrites() {
    if (isProdBackend && remoteUrl) {
      return {
        beforeFiles: [
          {
            source: "/api/:path*",
            destination: `${remoteUrl.replace(/\/$/, "")}/api/:path*`,
          },
        ],
      };
    }
    return [];
  },
};

export default nextConfig;
