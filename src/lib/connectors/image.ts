/**
 * Hosted image generation via OpenRouter.
 * Image-capable models on OpenRouter are chat-completions models with image
 * output (`modalities: ["image", "text"]`), not /images/generations endpoints —
 * so this is a direct chat call using the existing hosted OpenRouter key.
 */

export type ImageUpstream = {
  baseURL: string;
  apiKey: string;
  modelId: string;
  configured: boolean;
};

const DEFAULT_IMAGE_BASE = "https://openrouter.ai/api/v1";

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

export function getImageUpstream(): ImageUpstream {
  const apiKey =
    env("AETHER_HOSTED_IMAGE_API_KEY") || env("OPENROUTER_API_KEY");
  const baseURL = (
    env("AETHER_HOSTED_IMAGE_BASE_URL") || DEFAULT_IMAGE_BASE
  ).replace(/\/+$/, "");
  const modelId =
    env("AETHER_HOSTED_IMAGE_MODEL") || "google/gemini-2.5-flash-image";
  return { apiKey, baseURL, modelId, configured: apiKey.length > 0 };
}

export function isImageGenerationConfigured(): boolean {
  return getImageUpstream().configured;
}

const SIZE_HINTS = {
  square: "Square 1:1 aspect ratio.",
  portrait: "Vertical 2:3 portrait aspect ratio.",
  landscape: "Horizontal 3:2 landscape aspect ratio.",
} as const;

type OpenRouterImageResult = {
  ok: true;
  kind: "image";
  title: string;
  content: string;
  mime: string;
};

export function parseGeneratedImageDataUrl(
  dataUrl: string,
): { mime: string; content: string } | null {
  if (!dataUrl.startsWith("data:image/")) return null;
  const semi = dataUrl.indexOf(";");
  const mime = (semi > 5 ? dataUrl.slice(5, semi) : "") || "image/png";
  return { mime, content: dataUrl };
}

export async function generateImageForUser(input: {
  prompt: string;
  size?: "square" | "portrait" | "landscape";
}): Promise<OpenRouterImageResult | { ok: false; error: string }> {
  const upstream = getImageUpstream();
  if (!upstream.configured) {
    return {
      ok: false,
      error:
        "Image generation is unavailable. An operator needs to enable hosted image generation.",
    };
  }
  const prompt =
    input.size && input.size !== "square"
      ? `${input.prompt}\n\n${SIZE_HINTS[input.size]}`
      : input.prompt;
  try {
    const res = await fetch(`${upstream.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${upstream.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.APP_ORIGIN || "https://aether.app",
        "X-Title": "Aether",
      },
      body: JSON.stringify({
        model: upstream.modelId,
        messages: [{ role: "user", content: prompt }],
        modalities: ["image", "text"],
      }),
    });
    if (!res.ok) {
      return {
        ok: false,
        error:
          res.status === 402 || res.status === 429
            ? "Image generation is temporarily unavailable — credits or rate limit. Try again shortly."
            : `Image generation failed (${res.status}). Try again shortly.`,
      };
    }
    const data = (await res.json()) as {
      choices?: Array<{
        message?: {
          images?: Array<{ image_url?: { url?: string } }>;
        };
      }>;
    };
    const dataUrl =
      data.choices?.[0]?.message?.images?.[0]?.image_url?.url ?? "";
    const parsed = parseGeneratedImageDataUrl(dataUrl);
    if (!parsed) {
      return { ok: false, error: "Image generation is unavailable — no image returned." };
    }
    return {
      ok: true,
      kind: "image",
      title: input.prompt.slice(0, 60) || "Generated image",
      content: parsed.content,
      mime: parsed.mime,
    };
  } catch {
    return { ok: false, error: "Image generation failed. Try again shortly." };
  }
}
