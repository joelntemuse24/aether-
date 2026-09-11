import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SpeedTier } from "../../src/lib/hosted/speed-tiers";
import {
  REQUIRED_CATEGORIES,
  type ProbePack,
  type ProbePrompt,
  type ProbeSurface,
} from "./types";

const PACK_DIR = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_PACK_PATH = join(PACK_DIR, "prompts.json");

function normalizePrompt(prompt: ProbePrompt): ProbePrompt {
  return {
    ...prompt,
    surfaces: prompt.surfaces?.length ? prompt.surfaces : ["api", "ui"],
  };
}

export function loadProbePack(path: string = DEFAULT_PACK_PATH): ProbePack {
  const raw = JSON.parse(readFileSync(path, "utf8")) as ProbePack;
  if (!Array.isArray(raw.seeds) || !Array.isArray(raw.harvested)) {
    throw new Error("prompts.json must have seeds[] and harvested[] arrays.");
  }
  return {
    ...raw,
    seeds: raw.seeds.map(normalizePrompt),
    harvested: raw.harvested.map(normalizePrompt),
  };
}

export function enabledPrompts(pack: ProbePack): ProbePrompt[] {
  const fromHarvest = pack.harvested.filter(
    (p) => p.enabled !== false && p.prompt.trim().length > 0,
  );
  const seeds = pack.seeds.filter((p) => p.enabled !== false && p.prompt.trim());
  return [...seeds, ...fromHarvest];
}

export function selectPrompts(
  pack: ProbePack,
  options: {
    smoke?: boolean;
    ids?: string[];
    categories?: string[];
    surface?: ProbeSurface;
  },
): ProbePrompt[] {
  let list = enabledPrompts(pack);
  if (options.smoke) list = list.filter((p) => p.smoke === true);
  if (options.ids?.length) {
    const want = new Set(options.ids);
    list = list.filter((p) => want.has(p.id));
  }
  if (options.categories?.length) {
    const want = new Set(options.categories);
    list = list.filter((p) => want.has(p.category));
  }
  if (options.surface) {
    list = list.filter((p) => (p.surfaces ?? ["api", "ui"]).includes(options.surface!));
  }
  return list;
}

export function expandCases(
  prompts: ProbePrompt[],
  tiers: SpeedTier[],
): Array<{ prompt: ProbePrompt; tier: SpeedTier }> {
  const cases: Array<{ prompt: ProbePrompt; tier: SpeedTier }> = [];
  for (const prompt of prompts) {
    const allowed = prompt.tiers?.length ? prompt.tiers : tiers;
    for (const tier of tiers) {
      if (!allowed.includes(tier)) continue;
      cases.push({ prompt, tier });
    }
  }
  return cases;
}

export function packCoverageErrors(pack: ProbePack): string[] {
  const errors: string[] = [];
  const seedCount = pack.seeds.length;
  if (seedCount < 8 || seedCount > 12) {
    errors.push(`expected 8–12 seed prompts, found ${seedCount}`);
  }
  const cats = new Set(pack.seeds.map((s) => s.category));
  for (const cat of REQUIRED_CATEGORIES) {
    if (!cats.has(cat)) errors.push(`missing category ${cat}`);
  }
  if (!pack.harvested.some((h) => h.source === "grok-harvest")) {
    errors.push("harvested[] must include grok-harvest placeholders");
  }
  if (
    !pack.harvested.some(
      (h) => h.source === "grok-harvest" && (h.surfaces ?? []).includes("ui"),
    )
  ) {
    errors.push("harvested[] grok-harvest rows must include the ui surface");
  }
  const smoke = pack.seeds.filter((s) => s.smoke);
  if (smoke.length === 0 || smoke.length > 4) {
    errors.push(`smoke subset must be 1–4 prompts, found ${smoke.length}`);
  }
  return errors;
}
