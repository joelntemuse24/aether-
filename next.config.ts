import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep PGlite (and its WASM/fs paths) out of the Next bundle — otherwise
  // `import.meta.url` resolution breaks with ERR_INVALID_ARG_TYPE on URL.
  // `@trigger.dev/sdk` is transpiled for the client transport hook — do not
  // also list it in serverExternalPackages (Next 15 treats that as a conflict).
  serverExternalPackages: ["@electric-sql/pglite"],
  transpilePackages: ["@trigger.dev/sdk"],
};

export default nextConfig;
