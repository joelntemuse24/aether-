import { NextResponse } from "next/server";
import { DEFAULT_HOSTED_MODEL, filterCatalogForCapabilities } from "@/lib/hosted/catalog";
import { getHostedCapabilities, isHostedConfigured } from "@/lib/hosted/config";
import {
  hermesFallbackPickerModels,
  isHostedChatAvailable,
} from "@/lib/hosted/availability";
import { fetchRankedHostedCatalog } from "@/lib/hosted/openrouter-catalog";
import { hostedCloudRouteAdvertisement } from "@/lib/hosted/speed-tiers";
import { resolveChatTransportMode } from "@/lib/trigger/config";

export const runtime = "nodejs";

/**
 * Public hosted status + ranked live model catalog.
 * Does not expose API keys, base URLs, or upstream vendor names.
 */
export async function GET() {
  const capabilities = getHostedCapabilities();
  const available = isHostedChatAvailable(process.env, isHostedConfigured());
  const advertised = hostedCloudRouteAdvertisement();

  let models: Awaited<ReturnType<typeof fetchRankedHostedCatalog>>["models"] = [];
  let defaultModel: string = advertised.defaultModel || DEFAULT_HOSTED_MODEL;

  try {
    const live = await fetchRankedHostedCatalog();
    models = filterCatalogForCapabilities(live.models, capabilities);
    // Cloud default is the Fast route, not the ranked catalog flagship.
    defaultModel = advertised.defaultModel;
  } catch (err) {
    console.error("[api/hosted/status] catalog", err);
    // Hosted may still be available via Hermes; picker falls back below.
  }

  if (models.length === 0 && available) {
    const fallback = hermesFallbackPickerModels();
    if (fallback.length) {
      models = fallback;
      defaultModel = fallback[0].id;
    }
  }

  return NextResponse.json({
    available,
    chatTransport: resolveChatTransportMode(),
    capabilities: {
      claude: capabilities.claude,
      gpt: capabilities.gpt,
      catalog: capabilities.catalog,
    },
    defaultModel,
    routes: advertised.routes,
    models: models.map((m) => ({
      id: m.id,
      label: m.label,
      family: m.family,
      description: m.description,
    })),
  });
}
