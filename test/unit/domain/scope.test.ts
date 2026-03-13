import { describe, it, expect } from 'vitest';
import { scopesOverlap } from '../../../src/domain/scope.js';

describe('scopesOverlap', () => {
  it('returns false when either scope is empty or undefined', () => {
    expect(scopesOverlap(undefined, ['src/**'])).toBe(false);
    expect(scopesOverlap(['src/**'], undefined)).toBe(false);
    expect(scopesOverlap([], ['src/**'])).toBe(false);
    expect(scopesOverlap(['src/**'], [])).toBe(false);
  });

  it('returns true for identical patterns', () => {
    expect(scopesOverlap(['src/auth/**'], ['src/auth/**'])).toBe(true);
  });

  it('returns true when one prefix contains the other', () => {
    expect(scopesOverlap(['src/**'], ['src/auth/**'])).toBe(true);
    expect(scopesOverlap(['src/auth/**'], ['src/**'])).toBe(true);
  });

  it('returns true for sibling files in same directory', () => {
    expect(scopesOverlap(['src/auth/login.ts'], ['src/auth/logout.ts'])).toBe(true);
  });

  it('returns true for sibling glob and file in same directory', () => {
    expect(scopesOverlap(['src/auth/*.ts'], ['src/auth/logout.ts'])).toBe(true);
  });

  it('returns false for files in different directories', () => {
    expect(scopesOverlap(['src/auth/login.ts'], ['src/db/pool.ts'])).toBe(false);
  });

  it('returns false for disjoint subtrees', () => {
    expect(scopesOverlap(['src/auth/**'], ['src/db/**'])).toBe(false);
  });

  it('returns true when any pair overlaps across arrays', () => {
    expect(scopesOverlap(['src/db/**', 'src/auth/**'], ['src/auth/login.ts'])).toBe(true);
  });
});
