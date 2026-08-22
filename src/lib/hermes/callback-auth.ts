export function aetherToolsCallbackSecret(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string | null {
  const dedicated = env.AETHER_TOOLS_TOKEN?.trim();
  if (dedicated) return dedicated;
  const gateway = env.HERMES_API_KEY?.trim();
  if (gateway) return gateway;
  return null;
}

function bearerFromHeaders(headers: {
  authorization?: string | string[] | null;
  get?: (name: string) => string | null;
}): string {
  if (typeof headers.get === "function") {
    return headers.get("authorization")?.trim() || "";
  }
  const raw = headers.authorization;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value?.trim() || "";
}

export function authorizeAetherToolsCallback(
  headers: {
    authorization?: string | string[] | null;
    get?: (name: string) => string | null;
  },
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): boolean {
  const secret = aetherToolsCallbackSecret(env);
  if (!secret) return false;
  const auth = bearerFromHeaders(headers);
  const match = /^Bearer\s+(.+)$/i.exec(auth);
  const token = match?.[1]?.trim() ?? "";
  if (!token || token.length !== secret.length) return false;
  // Constant-time compare for equal-length secrets.
  let diff = 0;
  for (let i = 0; i < token.length; i++) {
    diff |= token.charCodeAt(i) ^ secret.charCodeAt(i);
  }
  return diff === 0;
}
