import {
  OPENROUTER_CURATED_MODELS,
  filterOpenRouterChatModels,
  type OpenRouterCatalogRow,
} from "@/lib/openrouter/models";

export async function GET(req: Request) {
  const key = req.headers.get("x-openrouter-key")?.trim() ?? "";
  if (!key) {
    return Response.json({ models: [] }, { status: 401 });
  }
  try {
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      return Response.json({ models: OPENROUTER_CURATED_MODELS, fallback: true });
    }
    const body = (await response.json()) as { data?: OpenRouterCatalogRow[] };
    const models = filterOpenRouterChatModels(body.data ?? []);
    return Response.json({
      models: models.length ? models : OPENROUTER_CURATED_MODELS,
      fallback: models.length === 0,
    });
  } catch {
    return Response.json({ models: OPENROUTER_CURATED_MODELS, fallback: true });
  }
}
