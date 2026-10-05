/**
 * Use TRUEFORGE_DATABASE_URL + REDIS_URL for the Contabo hosted opt-in.
 * The database alias avoids colliding with Neon DATABASE_URL on Vercel.
 */
export function trueforgeHostedEnvConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const databaseUrl = env.TRUEFORGE_DATABASE_URL?.trim() || env.DATABASE_URL?.trim();
  const redisUrl = env.REDIS_URL?.trim() || env.TRUEFORGE_REDIS_URL?.trim();
  return Boolean(databaseUrl && redisUrl);
}

export function buildTrueForgeUpstreamEnv(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const hosted = trueforgeHostedEnvConfigured(env);
  const upstreamEnv: NodeJS.ProcessEnv = { ...env, STANDALONE: hosted ? "false" : "true" };

  if (hosted) {
    if (env.TRUEFORGE_DATABASE_URL?.trim()) upstreamEnv.DATABASE_URL = env.TRUEFORGE_DATABASE_URL;
    if (env.TRUEFORGE_REDIS_URL?.trim()) upstreamEnv.REDIS_URL = env.TRUEFORGE_REDIS_URL;
  }

  return upstreamEnv;
}
