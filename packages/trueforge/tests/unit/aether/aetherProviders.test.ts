import {
  AETHER_EXPERT_MODEL_FQN,
  DEFAULT_BUZZ_BASE_URL,
  aetherProviderManifests,
  normalizeBuzzBaseUrl,
  preferAetherExpertModel,
} from '../../../src/aether/aetherProviders';

describe('aether providers', () => {
  it('appends /v1 when the Buzz dashboard host is copied without it', () => {
    expect(normalizeBuzzBaseUrl('https://api.buzzai.cc')).toBe(DEFAULT_BUZZ_BASE_URL);
    expect(normalizeBuzzBaseUrl('')).toBe(DEFAULT_BUZZ_BASE_URL);
    expect(normalizeBuzzBaseUrl('https://api.buzzai.cc/v1/')).toBe(DEFAULT_BUZZ_BASE_URL);
  });

  it('seeds Buzz Luna first and OpenRouter second when both keys are set', () => {
    const manifests = aetherProviderManifests({
      AETHER_HOSTED_BUZZ_API_KEY: 'buzz-secret',
      OPENROUTER_API_KEY: 'or-secret',
    });
    expect(manifests.map(manifest => manifest.name)).toEqual(['buzz', 'openrouter']);
    expect(manifests[0]?.models[0]?.model_id).toBe('gpt-5.6-luna');
    expect(manifests[0]?.base_url).toBe(DEFAULT_BUZZ_BASE_URL);
    expect(manifests[1]?.models[0]?.model_id).toBe('openai/gpt-5.6-luna');
    expect(manifests[1]?.base_url).toBe('https://openrouter.ai/api/v1');
    expect(manifests[0]?.auth.api_key).toBe('buzz-secret');
  });

  it('skips a provider whose key is absent', () => {
    expect(aetherProviderManifests({ OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1' })).toEqual([]);
  });

  it('prefers the Buzz Luna FQN over catalog order', () => {
    const picked = preferAetherExpertModel([
      { name: 'openrouter/gpt-5-6-sol' },
      { name: AETHER_EXPERT_MODEL_FQN },
    ]);
    expect(picked?.name).toBe(AETHER_EXPERT_MODEL_FQN);
  });
});
