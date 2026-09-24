/** Must match `AETHER_EXPERT_MODEL_FQN` in the server seed. */
export const AETHER_EXPERT_MODEL_FQN = 'buzz/gpt-5-6-luna';

export function preferAetherExpertModel<T extends { name: string }>(models: T[]): T | undefined {
  return models.find(model => model.name === AETHER_EXPERT_MODEL_FQN) ?? models[0];
}
