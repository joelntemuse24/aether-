import "./compile-cache";
import { TrueForge } from "@truefoundry/trueforge-sdk";
import { listBuzzChatModels } from "@/lib/buzz/models";
import { HOSTED_DEFAULT_MODEL_FQN } from "@/lib/hosted/default-model";
import {
  aetherProviderManifests,
  type AetherProviderManifest,
} from "./providers";

function providerLabel(manifest: AetherProviderManifest): string {
  return manifest.type === "anthropic" ? "anthropic" : manifest.name;
}

/**
 * Upsert one model at a time. A rejected entry is logged and left out of the
 * provider list. Each success sends every model accepted so far, because the
 * settings API replaces that list.
 */
export async function upsertAetherProviders(
  manifests: AetherProviderManifest[],
  upsert: (manifest: AetherProviderManifest) => Promise<unknown>,
): Promise<string[]> {
  const seeded: string[] = [];
  for (const manifest of manifests) {
    const accepted: AetherProviderManifest["models"] = [];
    for (const model of manifest.models) {
      try {
        await upsert({ ...manifest, models: [...accepted, model] });
        accepted.push(model);
      } catch (error) {
        console.warn(
          "[trueforge] skipped model",
          model.modelId,
          error instanceof Error ? error.message : "seed failed",
        );
      }
    }
    if (accepted.length > 0) seeded.push(providerLabel(manifest));
  }
  return seeded;
}

export const DEFAULT_MODEL_SEED_ATTEMPTS = 3;
export const DEFAULT_MODEL_SEED_BACKOFF_MS = 2000;

/**
 * After a seed, confirm the hosted default model is listed. A missing model
 * triggers another seed and check, up to `attempts` times in total. Returns
 * true when the model is present.
 */
export async function ensureDefaultModelSeeded(input: {
  fqn: string;
  listModelNames: () => Promise<string[]>;
  reseed: () => Promise<unknown>;
  attempts?: number;
  backoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: Pick<Console, "info" | "warn" | "error">;
}): Promise<boolean> {
  const attempts = input.attempts ?? DEFAULT_MODEL_SEED_ATTEMPTS;
  const backoffMs = input.backoffMs ?? DEFAULT_MODEL_SEED_BACKOFF_MS;
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const log = input.log ?? console;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      if ((await input.listModelNames()).includes(input.fqn)) {
        log.info(`[aether] TrueForge default model ${input.fqn} is configured`);
        return true;
      }
      log.warn(`[aether] TrueForge default model ${input.fqn} missing (check ${attempt}/${attempts})`);
    } catch (error) {
      log.warn(
        `[aether] TrueForge models list failed (check ${attempt}/${attempts}):`,
        error instanceof Error ? error.message : error,
      );
    }
    if (attempt === attempts) break;
    await sleep(backoffMs * attempt);
    try {
      await input.reseed();
    } catch (error) {
      log.warn("[aether] TrueForge re-seed failed:", error instanceof Error ? error.message : error);
    }
  }
  log.error(`[aether] TrueForge default model ${input.fqn} is still not configured after ${attempts} checks`);
  return false;
}

async function seedFromEnv(client: TrueForge): Promise<string[]> {
  const listed = await listBuzzChatModels();
  const manifests = aetherProviderManifests(
    process.env,
    listed.map((model) => model.id),
  );
  if (manifests.length === 0) return [];
  return upsertAetherProviders(manifests, (manifest) =>
    client.settings.modelProviders.createOrUpdate({ manifest }),
  );
}

/**
 * Upsert Buzz GPT and Claude models. Missing keys are skipped. A bad model does not stop the sidecar.
 * Verify the hosted default model is listed and re-seed if it is not.
 */
export async function seedAetherModelProviders(origin: string): Promise<string[]> {
  const client = new TrueForge({ baseUrl: origin, auth: false });
  let seeded = await seedFromEnv(client);
  await ensureDefaultModelSeeded({
    fqn: HOSTED_DEFAULT_MODEL_FQN,
    listModelNames: async () => ((await client.models.list()).data ?? []).map((m) => m.name),
    reseed: async () => {
      seeded = await seedFromEnv(client);
    },
  });
  return seeded;
}
