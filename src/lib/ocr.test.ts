import { describe, expect, it } from 'vitest';
import { groupToLines, type OcrWord } from './ocr';

const w = (text: string, x0: number, x1: number, y0: number, y1: number, confidence = 90): OcrWord => ({
  text, x0, y0, x1, y1, confidence,
});

/**
 * Regression tests from a live OCR run (2026-09-27): the old groupToLines
 * sorted words by raw bbox top (y0), but y0 varies with letter shapes —
 * "over" (x-height letters) sits lower than "The" (cap + ascender) on the
 * same baseline — so words came out scrambled ("the lazy dog 1234567890over")
 * and normal inter-word spaces were dropped ("foxjumps").
 */
describe('groupToLines', () => {
  it('orders words left-to-right even when bbox tops differ by glyph shape', () => {
    const words = [
      // "over the dog" on one baseline; "over" has the lowest top (x-height only)
      w('over', 100, 170, 106, 130),
      w('the', 180, 230, 88, 130),
      w('dog', 240, 300, 88, 130),
    ];
    const lines = groupToLines(words);
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe('over the dog');
  });

  it('keeps a normal inter-word space instead of gluing words', () => {
    const words = [
      w('fox', 350, 400, 88, 130),
      w('jumps', 415, 495, 88, 138), // 15px gap ≈ a real space at this size
    ];
    const lines = groupToLines(words);
    expect(lines[0].text).toBe('fox jumps');
  });

  it('does not insert a space between fragments of one split word', () => {
    const words = [
      w('don', 100, 150, 88, 130),
      w("'t", 152, 175, 88, 130), // 2px gap — a split word, not two words
    ];
    const lines = groupToLines(words);
    expect(lines[0].text).toBe("don't");
  });

  it('splits distinct visual rows into separate lines, top to bottom', () => {
    const words = [
      w('second', 100, 180, 230, 262),
      w('first', 100, 170, 120, 152),
    ];
    const lines = groupToLines(words);
    expect(lines.map((l) => l.text)).toEqual(['first', 'second']);
  });

  it('still drops low-confidence lines and keeps the bbox union', () => {
    const words = [
      w('junk', 100, 150, 100, 120, 10),
      w('real', 100, 150, 200, 230, 80),
    ];
    const lines = groupToLines(words);
    expect(lines.map((l) => l.text)).toEqual(['real']);
    expect(lines[0].x0).toBe(100);
    expect(lines[0].x1).toBe(150);
  });
});
