/**
 * Immutable text cursor with grapheme-aware navigation.
 *
 * Uses Intl.Segmenter (Node 20+) for correct handling of:
 * - CJK characters, emoji, combining marks
 * - IME input (Korean, Japanese, Chinese compose sequences)
 * - NFC normalization for consistent cursor positioning
 *
 * Every mutation returns a new Cursor — never mutates in place.
 */

// Module-level singleton — created once per process
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
/** Split a string into grapheme clusters. */
export function graphemeSegments(text: string): string[] {
  return [...segmenter.segment(text)].map((s) => s.segment);
}

/** Count grapheme clusters in a string. */
export function graphemeLength(text: string): number {
  let count = 0;
  for (const _ of segmenter.segment(text)) count++;
  return count;
}

/**
 * Terminal display width of a single grapheme.
 * CJK ideographs, fullwidth forms, and emoji → 2 columns.
 * Everything else → 1 column.
 */
export function displayWidth(grapheme: string): number {
  const cp = grapheme.codePointAt(0) ?? 0;
  // CJK Unified Ideographs + Extensions
  if (cp >= 0x2E80 && cp <= 0x9FFF) return 2;
  // Hangul Jamo
  if (cp >= 0x1100 && cp <= 0x115F) return 2;
  // Hangul Jamo Extended-A
  if (cp >= 0xA960 && cp <= 0xA97F) return 2;
  // Hangul Syllables
  if (cp >= 0xAC00 && cp <= 0xD7AF) return 2;
  // CJK Compatibility Ideographs
  if (cp >= 0xF900 && cp <= 0xFAFF) return 2;
  // CJK Compatibility Forms + Small Form Variants
  if (cp >= 0xFE10 && cp <= 0xFE6F) return 2;
  // Fullwidth forms
  if (cp >= 0xFF01 && cp <= 0xFF60) return 2;
  if (cp >= 0xFFE0 && cp <= 0xFFE6) return 2;
  // CJK Unified Ideographs Extension B+
  if (cp >= 0x20000 && cp <= 0x2FA1F) return 2;
  // Emoji (Miscellaneous Symbols and Pictographs through Supplemental Symbols)
  if (cp >= 0x1F300 && cp <= 0x1FAFF) return 2;
  // Emoji Modifier Fitzpatrick
  if (cp >= 0x1F3FB && cp <= 0x1F3FF) return 2;

  return 1;
}

/** Total terminal display width of a string. */
export function textDisplayWidth(text: string): number {
  let w = 0;
  for (const seg of segmenter.segment(text)) {
    w += displayWidth(seg.segment);
  }
  return w;
}

/** Find word boundary backward from grapheme position. */
function wordBoundaryBack(segs: string[], pos: number): number {
  if (pos <= 0) return 0;
  let i = pos - 1;
  // Skip whitespace
  while (i > 0 && segs[i - 1] === ' ') i--;
  // Skip word
  while (i > 0 && segs[i - 1] !== ' ') i--;
  return i;
}

/** Find word boundary forward from grapheme position. */
function wordBoundaryForward(segs: string[], pos: number): number {
  const len = segs.length;
  if (pos >= len) return len;
  let i = pos;
  // Skip word
  while (i < len && segs[i] !== ' ') i++;
  // Skip whitespace
  while (i < len && segs[i] === ' ') i++;
  return i;
}

/**
 * Immutable cursor over a text string.
 *
 * `pos` is measured in grapheme clusters, not bytes or code units.
 * Text is always NFC-normalized.
 */
export class Cursor {
  readonly text: string;
  readonly pos: number;
  private readonly _segs: string[];

  constructor(text: string, pos?: number) {
    this.text = text.normalize('NFC');
    this._segs = graphemeSegments(this.text);
    this.pos = pos !== undefined
      ? Math.max(0, Math.min(pos, this._segs.length))
      : this._segs.length;
  }

  private segs(): string[] {
    return this._segs;
  }

  /** Number of grapheme clusters. */
  get length(): number {
    return this._segs.length;
  }

