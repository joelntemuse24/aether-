import { TrueForge } from "@truefoundry/trueforge-sdk";
import { listBuzzChatModels } from "@/lib/buzz/models";
import { aetherProviderManifests } from "./providers";

/** Upsert Buzz GPT and Claude models. Missing keys are skipped. */
export async function seedAetherModelProviders(origin: string): Promise<string[]> {
  const listed = await listBuzzChatModels();
  const manifests = aetherProviderManifests(
    process.env,
    listed.map((model) => model.id),
  );
  if (manifests.length === 0) return [];

  const client = new TrueForge({ baseUrl: origin, auth: false });
  const seeded: string[] = [];
  for (const manifest of manifests) {
    await client.settings.modelProviders.createOrUpdate({ manifest });
    seeded.push(manifest.type === "anthropic" ? "anthropic" : manifest.name);
  }
  return seeded;
}
