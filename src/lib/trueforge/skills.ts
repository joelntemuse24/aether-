import { TrueForge } from "@truefoundry/trueforge-sdk";

/** Copied from the shipped TrueForge 0.2.1 catalog. Unknown names reject sessions. */
export const SAFE_TRUEFORGE_SKILLS = [{
  type: "git" as const,
  name: "web-artifacts-builder",
  url: "https://github.com/anthropics/skills",
  path: "skills/web-artifacts-builder",
  ref: "main",
  description: "Build self-contained web artifacts (HTML/JS/CSS) that render as interactive standalone pages.",
}];

export function optedInTrueForgeSkills(env: NodeJS.ProcessEnv = process.env): string[] {
  const value = (env.AETHER_TRUEFORGE_SKILLS ?? "").trim();
  if (/^(0|off|false)$/i.test(value)) return [];
  const names = value ? value.split(",").map((name) => name.trim()) : ["web-artifacts-builder"];
  return SAFE_TRUEFORGE_SKILLS.filter((skill) => names.includes(skill.name)).map((skill) => skill.name);
}

export function mountedTrueForgeSkills(
  sandboxEnabled: boolean,
  env: NodeJS.ProcessEnv = process.env,
  seededNames?: readonly string[],
): string[] {
  if (!sandboxEnabled) return [];
  return optedInTrueForgeSkills(env).filter((name) => seededNames === undefined || seededNames.includes(name));
}

export async function seedAetherSkills(
  origin: string,
  env: NodeJS.ProcessEnv = process.env,
  upsert = (manifest: typeof SAFE_TRUEFORGE_SKILLS[number]) =>
    new TrueForge({ baseUrl: origin, auth: false }).settings.skills.createOrUpdate({ manifest }),
): Promise<string[]> {
  const optedIn = optedInTrueForgeSkills(env);
  const seeded: string[] = [];
  for (const manifest of SAFE_TRUEFORGE_SKILLS) {
    if (!optedIn.includes(manifest.name)) continue;
    try {
      await upsert(manifest);
      seeded.push(manifest.name);
    } catch {
      console.warn("[aether] skipped skill registration", manifest.name);
    }
  }
  return seeded;
}

export const CONFIGURED_SKILLS_TTL_MS = 45_000;
export const CONFIGURED_SKILLS_FAILURE_TTL_MS = 5_000;

let configuredSkillsCache: { names: string[]; at: number; ttl: number } | null = null;

export function resetConfiguredSkillsCache(): void {
  configuredSkillsCache = null;
}

/**
 * Names registered in the sidecar's settings.skills. The catalog lists more than the
 * sidecar has configured, and attaching an unregistered name 422s session create.
 * A failed or empty list resolves to [] so the session mounts no skills.
 */
export async function configuredTrueForgeSkillNames(
  list: () => Promise<readonly string[]>,
  now = Date.now(),
): Promise<string[]> {
  if (configuredSkillsCache && now - configuredSkillsCache.at < configuredSkillsCache.ttl) {
    return configuredSkillsCache.names;
  }
  try {
    const names = [...(await list())];
    configuredSkillsCache = { names, at: now, ttl: CONFIGURED_SKILLS_TTL_MS };
    return names;
  } catch {
    console.warn("[trueforge] could not list configured skills; mounting none");
    configuredSkillsCache = { names: [], at: now, ttl: CONFIGURED_SKILLS_FAILURE_TTL_MS };
    return [];
  }
}
