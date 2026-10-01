import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  turbopack: {
    // Keep resolution rooted in this app (parent dirs may have stray lockfiles)
    root: path.join(__dirname),
  },
};

export default nextConfig;
