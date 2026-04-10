/**
 * Unit tests for the immutable Cursor class and grapheme utilities.
 *
 * Covers: NFC normalization, grapheme-aware positioning (CJK, emoji,
 * combining marks), word boundaries, kill operations, display width.
 */

import { describe, it, expect } from 'vitest';
import {
  Cursor,
  graphemeSegments,
  graphemeLength,
  displayWidth,
  textDisplayWidth,
} from '../../../src/tui/text-cursor.js';

/* ── graphemeSegments / graphemeLength ──────────────── */

describe('graphemeSegments', () => {
  it('splits ASCII into single characters', () => {
    expect(graphemeSegments('hello')).toEqual(['h', 'e', 'l', 'l', 'o']);
  });

  it('splits Cyrillic correctly', () => {
    expect(graphemeSegments('Привет')).toEqual(['П', 'р', 'и', 'в', 'е', 'т']);
  });

  it('keeps emoji as single grapheme', () => {
    const segs = graphemeSegments('👍');
    expect(segs).toHaveLength(1);
    expect(segs[0]).toBe('👍');
  });

  it('keeps compound emoji (flag) as single grapheme', () => {
    const segs = graphemeSegments('🇺🇸');
    expect(segs).toHaveLength(1);
  });

  it('keeps emoji with skin tone modifier as single grapheme', () => {
    const segs = graphemeSegments('👋🏽');
    expect(segs).toHaveLength(1);
  });

  it('splits CJK ideographs correctly', () => {
    expect(graphemeSegments('你好')).toEqual(['你', '好']);
  });

  it('splits Korean syllables correctly', () => {
    expect(graphemeSegments('안녕')).toEqual(['안', '녕']);
  });

  it('returns empty array for empty string', () => {
    expect(graphemeSegments('')).toEqual([]);
  });
});

describe('graphemeLength', () => {
  it('counts ASCII characters', () => {
    expect(graphemeLength('hello')).toBe(5);
  });

  it('counts emoji as 1', () => {
    expect(graphemeLength('👍')).toBe(1);
  });

  it('counts compound emoji as 1', () => {
    expect(graphemeLength('👨‍👩‍👧')).toBe(1);
  });

  it('counts mixed ASCII + emoji correctly', () => {
    expect(graphemeLength('hi 👋')).toBe(4);
  });
});

/* ── displayWidth ──────────────────────────────────── */

describe('displayWidth', () => {
  it('returns 1 for ASCII', () => {
    expect(displayWidth('A')).toBe(1);
    expect(displayWidth(' ')).toBe(1);
  });

  it('returns 1 for Cyrillic', () => {
    expect(displayWidth('Я')).toBe(1);
  });

  it('returns 2 for CJK ideograph', () => {
    expect(displayWidth('你')).toBe(2);
  });

  it('returns 2 for Hangul syllable', () => {
    expect(displayWidth('한')).toBe(2);
  });

  it('returns 2 for fullwidth form', () => {
    expect(displayWidth('Ａ')).toBe(2); // U+FF21
  });

  it('returns 2 for emoji', () => {
    expect(displayWidth('😀')).toBe(2);
  });
});

describe('textDisplayWidth', () => {
  it('sums widths correctly for mixed content', () => {
    // 'hi' = 2, '你' = 2, '!' = 1 → total 5
    expect(textDisplayWidth('hi你!')).toBe(5);
  });

  it('returns 0 for empty string', () => {
    expect(textDisplayWidth('')).toBe(0);
  });
});

/* ── Cursor: construction & NFC ────────────────────── */

describe('Cursor construction', () => {
  it('creates with text and cursor at end', () => {
    const c = new Cursor('hello');
    expect(c.text).toBe('hello');
    expect(c.pos).toBe(5);
    expect(c.length).toBe(5);
  });

  it('creates with explicit position', () => {
    const c = new Cursor('hello', 2);
    expect(c.pos).toBe(2);
    expect(c.before).toBe('he');
    expect(c.after).toBe('llo');
  });

  it('clamps position to valid range', () => {
    expect(new Cursor('abc', -5).pos).toBe(0);
    expect(new Cursor('abc', 100).pos).toBe(3);
  });

  it('NFC-normalizes text on construction', () => {
    // é as e + combining accent (NFD) → single é (NFC)
    const nfd = 'e\u0301'; // NFD: e + combining acute
    const c = new Cursor(nfd);
    expect(c.text).toBe('\u00e9'); // NFC: é
    expect(c.length).toBe(1);
  });

  it('handles empty string', () => {
    const c = new Cursor('');
    expect(c.text).toBe('');
    expect(c.pos).toBe(0);
    expect(c.length).toBe(0);
    expect(c.isEmpty).toBe(true);
  });
});

