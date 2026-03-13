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
