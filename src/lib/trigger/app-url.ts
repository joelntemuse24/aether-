/**
 * Public origin of the Next app (Vercel). Used by the durable agent to call
 * Aether-owned tools. Not shown in product UI.
 */

export function aetherAppOrigin(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string {
  const explicit = env.AETHER_APP_URL?.trim() || env.AUTH_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = env.VERCEL_URL?.trim();
  if (vercel) {
    if (/^https?:\/\//i.test(vercel)) return vercel.replace(/\/+$/, "");
    return `https://${vercel.replace(/\/+$/, "")}`;
  }
  return "http://localhost:3000";
}
