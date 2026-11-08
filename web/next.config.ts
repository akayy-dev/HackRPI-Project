import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Reads the .mmdb from disk at runtime; keep it out of the bundle.
  serverExternalPackages: ["maxmind"],
};

export default nextConfig;
