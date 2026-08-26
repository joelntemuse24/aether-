/**
 * Shared Auth.js / magic-link / Drive cookie secret.
 * Matches NextAuth fallback so local email sign-in works without .env.
 * Always set AUTH_SECRET in production.
 */
export const DEV_AUTH_SECRET = "aether-dev-secret-change-me";

/**
 * Production fallback when AUTH_SECRET is missing: a random per-process
 * secret. Sessions/magic links won't survive restarts or span instances,
 * but nobody can forge them with the public dev constant. Guest (no-auth)
 * chat keeps working either way.
 */
let generatedSecret: string | null = null;

function isProductionRuntime(): boolean {
  return (
    process.env.NODE_ENV === "production" &&
    // `next build` loads route modules with NODE_ENV=production; only the
    // running server should trip the missing-secret path.
    process.env.NEXT_PHASE !== "phase-production-build"
  );
}

export function getAuthSecretString(): string {
  const configured = process.env.AUTH_SECRET?.trim();
  if (configured) return configured;
  if (isProductionRuntime()) {
    if (!generatedSecret) {
      const bytes = new Uint8Array(32);
      crypto.getRandomValues(bytes);
      generatedSecret = Buffer.from(bytes).toString("base64url");
      console.error(
        "[auth] AUTH_SECRET is not set in production. Using a random per-process secret: " +
          "sign-in sessions and magic links will NOT work reliably until AUTH_SECRET is configured " +
          "(generate one with `openssl rand -base64 32`).",
      );
    }
    return generatedSecret;
  }
  return DEV_AUTH_SECRET;
}

export function getAuthSecretKey(): Uint8Array {
  return new TextEncoder().encode(getAuthSecretString());
}
