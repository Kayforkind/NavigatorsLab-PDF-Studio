import { describe, it, expect } from 'vitest';
import {
  findSolidBoxes,
  coveredSpan,
  findLeaks,
  meanLuminance,
  toTextRuns,
  type Raster,
  type TextRun,
} from './detect.js';

/** White page with an alpha-255 background. */
function blank(width: number, height: number): Raster {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255;
    data[i + 1] = 255;
    data[i + 2] = 255;
    data[i + 3] = 255;
  }
  return { data, width, height };
}

function fill(r: Raster, x: number, y: number, w: number, h: number, v: number): void {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      const p = (yy * r.width + xx) * 4;
      r.data[p] = v;
      r.data[p + 1] = v;
      r.data[p + 2] = v;
      r.data[p + 3] = 255;
    }
  }
}

/** A sparse glyph-ish pattern: vertical strokes, low fill ratio in its bbox. */
function glyphs(r: Raster, x: number, y: number, w: number, h: number): void {
  for (let xx = x; xx < x + w; xx += 4) fill(r, xx, y, 2, h, 0);
}

describe('findSolidBoxes', () => {
  it('finds a solid black rectangle', () => {
    const r = blank(400, 300);
    fill(r, 50, 60, 120, 20, 0);
    const boxes = findSolidBoxes(r);
    expect(boxes).toHaveLength(1);
    expect(boxes[0]).toMatchObject({ x: 50, y: 60, w: 120, h: 20 });
    expect(boxes[0].solidity).toBeGreaterThan(0.99);
  });

  it('does not mistake a line of glyphs for a box', () => {
    const r = blank(400, 300);
    glyphs(r, 20, 100, 300, 16);
    expect(findSolidBoxes(r)).toHaveLength(0);
  });

  it('ignores dark regions smaller than minSide', () => {
    const r = blank(200, 200);
    fill(r, 10, 10, 4, 4, 0);
    expect(findSolidBoxes(r)).toHaveLength(0);
  });

  it('rejects a dark page background instead of calling it a redaction', () => {
    const r = blank(300, 300);
    fill(r, 0, 0, 300, 300, 20);
    expect(findSolidBoxes(r)).toHaveLength(0);
  });

  it('finds several boxes in reading order', () => {
    const r = blank(400, 400);
    fill(r, 30, 250, 60, 20, 0);
    fill(r, 30, 40, 60, 20, 0);
    const boxes = findSolidBoxes(r);
    expect(boxes.map((b) => b.y)).toEqual([40, 250]);
  });

  it('separates two boxes that do not touch', () => {
    const r = blank(400, 300);
    fill(r, 20, 20, 50, 20, 0);
    fill(r, 200, 20, 50, 20, 0);
    expect(findSolidBoxes(r)).toHaveLength(2);
  });
});

describe('meanLuminance', () => {
  it('is ~0 over black and ~255 over white', () => {
    const r = blank(100, 100);
    expect(meanLuminance(r, { x: 0, y: 0, w: 10, h: 10 })).toBeCloseTo(255, 0);
    fill(r, 0, 0, 100, 100, 0);
    expect(meanLuminance(r, { x: 0, y: 0, w: 10, h: 10 })).toBeCloseTo(0, 0);
  });

  it('returns 255 for an empty rect rather than NaN', () => {
    const r = blank(10, 10);
    expect(meanLuminance(r, { x: 50, y: 50, w: 10, h: 10 })).toBe(255);
  });
});

describe('coveredSpan', () => {
  const run: TextRun = { text: 'SECRET VALUE', x: 100, y: 200, dx: 120, dy: 0, height: 12 };

  it('covers the whole run when the box encloses it', () => {
    const span = coveredSpan(run, { x: 90, y: 190, w: 200, h: 30 });
    expect(span).not.toBeNull();
    expect(span!.start).toBe(0);
    expect(span!.end).toBe(run.text.length);
    expect(span!.frac).toBeCloseTo(1, 5);
  });

  it('covers only the left half when the box covers the left half', () => {
    const span = coveredSpan(run, { x: 100, y: 190, w: 60, h: 30 });
    expect(span).not.toBeNull();
    expect(span!.start).toBe(0);
    expect(span!.frac).toBeCloseTo(0.5, 5);
    expect(span!.end).toBeGreaterThan(3);
    expect(span!.end).toBeLessThan(run.text.length);
  });

  it('returns null when the box is elsewhere', () => {
    expect(coveredSpan(run, { x: 400, y: 400, w: 50, h: 20 })).toBeNull();
  });

  it('returns null when the box only clips the descender area below the baseline', () => {
    // t < 0 above the baseline; the glyph band runs from the baseline downward.
    expect(coveredSpan(run, { x: 90, y: 210, w: 200, h: 8 })).toBeNull();
  });

  it('returns null for a zero-length run', () => {
    expect(coveredSpan({ ...run, dx: 0, dy: 0 }, { x: 0, y: 0, w: 10, h: 10 })).toBeNull();
  });

  it('handles a 90° rotated page (text advancing downward)', () => {
    const vertical: TextRun = { text: 'ROTATED', x: 300, y: 100, dx: 0, dy: 140, height: 12 };
    const span = coveredSpan(vertical, { x: 290, y: 90, w: 30, h: 200 });
    expect(span).not.toBeNull();
    expect(span!.frac).toBeCloseTo(1, 5);
  });

  it('handles a 180° page (text advancing right-to-left)', () => {
    const reversed: TextRun = { text: 'BACKWARDS', x: 400, y: 200, dx: -160, dy: 0, height: 12 };
    // run covers x 240..400; the box covers 300..420, so 100 of 160 units overlap
    const span = coveredSpan(reversed, { x: 300, y: 190, w: 120, h: 30 });
    expect(span).not.toBeNull();
    expect(span!.frac).toBeCloseTo(100 / 160, 5);
  });
});

