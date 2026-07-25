/**
 * Shared Auth.js / magic-link / Drive cookie secret.
 * Matches NextAuth fallback so local email sign-in works without .env.
 * Always set AUTH_SECRET in production.
 */
export const DEV_AUTH_SECRET = "aether-dev-secret-change-me";

export function getAuthSecretString(): string {
  return process.env.AUTH_SECRET || DEV_AUTH_SECRET;
}

export function getAuthSecretKey(): Uint8Array {
  return new TextEncoder().encode(getAuthSecretString());
}
