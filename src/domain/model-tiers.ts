/**
 * Model tier system — single source of truth for adapter → tier → model resolution.
 *
 * Agent Shop templates reference semantic tiers (capable / balanced / fast)
 * instead of hardcoded model strings. At instantiation time, the actual model
 * is resolved based on the user's chosen adapter.
 */

/** The five supported adapter kinds. */
export type AdapterKind = 'claude' | 'opencode' | 'codex' | 'cursor' | 'shell';

/**
 * Semantic capability tiers — adapter-agnostic.
 *   capable  — most powerful / highest quality (opus, gpt-5.4)
 *   balanced — good quality + speed (sonnet, gpt-5.3-codex)
 *   fast     — cheapest / fastest (haiku, gpt-5-mini)
 */
export type ModelTier = 'capable' | 'balanced' | 'fast';

/**
 * Tier → model mapping per adapter.
 *
 * Conventions:
 *   - shell:    '' for all tiers (model irrelevant)
 *   - opencode: '' for balanced (delegate to opencode's own config)
 *   - cursor:   'auto' for all tiers (Cursor handles selection)
 */
export const MODEL_TIER_MAP: Record<AdapterKind, Record<ModelTier, string>> = {
  claude: {
    capable: 'claude-opus-4-6',
    balanced: 'claude-sonnet-4-6',
    fast: 'claude-haiku-4-6',
  },
  opencode: {
    capable: 'openrouter/anthropic/claude-opus-4.6',
    balanced: '',
    fast: 'openrouter/google/gemini-2.5-flash',
  },
  codex: {
    capable: 'gpt-5.4',
    balanced: 'gpt-5.3-codex',
    fast: 'gpt-5-mini',
  },
  cursor: {
    capable: 'auto',
    balanced: 'auto',
    fast: 'auto',
  },
  shell: {
    capable: '',
    balanced: '',
    fast: '',
  },
};

/**
 * Resolve a concrete model string from adapter + tier.
 * Returns '' for unknown adapters (let the adapter decide).
 */
export function resolveModel(adapter: string, tier: ModelTier): string {
  const adapterMap = MODEL_TIER_MAP[adapter as AdapterKind];
  if (!adapterMap) return '';
  return adapterMap[tier];
}

/** Returns the default (balanced) model for the adapter. */
export function defaultModelForAdapter(adapter: string): string {
  return resolveModel(adapter, 'balanced');
}

/** Type guard: is a string a valid AdapterKind? */
export function isAdapterKind(value: string): value is AdapterKind {
  return value in MODEL_TIER_MAP;
}

/** Type guard: is a string a valid ModelTier? */
export function isModelTier(value: string): value is ModelTier {
  return value === 'capable' || value === 'balanced' || value === 'fast';
}

/** All supported adapter names in display order. */
export const SUPPORTED_ADAPTERS: readonly AdapterKind[] = ['claude', 'opencode', 'codex', 'cursor', 'shell'];
