import { describe, it, expect } from 'vitest';
import {
  resolveModel,
  defaultModelForAdapter,
  isAdapterKind,
  isModelTier,
  MODEL_TIER_MAP,
  SUPPORTED_ADAPTERS,
} from '../../../src/domain/model-tiers.js';

describe('resolveModel', () => {
  it('claude capable → opus', () => {
    expect(resolveModel('claude', 'capable')).toBe('claude-opus-4-6');
  });

  it('claude balanced → sonnet', () => {
    expect(resolveModel('claude', 'balanced')).toBe('claude-sonnet-4-6');
  });

  it('claude fast → haiku', () => {
    expect(resolveModel('claude', 'fast')).toBe('claude-haiku-4-6');
  });

  it('opencode balanced → empty (delegate to opencode)', () => {
    expect(resolveModel('opencode', 'balanced')).toBe('');
  });

  it('opencode capable → specific model', () => {
    expect(resolveModel('opencode', 'capable')).toBeTruthy();
  });

  it('codex capable → gpt-5.4', () => {
    expect(resolveModel('codex', 'capable')).toBe('gpt-5.4');
  });

  it('codex balanced → gpt-5.3-codex', () => {
    expect(resolveModel('codex', 'balanced')).toBe('gpt-5.3-codex');
  });

  it('pi balanced → openai-codex/gpt-5.5', () => {
    expect(resolveModel('pi', 'balanced')).toBe('openai-codex/gpt-5.5');
  });

  it('shell returns empty string for all tiers', () => {
    expect(resolveModel('shell', 'capable')).toBe('');
    expect(resolveModel('shell', 'balanced')).toBe('');
    expect(resolveModel('shell', 'fast')).toBe('');
  });

  it('cursor returns auto for all tiers', () => {
    expect(resolveModel('cursor', 'capable')).toBe('auto');
    expect(resolveModel('cursor', 'balanced')).toBe('auto');
    expect(resolveModel('cursor', 'fast')).toBe('auto');
  });

  it('unknown adapter returns empty string', () => {
    expect(resolveModel('unknown-adapter', 'balanced')).toBe('');
    expect(resolveModel('unknown-adapter', 'capable')).toBe('');
  });
});

describe('defaultModelForAdapter', () => {
  it('returns balanced tier model', () => {
    expect(defaultModelForAdapter('claude')).toBe('claude-sonnet-4-6');
    expect(defaultModelForAdapter('codex')).toBe('gpt-5.3-codex');
    expect(defaultModelForAdapter('pi')).toBe('openai-codex/gpt-5.5');
    expect(defaultModelForAdapter('shell')).toBe('');
  });
});

describe('MODEL_TIER_MAP completeness', () => {
  const tiers = ['capable', 'balanced', 'fast'] as const;

  for (const adapter of SUPPORTED_ADAPTERS) {
    for (const tier of tiers) {
      it(`${adapter}/${tier} is a string`, () => {
        expect(typeof MODEL_TIER_MAP[adapter][tier]).toBe('string');
      });
    }
  }
});

describe('isAdapterKind', () => {
  it('returns true for known adapters', () => {
    expect(isAdapterKind('claude')).toBe(true);
    expect(isAdapterKind('opencode')).toBe(true);
    expect(isAdapterKind('codex')).toBe(true);
    expect(isAdapterKind('cursor')).toBe(true);
    expect(isAdapterKind('pi')).toBe(true);
    expect(isAdapterKind('shell')).toBe(true);
  });

  it('returns false for unknown adapters', () => {
    expect(isAdapterKind('unknown')).toBe(false);
    expect(isAdapterKind('')).toBe(false);
  });
});

describe('isModelTier', () => {
  it('returns true for valid tiers', () => {
    expect(isModelTier('capable')).toBe(true);
    expect(isModelTier('balanced')).toBe(true);
    expect(isModelTier('fast')).toBe(true);
  });

  it('returns false for invalid tiers', () => {
    expect(isModelTier('unknown')).toBe(false);
    expect(isModelTier('')).toBe(false);
  });
});

describe('SUPPORTED_ADAPTERS', () => {
  it('has 6 entries', () => {
    expect(SUPPORTED_ADAPTERS).toHaveLength(6);
  });

  it('matches MODEL_TIER_MAP keys', () => {
    for (const adapter of SUPPORTED_ADAPTERS) {
      expect(MODEL_TIER_MAP[adapter]).toBeDefined();
    }
  });
});
