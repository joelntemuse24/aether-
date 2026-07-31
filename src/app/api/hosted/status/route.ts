import { NextResponse } from "next/server";
import { DEFAULT_HOSTED_MODEL, filterCatalogForCapabilities } from "@/lib/hosted/catalog";
import { getHostedCapabilities } from "@/lib/hosted/config";
import { fetchRankedHostedCatalog } from "@/lib/hosted/openrouter-catalog";

export const runtime = "nodejs";

/**
 * Public hosted status + ranked live model catalog.
 * Does not expose API keys, base URLs, or upstream vendor names.
 */
export async function GET() {
  const capabilities = getHostedCapabilities();

  let models: Awaited<ReturnType<typeof fetchRankedHostedCatalog>>["models"] = [];
  let defaultModel: string = DEFAULT_HOSTED_MODEL;

  try {
    const live = await fetchRankedHostedCatalog();
    models = filterCatalogForCapabilities(live.models, capabilities);
    defaultModel =
      models.find((m) => m.id === live.defaultModel)?.id ??
      models.find((m) => m.family === "chatgpt")?.id ??
      models[0]?.id ??
      "";
  } catch (err) {
    console.error("[api/hosted/status] catalog", err);
    // Hosted may still be available for chat; picker will show empty/error state.
  }

  return NextResponse.json({
    available: capabilities.available,
    capabilities: {
      claude: capabilities.claude,
      gpt: capabilities.gpt,
      catalog: capabilities.catalog,
    },
    defaultModel,
    models: models.map((m) => ({
      id: m.id,
      label: m.label,
      family: m.family,
      description: m.description,
    })),
  });
}
