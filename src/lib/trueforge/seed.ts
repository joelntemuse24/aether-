import { TrueForge } from "@truefoundry/trueforge-sdk";
import { aetherProviderManifests } from "./providers";

/** Upsert Buzz and OpenRouter on a running TrueForge server. Missing keys are skipped. */
export async function seedAetherModelProviders(origin: string): Promise<string[]> {
  const manifests = aetherProviderManifests();
  if (manifests.length === 0) return [];

  const client = new TrueForge({ baseUrl: origin, auth: false });
  const seeded: string[] = [];
  for (const manifest of manifests) {
    await client.settings.modelProviders.createOrUpdate({ manifest });
    seeded.push(manifest.name);
  }
  return seeded;
}
