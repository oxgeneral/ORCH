import { describe, it, expect } from 'vitest';
import { createTokenUsage } from '../../../src/domain/run.js';
import { extractTokens } from '../../../src/infrastructure/adapters/utils.js';

describe('createTokenUsage', () => {
  it('returns correct input and output', () => {
    const result = createTokenUsage(100, 200);
    expect(result.input).toBe(100);
    expect(result.output).toBe(200);
  });

  it('computes total as input + output (no reasoning)', () => {
    const result = createTokenUsage(100, 200);
    expect(result.total).toBe(300);
    expect(result.reasoning).toBe(0);
  });

  it('includes reasoning in total', () => {
    const result = createTokenUsage(100, 200, { reasoning: 50 });
    expect(result.reasoning).toBe(50);
    expect(result.total).toBe(350); // 100 + 200 + 50
  });

  it('tracks cache tokens without adding to total', () => {
    const result = createTokenUsage(100, 200, { cache_read: 80, cache_write: 20 });
    expect(result.cache_read).toBe(80);
    expect(result.cache_write).toBe(20);
    expect(result.total).toBe(300); // cache NOT in total
  });

  it('total is not independent from input+output+reasoning (zero case)', () => {
    const result = createTokenUsage(0, 0);
    expect(result.total).toBe(0);
    expect(result.reasoning).toBe(0);
    expect(result.cache_read).toBe(0);
    expect(result.cache_write).toBe(0);
  });

  it('total is not accumulated — always equals input+output+reasoning', () => {
    const a = createTokenUsage(500, 300, { reasoning: 100 });
    expect(a.total).toBe(900);
    const b = createTokenUsage(1, 1);
    expect(b.total).toBe(2);
    // total is always recomputed, not accumulated from prior calls
    expect(a.total).toBe(900);
  });

  it('defaults all optional fields to 0', () => {
    const result = createTokenUsage(10, 20);
    expect(result.reasoning).toBe(0);
    expect(result.cache_read).toBe(0);
    expect(result.cache_write).toBe(0);
    expect(result.total).toBe(30);
  });
});

describe('extractTokens — uses createTokenUsage', () => {
  it('returns TokenUsage with total = input + output for usage field', () => {
    const parsed = { usage: { input_tokens: 150, output_tokens: 50 } };
    const result = extractTokens(parsed);
    expect(result).toBeDefined();
    expect(result!.input).toBe(150);
    expect(result!.output).toBe(50);
    expect(result!.total).toBe(200);
    expect(result!.reasoning).toBe(0);
  });

  it('returns undefined when no usage field', () => {
    expect(extractTokens({})).toBeUndefined();
  });

  it('defaults output to 0 when output_tokens missing', () => {
    const parsed = { usage: { input_tokens: 100 } };
    const result = extractTokens(parsed);
    expect(result!.input).toBe(100);
    expect(result!.output).toBe(0);
    expect(result!.total).toBe(100);
  });

  it('uses statsFallback for claude-style stats.usage', () => {
    const parsed = { stats: { usage: { input_tokens: 80, output_tokens: 20 } } };
    const result = extractTokens(parsed, { statsFallback: true });
    expect(result!.input).toBe(80);
    expect(result!.output).toBe(20);
    expect(result!.total).toBe(100);
  });

  it('ignores stats.usage when statsFallback is false', () => {
    const parsed = { stats: { usage: { input_tokens: 80, output_tokens: 20 } } };
    expect(extractTokens(parsed)).toBeUndefined();
  });

  it('parses reasoning_tokens from usage', () => {
    const parsed = { usage: { input_tokens: 100, output_tokens: 50, reasoning_tokens: 200 } };
    const result = extractTokens(parsed);
    expect(result!.reasoning).toBe(200);
    expect(result!.total).toBe(350); // 100 + 50 + 200
  });

  it('parses cache tokens from usage', () => {
    const parsed = {
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 80,
        cache_creation_input_tokens: 20,
      },
    };
    const result = extractTokens(parsed);
    expect(result!.cache_read).toBe(80);
    expect(result!.cache_write).toBe(20);
    expect(result!.total).toBe(150); // cache NOT in total
  });

  it('parses all extended fields together', () => {
    const parsed = {
      usage: {
        input_tokens: 1000,
        output_tokens: 500,
        reasoning_tokens: 300,
        cache_read_input_tokens: 800,
        cache_creation_input_tokens: 200,
      },
    };
    const result = extractTokens(parsed);
    expect(result!.input).toBe(1000);
    expect(result!.output).toBe(500);
    expect(result!.reasoning).toBe(300);
    expect(result!.cache_read).toBe(800);
    expect(result!.cache_write).toBe(200);
    expect(result!.total).toBe(1800); // 1000 + 500 + 300
  });
});
