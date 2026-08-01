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

/** Pre-computed pattern info used while adding patterns to a ScopeIndex. */
interface PatternInfo {
  base: string;
  isFile: boolean;
  dir: string;
}

function computePatternInfo(pattern: string): PatternInfo {
  const base = pattern.split('*')[0]!;
  const isFile = !base.endsWith('/');
  const dir = isFile ? dirname(base) : '';
  return { base, isFile, dir };
}

/**
 * Pre-computed scope index for batch overlap checking.
 *
 * A pattern pair overlaps when either base is a string prefix of the other, or
 * when both are file-like patterns in the same non-root directory. Store all
 * base prefixes so each of those checks can be answered without scanning the
 * indexed patterns. The sets are intentionally mutable: add() updates them in
 * place and therefore keeps the same query cost for dynamic workloads.
 */
export class ScopeIndex {
  /** Every complete base currently in the index. */
  private readonly bases = new Set<string>();
  /** Every prefix of every indexed base, including each complete base. */
  private readonly basePrefixes = new Set<string>();
  /** Directories containing indexed file-like patterns, excluding '.'. */
  private readonly fileDirs = new Set<string>();
  private patternCount = 0;

  constructor(scopes: Array<string[] | undefined>) {
    for (const scope of scopes) {
      if (scope?.length) {
        for (const p of scope) {
          this.addPattern(computePatternInfo(p));
        }
      }
    }
  }

  /** Returns true if the given scope overlaps with any pattern in the index. */
  overlapsAny(scope: string[] | undefined): boolean {
    if (!scope?.length || this.patternCount === 0) return false;
    for (const raw of scope) {
      const info = computePatternInfo(raw);
      if (this.baseOverlaps(info.base)) return true;
      if (info.isFile && info.dir !== '.' && this.fileDirs.has(info.dir)) return true;
    }
    return false;
  }

  /** Add patterns to the index (e.g. from an approved candidate). */
  add(scope: string[] | undefined): void {
    if (!scope?.length) return;
    for (const p of scope) {
      this.addPattern(computePatternInfo(p));
    }
  }

  get size(): number {
    return this.patternCount;
  }

  private addPattern(info: PatternInfo): void {
    this.patternCount++;
    this.bases.add(info.base);
    for (let end = 0; end <= info.base.length; end++) {
      this.basePrefixes.add(info.base.slice(0, end));
    }
    if (info.isFile && info.dir !== '.') {
      this.fileDirs.add(info.dir);
    }
  }

  /**
   * Check whether a query base has a prefix relation with any indexed base.
   *
   * basePrefixes.has(base) catches indexed bases below the query. Walking the
   * query's own prefixes and checking bases catches indexed bases above it.
   */
  private baseOverlaps(base: string): boolean {
    if (this.basePrefixes.has(base)) return true;
    for (let end = 0; end <= base.length; end++) {
      if (this.bases.has(base.slice(0, end))) return true;
    }
    return false;
  }
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