/* ── Cursor: navigation ────────────────────────────── */

describe('Cursor navigation', () => {
  it('moveLeft decrements position', () => {
    const c = new Cursor('hello', 3).moveLeft();
    expect(c.pos).toBe(2);
  });

  it('moveLeft clamps at 0', () => {
    const c = new Cursor('hello', 0).moveLeft();
    expect(c.pos).toBe(0);
  });

  it('moveRight increments position', () => {
    const c = new Cursor('hello', 2).moveRight();
    expect(c.pos).toBe(3);
  });

  it('moveRight clamps at end', () => {
    const c = new Cursor('hello').moveRight();
    expect(c.pos).toBe(5);
  });

  it('moveToStart sets position to 0', () => {
    const c = new Cursor('hello', 3).moveToStart();
    expect(c.pos).toBe(0);
  });

  it('moveToEnd sets position to length', () => {
    const c = new Cursor('hello', 0).moveToEnd();
    expect(c.pos).toBe(5);
  });

  it('moveToWordBack jumps to word start', () => {
    const c = new Cursor('hello world', 8); // after 'wo'
    const moved = c.moveToWordBack();
    expect(moved.pos).toBe(6); // start of 'world'
  });

  it('moveToWordBack from start of word jumps to previous word', () => {
    const c = new Cursor('hello world', 6); // start of 'world'
    const moved = c.moveToWordBack();
    expect(moved.pos).toBe(0); // start of 'hello'
  });

  it('moveToWordForward jumps past word and whitespace', () => {
    const c = new Cursor('hello world', 0);
    const moved = c.moveToWordForward();
    expect(moved.pos).toBe(6); // start of 'world'
  });

  it('moveToWordForward from middle of word jumps to next word', () => {
    const c = new Cursor('hello world foo', 2); // 'he|llo...'
    const moved = c.moveToWordForward();
    expect(moved.pos).toBe(6); // start of 'world'
  });
});

/* ── Cursor: navigation with graphemes ─────────────── */

describe('Cursor grapheme-aware navigation', () => {
  it('moveLeft/Right works with emoji', () => {
    const c = new Cursor('A👍B', 2); // after 👍
    expect(c.before).toBe('A👍');
    expect(c.after).toBe('B');

    const left = c.moveLeft();
    expect(left.pos).toBe(1);
    expect(left.before).toBe('A');
    expect(left.after).toBe('👍B');
  });

  it('moveLeft/Right works with CJK', () => {
    const c = new Cursor('你好世界', 2);
    expect(c.before).toBe('你好');
    expect(c.after).toBe('世界');
  });

  it('moveLeft/Right works with Korean', () => {
    const c = new Cursor('안녕하세요', 3);
    expect(c.before).toBe('안녕하');
    expect(c.after).toBe('세요');
  });
});

/* ── Cursor: editing ───────────────────────────────── */