describe('toTextRuns', () => {
  // Real numbers from the generated fixture (612×792 page, 2× render).
  const viewport = { transform: [2, 0, 0, -2, 0, 1584], scale: 2 };

  it('scales the point-width advance and keeps height in device px', () => {
    const [run] = toTextRuns(
      [{ str: 'NORTHWIND CLINIC', transform: [16, 0, 0, 16, 72, 620], width: 157.3 }],
      viewport,
    );
    expect(run.x).toBeCloseTo(144, 5);
    expect(run.y).toBeCloseTo(1584 - 2 * 620, 5); // 344: 2× render, y flipped
    expect(run.dx).toBeCloseTo(314.6, 5);
    expect(run.dy).toBeCloseTo(0, 5);
    expect(run.height).toBeCloseTo(32, 5);
  });

  it('does not inflate a short label (advance must not be multiplied by font size)', () => {
    const [run] = toTextRuns(
      [{ str: 'Patient record', transform: [10, 0, 0, 10, 72, 610], width: 62.3 }],
      viewport,
    );
    // 72 pt + 62.3 pt = 134.3 pt = 268.6 device px, which stays left of the
    // box at x=176 pt (352 device px).
    expect(run.x + run.dx).toBeCloseTo(268.6, 1);
    expect(run.x + run.dx).toBeLessThan(352);
  });

  it('aims the advance straight down on a 90° rotated viewport', () => {
    const [run] = toTextRuns(
      [{ str: 'ROTATED', transform: [10, 0, 0, 10, 100, 100], width: 50 }],
      { transform: [0, 2, 2, 0, 0, 0], scale: 2 },
    );
    expect(run.dx).toBeCloseTo(0, 5);
    expect(run.dy).toBeCloseTo(100, 5);
    expect(run.height).toBeCloseTo(20, 5);
  });

  it('drops empty runs, missing transforms and zero advances', () => {
    expect(
      toTextRuns(
        [
          { str: '   ', transform: [10, 0, 0, 10, 0, 0], width: 10 },
          { str: 'no transform', width: 10 },
          { str: 'no width', transform: [10, 0, 0, 10, 0, 0] },
        ],
        viewport,
      ),
    ).toHaveLength(0);
  });
});

describe('findLeaks', () => {
  const run: TextRun = { text: 'Jane Doe SSN', x: 100, y: 200, dx: 120, dy: 0, height: 12 };
  const box = { x: 90, y: 190, w: 200, h: 30, solidity: 1 };

  it('reports text that the box was painted over (dark glyph band)', () => {
    const r = blank(400, 300);
    fill(r, 90, 190, 200, 30, 0);
    const leaks = findLeaks([run], [box], r);
    expect(leaks).toHaveLength(1);
    expect(leaks[0].text).toBe('Jane Doe SSN');
    expect(leaks[0].luma).toBeLessThan(10);
  });

  it('does NOT report white text printed on top of the box (a label, not a leak)', () => {
    const r = blank(400, 300);
    fill(r, 90, 190, 200, 30, 0);
    // white label glyphs exactly where the run's band is
    fill(r, 100, 196, 120, 12, 255);
    const leaks = findLeaks([run], [box], r);
    expect(leaks).toHaveLength(0);
  });

  it('ignores whitespace-only runs', () => {
    const r = blank(400, 300);
    fill(r, 90, 190, 200, 30, 0);
    expect(findLeaks([{ ...run, text: '   ' }], [box], r)).toHaveLength(0);
  });

  it('ignores runs that only partially clip the band below the threshold', () => {
    const r = blank(400, 300);
    fill(r, 90, 190, 200, 30, 0);
    const tall = { ...run, height: 120 };
    // the box covers only 30/120 of this tall far-off band
    expect(findLeaks([tall], [box], r)).toHaveLength(0);
  });

  it('reports the approximate covered substring when only part is hidden', () => {
    const r = blank(400, 300);
    fill(r, 90, 190, 60, 30, 0); // left half only
    const leaks = findLeaks([run], [{ ...box, w: 60 }], r);
    expect(leaks).toHaveLength(1);
    expect(leaks[0].text.length).toBeLessThan(run.text.length);
    expect(leaks[0].text.length).toBeGreaterThan(2);
  });
});
