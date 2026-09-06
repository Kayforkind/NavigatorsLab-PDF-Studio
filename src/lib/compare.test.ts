import { describe, expect, it } from 'vitest';
import { diffLines, summarize } from './compare';
import { makeViewport } from './viewport';
import type { CompareLine } from './compare';

const line = (text: string, page = 1): CompareLine => ({ text, page });

describe('diffLines', () => {
  it('marks unchanged rows as same', () => {
    const a = [line('hello'), line('world')];
    const b = [line('hello'), line('world')];
    const rows = diffLines(a, b);
    expect(rows.every((r) => r.op === 'same')).toBe(true);
    expect(summarize(rows)).toEqual({ added: 0, removed: 0, same: 2 });
  });

  it('detects additions, removals and edits', () => {
    const a = [line('payment is scheduled'), line('total: $10.00'), line('bye')];
    const b = [line('payment is scheduled'), line('total: $12.00'), line('bye'), line('new footer')];
    const rows = diffLines(a, b);
    const s = summarize(rows);
    // an edited line is one removal + one addition in an LCS diff
    expect(s.added).toBe(2); // changed total + new footer
    expect(s.removed).toBe(1); // old total line
    expect(s.same).toBe(2);
  });

  it('handles empty documents', () => {
    const rows = diffLines([], [line('only in b')]);
    expect(summarize(rows)).toEqual({ added: 1, removed: 0, same: 0 });
  });
});

describe('viewport flip math', () => {
  it('mirrors css x for flipH at rotation 0', () => {
    const vp = makeViewport({ x: 0, y: 0, w: 612, h: 792 }, 1, 0, 1);
    const p = vp.convertToViewportPoint(100, 700);
    expect(p[0]).toBeCloseTo(612 - 100, 6);
    expect(p[1]).toBeCloseTo(92, 6); // 792 - 700, unchanged by h-flip
  });

  it('mirrors css y for flipV at rotation 0', () => {
    const vp = makeViewport({ x: 0, y: 0, w: 612, h: 792 }, 1, 0, 2);
    const p = vp.convertToViewportPoint(100, 700);
    // unflipped y would be 92; flipV negates it around the canvas height
    expect(p[0]).toBeCloseTo(100, 6);
    expect(p[1]).toBeCloseTo(700, 6);
  });

  it('round-trips through both flips', () => {
    for (const flip of [0, 1, 2, 3]) {
      const vp = makeViewport({ x: 30, y: 40, w: 500, h: 700 }, 1.3, 90, flip);
      for (const [cx, cy] of [
        [30, 40],
        [530, 740],
        [280, 390],
      ]) {
        const css = vp.convertToViewportPoint(cx, cy);
        const back = vp.convertToPdfPoint(css[0], css[1]);
        expect(back[0]).toBeCloseTo(cx, 5);
        expect(back[1]).toBeCloseTo(cy, 5);
      }
    }
  });
});
