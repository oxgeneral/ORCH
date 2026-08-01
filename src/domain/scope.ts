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
}

function computePatternInfo(pattern: string): PatternInfo {
  const wildcard = pattern.indexOf('*');
  const base = wildcard === -1 ? pattern : pattern.slice(0, wildcard);
  return { base, isFile: !base.endsWith('/') };
}

interface RadixTrieNode {
  /** The non-empty UTF-16 edge label from the parent to this node. */
  label: string;
  /** Sparse UTF-16 child table makes one-code-unit dispatch a numeric lookup. */
  readonly children: Array<RadixTrieNode | undefined>;
  hasChildren: boolean;
  /** Whether an indexed base ends exactly at this node. */
  terminal: boolean;
}

function newRadixTrieNode(label: string, terminal: boolean): RadixTrieNode {
  return {
    label,
    children: [],
    hasChildren: false,
    terminal,
  };
}

/**
 * Mutable compressed radix trie for string-prefix queries.
 *
 * Edge labels are compared as UTF-16 code units, just like startsWith(). A
 * split can therefore occur between the two code units of a surrogate pair;
 * keeping that behavior is important because the overlap contract is based on
 * JavaScript string prefixes, not Unicode code points.
 */
class PrefixTrie {
  private readonly root = newRadixTrieNode('', false);

  add(value: string): void {
    if (value.length === 0) {
      this.root.terminal = true;
      return;
    }

    let parent = this.root;
    let offset = 0;

    while (offset < value.length) {
      const key = value.charCodeAt(offset);
      const child = parent.children[key];
      if (child === undefined) {
        parent.children[key] = newRadixTrieNode(value.slice(offset), true);
        parent.hasChildren = true;
        return;
      }

      const label = child.label;
      const remaining = value.length - offset;
      const limit = Math.min(label.length, remaining);
      let commonLength = 0;
      while (
        commonLength < limit &&
        label.charCodeAt(commonLength) === value.charCodeAt(offset + commonLength)
      ) {
        commonLength++;
      }

      if (commonLength === label.length) {
        offset += commonLength;
        if (offset === value.length) {
          child.terminal = true;
          return;
        }
        parent = child;
        continue;
      }

      // The existing edge and the new value diverge inside this label. Keep
      // the common prefix as a branch node and retain both suffixes below it.
      const split = newRadixTrieNode(label.slice(0, commonLength), false);
      parent.children[key] = split;
      parent.hasChildren = true;

      child.label = label.slice(commonLength);
      split.children[child.label.charCodeAt(0)] = child;
      split.hasChildren = true;

      const newOffset = offset + commonLength;
      if (newOffset === value.length) {
        split.terminal = true;
      } else {
        const newChild = newRadixTrieNode(value.slice(newOffset), true);
        split.children[newChild.label.charCodeAt(0)] = newChild;
      }
      return;
    }
  }

  /** Returns whether any indexed base has a prefix relationship with value. */
  overlaps(value: string): boolean {
    let node = this.root;
    let offset = 0;

    // An empty indexed base is a prefix of every query. Conversely, every
    // non-empty indexed base has an empty query as its prefix.
    if (node.terminal || value.length === 0) return node.terminal || node.hasChildren;

    while (offset < value.length) {
      const child = node.children[value.charCodeAt(offset)];
      if (child === undefined) return false;

      const label = child.label;
      const remaining = value.length - offset;
      const limit = Math.min(label.length, remaining);
      let commonLength = 0;
      while (
        commonLength < limit &&
        label.charCodeAt(commonLength) === value.charCodeAt(offset + commonLength)
      ) {
        commonLength++;
      }

      // If the query ends in the middle of an edge, the query is a prefix of
      // the indexed base represented by that edge.
      if (commonLength === remaining) return true;
      if (commonLength !== label.length) return false;

      offset += commonLength;
      node = child;
      if (node.terminal) return true;
    }

    // The query ends at a trie node. It is either an indexed base itself or a
    // prefix of one of the node's descendants.
    return true;
  }
}

/**
 * Pre-computed scope index for batch overlap checking.
 *
 * A pattern pair overlaps when either base is a string prefix of the other, or
 * when both are file-like patterns in the same non-root directory. The trie
 * stores each unique character prefix once, and is intentionally mutable so
 * add() keeps the same query cost for dynamic workloads.
 */
export class ScopeIndex {
  private readonly baseTrie = new PrefixTrie();
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
      if (this.baseTrie.overlaps(info.base)) return true;
      if (info.isFile && this.hasSiblingDirectory(info.base)) return true;
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
    this.baseTrie.add(info.base);
    if (info.isFile) {
      const dir = dirname(info.base);
      if (dir !== '.') this.fileDirs.add(dir);
    }
  }

  /** Compute dirname only after prefix checks miss, since most patterns are globs. */
  private hasSiblingDirectory(base: string): boolean {
    const dir = dirname(base);
    return dir !== '.' && this.fileDirs.has(dir);
  }
}

/**
 * Check if two glob patterns overlap by comparing their base prefixes.
 * Conservative: may produce false positives, but never false negatives.
 */
function patternsOverlap(a: string, b: string): boolean {
  if (a === b) return true;

  const aWildcard = a.indexOf('*');
  const bWildcard = b.indexOf('*');
  const aBase = aWildcard === -1 ? a : a.slice(0, aWildcard);
  const bBase = bWildcard === -1 ? b : b.slice(0, bWildcard);

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
