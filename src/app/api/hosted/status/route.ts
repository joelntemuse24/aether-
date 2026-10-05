import { NextResponse } from "next/server";
import { filterCatalogForCapabilities } from "@/lib/hosted/catalog";
import { getHostedCapabilities, isHostedConfigured } from "@/lib/hosted/config";
import {
  hermesFallbackPickerModels,
  isHostedChatAvailable,
} from "@/lib/hosted/availability";
import {
  HOSTED_DEFAULT_MODEL_ID,
  buzzModelsEnabled,
  hostedDefaultPickerModel,
} from "@/lib/hosted/default-model";
import { fetchRankedHostedCatalog } from "@/lib/hosted/openrouter-catalog";
import type { RankedModelOption } from "@/lib/hosted/rank-models";
import { hostedCloudRouteAdvertisement } from "@/lib/hosted/speed-tiers";
import { resolveChatTransportMode } from "@/lib/trigger/config";

export const runtime = "nodejs";

function hostedDefaultStatusModel(): RankedModelOption {
  return {
    id: HOSTED_DEFAULT_MODEL_ID,
    label: hostedDefaultPickerModel().label,
    family: "other",
    description: "Default model",
  };
}

/**
 * Public hosted status. Mirrors /api/hosted/models: the hosted default is the
 * default model in both modes, and the ranked live catalog, Expert route and
 * failover chain appear only while AETHER_BUZZ_MODELS_ENABLED is on. With Buzz
 * off the catalog is not fetched at all.
 *
 * The only client reader is settings-provider.tsx. It uses `defaultModel` and
 * `routes.expert` to remap the hosted model and `models` for the active-model
 * label (falling back to local label tables), so BYOK pickers do not read
 * this response and keep working with the shorter list.
 *
 * Does not expose API keys, base URLs, or upstream vendor names.
 */
export async function GET() {
  const capabilities = getHostedCapabilities();
  const available = isHostedChatAvailable(process.env, isHostedConfigured());
  const buzz = buzzModelsEnabled();
  const hostedDefault = hostedDefaultStatusModel();

  let models: RankedModelOption[] = [hostedDefault];
  let routes: { expert: string; fast?: string } = {
    expert: HOSTED_DEFAULT_MODEL_ID,
  };
  let failover: { expert: string[]; fast?: string[] } = { expert: [] };

  if (buzz) {
    const advertised = hostedCloudRouteAdvertisement();
    routes = advertised.routes;
    failover = advertised.failover;
    let live: RankedModelOption[] = [];
    try {
      const catalog = await fetchRankedHostedCatalog();
      live = filterCatalogForCapabilities(catalog.models, capabilities);
    } catch (err) {
      console.error("[api/hosted/status] catalog", err);
      // Hosted may still be available via Hermes; picker falls back below.
    }
    if (live.length === 0 && available) live = hermesFallbackPickerModels();
    models = [hostedDefault, ...live.filter((m) => m.id !== hostedDefault.id)];
  }

  return NextResponse.json({
    available,
    chatTransport: resolveChatTransportMode(),
    capabilities: {
      claude: capabilities.claude,
      gpt: capabilities.gpt,
      catalog: capabilities.catalog,
    },
    defaultModel: HOSTED_DEFAULT_MODEL_ID,
    routes,
    failover,
    models: models.map((m) => ({
      id: m.id,
      label: m.label,
      family: m.family,
      description: m.description,
    })),
  });
}
