import type { NextConfig } from "next";

const trueforgePort = process.env.TRUEFORGE_PORT || "8790";

const nextConfig: NextConfig = {
  // Keep PGlite (and its WASM/fs paths) out of the Next bundle — otherwise
  // `import.meta.url` resolution breaks with ERR_INVALID_ARG_TYPE on URL.
  // `@trigger.dev/sdk` is transpiled for the client transport hook — do not
  // also list it in serverExternalPackages (Next 15 treats that as a conflict).
  serverExternalPackages: ["@electric-sql/pglite", "@truefoundry/trueforge-sdk"],
  transpilePackages: ["@trigger.dev/sdk"],
  async rewrites() {
    if (process.env.AETHER_TRUEFORGE === "0") return [];
    return [
      {
        source: "/api/v1/:path*",
        destination: `http://127.0.0.1:${trueforgePort}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
