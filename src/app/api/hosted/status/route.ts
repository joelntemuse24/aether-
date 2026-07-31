import { NextResponse } from "next/server";
import {
  filterCatalogForCapabilities,
  DEFAULT_HOSTED_MODEL,
} from "@/lib/hosted/catalog";
import { getHostedCapabilities } from "@/lib/hosted/config";

export const runtime = "nodejs";

/**
 * Public hosted status + curated model catalog.
 * Does not expose API keys, base URLs, or upstream vendor names.
 */
export async function GET() {
  const capabilities = getHostedCapabilities();
  const models = filterCatalogForCapabilities(capabilities);
  const defaultModel =
    models.find((m) => m.id === DEFAULT_HOSTED_MODEL)?.id ??
    models[0]?.id ??
    "";

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
