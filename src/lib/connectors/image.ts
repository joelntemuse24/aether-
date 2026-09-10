import { createOpenAI } from "@ai-sdk/openai";
import { generateImage, type ImageModel } from "ai";

/**
 * Hosted image generation configuration.
 * Dedicated endpoint — hosted chat upstreams are not assumed to implement
 * the OpenAI /images/generations contract.
 */
export type ImageUpstream = {
  baseURL: string;
  apiKey: string;
  modelId: string;
  configured: boolean;
};

const DEFAULT_IMAGE_BASE = "https://api.openai.com/v1";
const DEFAULT_IMAGE_MODEL = "gpt-image-1";

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

export function getImageUpstream(): ImageUpstream {
  const apiKey = env("AETHER_HOSTED_IMAGE_API_KEY");
  const baseURL = env("AETHER_HOSTED_IMAGE_BASE_URL").replace(/\/+$/, "");
  const modelId = env("AETHER_HOSTED_IMAGE_MODEL") || DEFAULT_IMAGE_MODEL;
  return {
    apiKey,
    baseURL: baseURL || DEFAULT_IMAGE_BASE,
    modelId,
    configured: apiKey.length > 0,
  };
}

export function isImageGenerationConfigured(): boolean {
  return getImageUpstream().configured;
}

const SIZE_MAP = {
  square: "1024x1024",
  portrait: "1024x1536",
  landscape: "1536x1024",
} as const;

export async function generateImageForUser(input: {
  prompt: string;
  size?: "square" | "portrait" | "landscape";
}): Promise<
  | {
      ok: true;
      kind: "image";
      title: string;
      content: string;
      mime: string;
      model?: string;
    }
  | { ok: false; error: string }
> {
  const upstream = getImageUpstream();
  if (!upstream.configured) {
    return { ok: false, error: "Image generation is not configured." };
  }
  const provider = createOpenAI({
    baseURL: upstream.baseURL,
    apiKey: upstream.apiKey,
  });
  const model: ImageModel = provider.image(upstream.modelId);
  try {
    const result = await generateImage({
      model,
      prompt: input.prompt,
      size: SIZE_MAP[input.size ?? "square"],
    });
    const image = result.image;
    if (!image) {
      return { ok: false, error: "The image provider returned no image." };
    }
    const base64 =
      image.base64 ?? Buffer.from(image.uint8Array ?? []).toString("base64");
    if (!base64) {
      return { ok: false, error: "The image provider returned no image data." };
    }
    const mime = image.mediaType || "image/png";
    return {
      ok: true,
      kind: "image",
      title: input.prompt.slice(0, 60) || "Generated image",
      content: `data:${mime};base64,${base64}`,
      mime,
      model: upstream.modelId,
    };
  } catch {
    return { ok: false, error: "Image generation failed. Try again shortly." };
  }
}
