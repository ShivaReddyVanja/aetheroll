import path from "path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  turbopack: {
    root: path.resolve(process.cwd()),
  },
  serverExternalPackages: ["telegram", "better-sqlite3"],
};

export default nextConfig;
