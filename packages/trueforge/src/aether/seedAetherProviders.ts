import type { Logger } from 'winston';

import type { IModelProviderStore } from '../db/modelProviderStore';
import type { ModelProviderManifest } from '../schemas/modelProvider';
import { AETHER_TENANT_ID, aetherProviderManifests } from './aetherProviders';

/**
 * Upsert Buzz and OpenRouter when their server keys are set.
 * Missing keys leave any previously saved provider alone.
 * TrueFoundry mode uses a remote catalog, so callers skip this.
 */
export async function seedAetherModelProviders(
  store: IModelProviderStore,
  logger: Logger,
): Promise<void> {
  const manifests = aetherProviderManifests();
  for (const manifest of manifests) {
    await store.upsertProvider({
      tenant_id: AETHER_TENANT_ID,
      name: manifest.name,
      manifest: manifest as ModelProviderManifest,
    });
    logger.info('Aether model provider ready', { provider: manifest.name, base_url: manifest.base_url });
  }
}
