import { describe, it, expect } from 'vitest';
import { createTokenUsage } from '../../../src/domain/run.js';
import { extractTokens } from '../../../src/infrastructure/adapters/utils.js';

describe('createTokenUsage', () => {
  it('returns correct input and output', () => {
    const result = createTokenUsage(100, 200);
    expect(result.input).toBe(100);
    expect(result.output).toBe(200);
  });

  it('computes total as input + output', () => {
    const result = createTokenUsage(100, 200);
    expect(result.total).toBe(300);
  });

  it('total is not independent from input+output (zero case)', () => {
    const result = createTokenUsage(0, 0);
    expect(result.total).toBe(0);
  });

  it('total is not accumulated — always equals input+output', () => {
    const a = createTokenUsage(500, 300);
    expect(a.total).toBe(800);
    const b = createTokenUsage(1, 1);
    expect(b.total).toBe(2);
    // total is always recomputed, not accumulated from prior calls
    expect(a.total).toBe(800);
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
});