describe('Cursor editing', () => {
  it('insert at cursor position', () => {
    const c = new Cursor('helo', 2).insert('l');
    expect(c.text).toBe('hello');
    expect(c.pos).toBe(3);
  });

  it('insert at start', () => {
    const c = new Cursor('world', 0).insert('hello ');
    expect(c.text).toBe('hello world');
    expect(c.pos).toBe(6);
  });

  it('insert at end', () => {
    const c = new Cursor('hello').insert(' world');
    expect(c.text).toBe('hello world');
    expect(c.pos).toBe(11);
  });

  it('insert NFC-normalizes the input', () => {
    const c = new Cursor('').insert('e\u0301');
    expect(c.text).toBe('\u00e9');
    expect(c.length).toBe(1);
  });

  it('insert emoji', () => {
    const c = new Cursor('hi ', 3).insert('👋');
    expect(c.text).toBe('hi 👋');
    expect(c.pos).toBe(4); // grapheme position, not byte
    expect(c.length).toBe(4);
  });

  it('deleteBack removes one grapheme', () => {
    const c = new Cursor('hello', 3).deleteBack();
    expect(c.text).toBe('helo');
    expect(c.pos).toBe(2);
  });

  it('deleteBack at pos 0 returns same cursor', () => {
    const c = new Cursor('hello', 0);
    const result = c.deleteBack();
    expect(result).toBe(c); // same reference
    expect(result.text).toBe('hello');
  });

  it('deleteBack removes emoji as one unit', () => {
    const c = new Cursor('A👍B', 2).deleteBack(); // delete 👍
    expect(c.text).toBe('AB');
    expect(c.pos).toBe(1);
  });

  it('deleteForward removes one grapheme ahead', () => {
    const c = new Cursor('hello', 2).deleteForward();
    expect(c.text).toBe('helo');
    expect(c.pos).toBe(2);
  });

  it('deleteForward at end returns same cursor', () => {
    const c = new Cursor('hello');
    const result = c.deleteForward();
    expect(result).toBe(c);
  });

  it('clear returns empty cursor', () => {
    const c = new Cursor('hello').clear();
    expect(c.text).toBe('');
    expect(c.pos).toBe(0);
    expect(c.isEmpty).toBe(true);
  });

  it('replaceAll replaces text, cursor at end', () => {
    const c = new Cursor('old', 1).replaceAll('new text');
    expect(c.text).toBe('new text');
    expect(c.pos).toBe(8);
  });
});

/* ── Cursor: kill operations ───────────────────────── */

describe('Cursor kill operations', () => {
  it('killToEnd removes text after cursor', () => {
    const [c, killed] = new Cursor('hello world', 5).killToEnd();
    expect(c.text).toBe('hello');
    expect(c.pos).toBe(5);
    expect(killed).toBe(' world');
  });

  it('killToStart removes text before cursor', () => {
    const [c, killed] = new Cursor('hello world', 5).killToStart();
    expect(c.text).toBe(' world');
    expect(c.pos).toBe(0);
    expect(killed).toBe('hello');
  });

  it('killWordBack removes previous word', () => {
    const [c, killed] = new Cursor('hello world', 11).killWordBack();
    expect(c.text).toBe('hello ');
    expect(killed).toBe('world');
  });

  it('killWordBack from middle of word removes back to word start', () => {
    // 'hello world' at pos 8 = after 'r' → word boundary back = 6 (start of 'world')
    const [c, killed] = new Cursor('hello world', 8).killWordBack();
    expect(c.text).toBe('hello rld');
    expect(killed).toBe('wo');
  });

  it('killToEnd at end returns empty killed string', () => {
    const [c, killed] = new Cursor('hello').killToEnd();
    expect(c.text).toBe('hello');
    expect(killed).toBe('');
  });

  it('killToStart at start returns empty killed string', () => {
    const [c, killed] = new Cursor('hello', 0).killToStart();
    expect(c.text).toBe('hello');
    expect(killed).toBe('');
  });
});

/* ── Cursor: beforeSegs / afterSegs ────────────────── */

describe('Cursor segment accessors', () => {
  it('beforeSegs returns graphemes before cursor', () => {
    const c = new Cursor('A👍B', 2);
    expect(c.beforeSegs).toEqual(['A', '👍']);
  });

  it('afterSegs returns graphemes after cursor', () => {
    const c = new Cursor('A👍B', 1);
    expect(c.afterSegs).toEqual(['👍', 'B']);
  });

  it('beforeSegs at start is empty', () => {
    expect(new Cursor('hello', 0).beforeSegs).toEqual([]);
  });

  it('afterSegs at end is empty', () => {
    expect(new Cursor('hello').afterSegs).toEqual([]);
  });
});

/* ── Display width (free functions) ────────────────── */

describe('textDisplayWidth (via free function)', () => {
  it('computes correctly for mixed ASCII + CJK', () => {
    // 'hi' (2) + '你' (2) = 4
    expect(textDisplayWidth('hi你')).toBe(4);
  });
});
