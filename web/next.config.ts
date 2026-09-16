import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Build off-live: NEXT_DIST_DIR=.next-build lets us compile without touching
  // the .next the running search-web service is serving, then swap atomically.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // react-leaflet v5 doesn't tolerate strict-mode's synchronous double-mount
  // (throws "Map container is already initialized").
  reactStrictMode: false,
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    formats: ["image/avif", "image/webp"],
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://127.0.0.1:4078/api/:path*",
      },
    ];
  },
};

export default nextConfig;
