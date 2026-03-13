/**
 * Scope overlap detection — pure functions, no side effects.
 *
 * A scope is an array of glob patterns (e.g. ['src/auth/**']).
 * Two tasks overlap if any pattern pair shares a common path prefix.
 */

import { dirname } from 'node:path';

/**
 * Returns true if two scope arrays have at least one overlapping pattern pair.
 * Tasks with no scope never overlap (they are unconstrained by convention).
 */
export function scopesOverlap(a: string[] | undefined, b: string[] | undefined): boolean {
  if (!a?.length || !b?.length) return false;

  for (const pa of a) {
    for (const pb of b) {
      if (patternsOverlap(pa, pb)) return true;
    }
  }
  return false;
}

/**
 * Pre-computed pattern info for O(1) base/dir lookups during overlap checks.
 */
interface PatternInfo {
  raw: string;
  base: string;
  isFile: boolean;
  dir: string;
}

function computePatternInfo(pattern: string): PatternInfo {
  const base = pattern.split('*')[0]!;
  const isFile = !base.endsWith('/');
  const dir = isFile ? dirname(base) : '';
  return { raw: pattern, base, isFile, dir };
}

/**
 * Pre-computed scope index for batch overlap checking.
 * Computes base prefixes and dirnames once, then checks overlap in O(1) per pair.
 */
export class ScopeIndex {
  private readonly entries: PatternInfo[];

  constructor(scopes: Array<string[] | undefined>) {
    this.entries = [];
    for (const scope of scopes) {
      if (scope?.length) {
        for (const p of scope) {
          this.entries.push(computePatternInfo(p));
        }
      }
    }
  }

  /** Returns true if the given scope overlaps with any pattern in the index. */
  overlapsAny(scope: string[] | undefined): boolean {
    if (!scope?.length || this.entries.length === 0) return false;
    for (const raw of scope) {
      const info = computePatternInfo(raw);
      for (const entry of this.entries) {
        if (patternsOverlapInfo(info, entry)) return true;
      }
    }
    return false;
  }

  /** Add patterns to the index (e.g. from an approved candidate). */
  add(scope: string[] | undefined): void {
    if (!scope?.length) return;
    for (const p of scope) {
      this.entries.push(computePatternInfo(p));
    }
  }

  get size(): number {
    return this.entries.length;
  }
}

/** Check overlap using pre-computed PatternInfo (no re-splitting). */
function patternsOverlapInfo(a: PatternInfo, b: PatternInfo): boolean {
  if (a.raw === b.raw) return true;
  if (a.base.startsWith(b.base) || b.base.startsWith(a.base)) return true;
  if (a.isFile && b.isFile) {
    return a.dir === b.dir && a.dir !== '.';
  }
  return false;
}

/**
 * Check if two glob patterns overlap by comparing their base prefixes.
 * Conservative: may produce false positives, but never false negatives.
 */
function patternsOverlap(a: string, b: string): boolean {
  if (a === b) return true;

  const aBase = a.split('*')[0]!;
  const bBase = b.split('*')[0]!;

  if (aBase.startsWith(bBase) || bBase.startsWith(aBase)) return true;

  // Sibling files in the same directory overlap (e.g. src/auth/login.ts & src/auth/logout.ts)
  // Only compare dirname when both bases are file-like (not ending with /)
  if (!aBase.endsWith('/') && !bBase.endsWith('/')) {
    const aDir = dirname(aBase);
    const bDir = dirname(bBase);
    return aDir === bDir && aDir !== '.';
  }

  return false;
}
