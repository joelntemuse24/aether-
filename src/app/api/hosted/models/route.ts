import { listBuzzChatModels } from "@/lib/buzz/models";
import {
  HOSTED_DEFAULT_MODEL_ID,
  buzzModelsEnabled,
  hostedDefaultPickerModel,
} from "@/lib/hosted/default-model";

/** Hosted picker rows. Buzz rows appear only when AETHER_BUZZ_MODELS_ENABLED is on. */
export async function GET() {
  const models = buzzModelsEnabled()
    ? [hostedDefaultPickerModel(), ...(await listBuzzChatModels())]
    : [hostedDefaultPickerModel()];
  return Response.json({
    defaultModel: HOSTED_DEFAULT_MODEL_ID,
    models,
  });
}
