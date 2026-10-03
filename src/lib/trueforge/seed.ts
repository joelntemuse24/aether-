import { TrueForge } from "@truefoundry/trueforge-sdk";
import { listBuzzChatModels } from "@/lib/buzz/models";
import { aetherProviderManifests, type AetherProviderManifest } from "./providers";

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

/** Upsert Buzz GPT and Claude models. Missing keys are skipped. A bad model does not stop the sidecar. */
export async function seedAetherModelProviders(origin: string): Promise<string[]> {
  const listed = await listBuzzChatModels();
  const manifests = aetherProviderManifests(
    process.env,
    listed.map((model) => model.id),
  );
  if (manifests.length === 0) return [];

  const client = new TrueForge({ baseUrl: origin, auth: false });
  return upsertAetherProviders(manifests, (manifest) =>
    client.settings.modelProviders.createOrUpdate({ manifest }),
  );
}
