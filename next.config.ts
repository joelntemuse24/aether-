import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep PGlite (and its WASM/fs paths) out of the Next bundle — otherwise
  // `import.meta.url` resolution breaks with ERR_INVALID_ARG_TYPE on URL.
  serverExternalPackages: ["@electric-sql/pglite", "@trigger.dev/sdk"],
  transpilePackages: ["@trigger.dev/sdk"],
};

export default nextConfig;
