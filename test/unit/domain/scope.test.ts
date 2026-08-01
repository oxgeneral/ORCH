import { describe, it, expect } from 'vitest';
import { scopesOverlap, ScopeIndex } from '../../../src/domain/scope.js';

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

describe('ScopeIndex', () => {
  it('overlapsAny returns false on empty index', () => {
    const idx = new ScopeIndex([]);
    expect(idx.overlapsAny(['src/auth/**'])).toBe(false);
  });

  it('overlapsAny returns false when scope is undefined', () => {
    const idx = new ScopeIndex([['src/auth/**']]);
    expect(idx.overlapsAny(undefined)).toBe(false);
  });

  it('overlapsAny returns false when scope is empty array', () => {
    const idx = new ScopeIndex([['src/auth/**']]);
    expect(idx.overlapsAny([])).toBe(false);
  });

  it('overlapsAny detects prefix overlap', () => {
    const idx = new ScopeIndex([['src/auth/**']]);
    expect(idx.overlapsAny(['src/auth/login.ts'])).toBe(true);
  });

  it('overlapsAny detects identical pattern overlap', () => {
    const idx = new ScopeIndex([['src/db/**']]);
    expect(idx.overlapsAny(['src/db/**'])).toBe(true);
  });

  it('overlapsAny returns false for disjoint scopes', () => {
    const idx = new ScopeIndex([['src/auth/**']]);
    expect(idx.overlapsAny(['src/db/**'])).toBe(false);
  });

  it('overlapsAny detects sibling file overlap', () => {
    const idx = new ScopeIndex([['src/auth/login.ts']]);
    expect(idx.overlapsAny(['src/auth/logout.ts'])).toBe(true);
  });

  it('does not treat files in the root directory as siblings', () => {
    const idx = new ScopeIndex([['login.ts']]);
    expect(idx.overlapsAny(['logout.ts'])).toBe(false);
  });

  it('preserves string-prefix semantics without a path-boundary check', () => {
    const idx = new ScopeIndex([['src/auth']]);
    expect(idx.overlapsAny(['src/authorisation/**'])).toBe(true);
  });

  it('matches patterns with an empty base prefix', () => {
    const idx = new ScopeIndex([['*']]);
    expect(idx.overlapsAny(['services/api/**'])).toBe(true);
  });

  it('matches a parent added after a longer indexed base', () => {
    const idx = new ScopeIndex([]);
    idx.add(['src/auth/private/credentials/**']);
    expect(idx.overlapsAny(['src/auth/**'])).toBe(true);
  });

  it('matches a longer base added after its parent', () => {
    const idx = new ScopeIndex([]);
    idx.add(['src/auth/**']);
    idx.add(['src/auth/private/credentials/**']);
    expect(idx.overlapsAny(['src/auth/private/credentials/key.json'])).toBe(true);
  });

  it('keeps duplicate bases observable through size and overlap', () => {
    const idx = new ScopeIndex([['src/auth/**']]);
    idx.add(['src/auth/**']);
    expect(idx.size).toBe(2);
    expect(idx.overlapsAny(['src/auth/login.ts'])).toBe(true);
  });

  it('handles a radix split between surrogate pair code units', () => {
    const highSurrogate = '\ud83d';
    const lowSurrogate = '\ude00';
    const idx = new ScopeIndex([[`src/${highSurrogate}${lowSurrogate}/one/**`]]);

    expect(idx.overlapsAny([`src/${highSurrogate}x/two/**`])).toBe(false);
    idx.add([`src/${highSurrogate}x/three/**`]);
    expect(idx.overlapsAny([`src/${highSurrogate}x/three/file.ts`])).toBe(true);
  });

  it('updates the sibling directory index when patterns are added', () => {
    const idx = new ScopeIndex([]);
    expect(idx.overlapsAny(['src/auth/logout.ts'])).toBe(false);

    idx.add(['src/auth/login.ts']);
    expect(idx.overlapsAny(['src/auth/logout.ts'])).toBe(true);
    expect(idx.overlapsAny(['src/db/pool.ts'])).toBe(false);
  });

  it('constructor skips undefined and empty scopes', () => {
    const idx = new ScopeIndex([undefined, [], ['src/auth/**']]);
    expect(idx.size).toBe(1);
  });

  it('constructor collects all patterns from multiple scopes', () => {
    const idx = new ScopeIndex([['src/auth/**', 'src/db/**'], ['src/api/**']]);
    expect(idx.size).toBe(3);
  });

  it('add() makes later overlapsAny aware of new patterns', () => {
    const idx = new ScopeIndex([['src/auth/**']]);
    expect(idx.overlapsAny(['src/db/**'])).toBe(false);

    idx.add(['src/db/**']);
    expect(idx.overlapsAny(['src/db/pool.ts'])).toBe(true);
  });

  it('add() with undefined or empty is a no-op', () => {
    const idx = new ScopeIndex([]);
    idx.add(undefined);
    idx.add([]);
    expect(idx.size).toBe(0);
  });

  it('size reflects the total pattern count', () => {
    const idx = new ScopeIndex([['a/**', 'b/**']]);
    expect(idx.size).toBe(2);
    idx.add(['c/**']);
    expect(idx.size).toBe(3);
  });

  it('peer-candidate scenario: approved candidate blocks later overlap', () => {
    // Simulate dispatchAll: in-progress scopes in index, then add approved candidates
    const idx = new ScopeIndex([['src/auth/**']]);

    // Candidate A: src/db/** — no overlap, approve it
    expect(idx.overlapsAny(['src/db/**'])).toBe(false);
    idx.add(['src/db/**']);

    // Candidate B: src/db/pool.ts — overlaps with approved A
    expect(idx.overlapsAny(['src/db/pool.ts'])).toBe(true);

    // Candidate C: src/api/** — no overlap with anything
    expect(idx.overlapsAny(['src/api/**'])).toBe(false);
  });
});
