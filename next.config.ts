import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Ensure AI SDK packages are not improperly externalized on Vercel
  serverExternalPackages: [],
};

export default nextConfig;