  /** Grapheme segments before cursor (avoids re-segmentation in render). */
  get beforeSegs(): string[] {
    return this._segs.slice(0, this.pos);
  }

  /** Grapheme segments after cursor (avoids re-segmentation in render). */
  get afterSegs(): string[] {
    return this._segs.slice(this.pos);
  }

  /** Text before the cursor. */
  get before(): string {
    return this.beforeSegs.join('');
  }

  /** Text after the cursor. */
  get after(): string {
    return this.afterSegs.join('');
  }

  /** Whether the text is empty. */
  get isEmpty(): boolean {
    return this.text.length === 0;
  }

  // ── Navigation ────────────────────────────────────────

  moveLeft(count = 1): Cursor {
    return new Cursor(this.text, this.pos - count);
  }

  moveRight(count = 1): Cursor {
    return new Cursor(this.text, this.pos + count);
  }

  moveToStart(): Cursor {
    return new Cursor(this.text, 0);
  }

  moveToEnd(): Cursor {
    return new Cursor(this.text, this.segs().length);
  }

  moveToWordBack(): Cursor {
    return new Cursor(this.text, wordBoundaryBack(this.segs(), this.pos));
  }

  moveToWordForward(): Cursor {
    return new Cursor(this.text, wordBoundaryForward(this.segs(), this.pos));
  }

  // ── Editing ───────────────────────────────────────────

  /** Insert text at cursor position. */
  insert(chars: string): Cursor {
    const normalized = chars.normalize('NFC');
    const insertedLen = graphemeLength(normalized);
    const s = this.segs();
    const newText = s.slice(0, this.pos).join('') + normalized + s.slice(this.pos).join('');
    return new Cursor(newText, this.pos + insertedLen);
  }

  /** Delete one grapheme before cursor (Backspace). */
  deleteBack(): Cursor {
    if (this.pos <= 0) return this;
    const s = this.segs();
    const newText = s.slice(0, this.pos - 1).join('') + s.slice(this.pos).join('');
    return new Cursor(newText, this.pos - 1);
  }

  /** Delete one grapheme after cursor (Delete key). */
  deleteForward(): Cursor {
    const s = this.segs();
    if (this.pos >= s.length) return this;
    const newText = s.slice(0, this.pos).join('') + s.slice(this.pos + 1).join('');
    return new Cursor(newText, this.pos);
  }

  /** Delete from cursor to end of line (Ctrl+K). Returns [newCursor, killedText]. */
  killToEnd(): [Cursor, string] {
    const s = this.segs();
    const killed = s.slice(this.pos).join('');
    const newText = s.slice(0, this.pos).join('');
    return [new Cursor(newText, this.pos), killed];
  }

  /** Delete from cursor to start of line (Ctrl+U). Returns [newCursor, killedText]. */
  killToStart(): [Cursor, string] {
    const s = this.segs();
    const killed = s.slice(0, this.pos).join('');
    const newText = s.slice(this.pos).join('');
    return [new Cursor(newText, 0), killed];
  }

  /** Delete word before cursor (Ctrl+W). Returns [newCursor, killedText]. */
  killWordBack(): [Cursor, string] {
    const s = this.segs();
    const newPos = wordBoundaryBack(s, this.pos);
    const killed = s.slice(newPos, this.pos).join('');
    const newText = s.slice(0, newPos).join('') + s.slice(this.pos).join('');
    return [new Cursor(newText, newPos), killed];
  }

  /** Replace all text, cursor at end. */
  replaceAll(newText: string): Cursor {
    return new Cursor(newText);
  }

  /** Clear all text. */
  clear(): Cursor {
    return new Cursor('');
  }

  // ── Display helpers ───────────────────────────────────

  /** Display width of text before cursor (in terminal columns). */
  get displayWidthBefore(): number {
    return textDisplayWidth(this.before);
  }

  /** Display width of text after cursor (in terminal columns). */
  get displayWidthAfter(): number {
    return textDisplayWidth(this.after);
  }

  /** Total display width (in terminal columns). */
  get totalDisplayWidth(): number {
    return textDisplayWidth(this.text);
  }
}
