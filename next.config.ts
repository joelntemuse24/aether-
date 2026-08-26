import type { NextConfig } from "next";

const securityHeaders = [
  // Chat renders model-generated markdown/HTML; keep the app out of frames.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), geolocation=(), payment=(), usb=()",
  },
];

const nextConfig: NextConfig = {
  // Keep PGlite (and its WASM/fs paths) out of the Next bundle — otherwise
  // `import.meta.url` resolution breaks with ERR_INVALID_ARG_TYPE on URL.
  serverExternalPackages: ["@electric-sql/pglite"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
