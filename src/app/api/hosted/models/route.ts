import { DEFAULT_BUZZ_MODEL, listBuzzChatModels } from "@/lib/buzz/models";

export async function GET() {
  const models = await listBuzzChatModels();
  return Response.json({
    defaultModel: DEFAULT_BUZZ_MODEL,
    models,
  });
}
