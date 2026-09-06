import { describe, expect, it } from 'vitest';
import { contentToCss, cssToContent, makeViewport } from './viewport';
import { parseRanges } from './ranges';
/** Expected outputs taken from pdf.js's own PageViewport for a 612x792 page. */
const PARITY: Record<number, { dims: [number, number]; t: number[] }> = {
  0: { dims: [612, 792], t: [1, 0, 0, -1, 0, 792] },
  90: { dims: [792, 612], t: [0, 1, 1, 0, 0, 0] },
  180: { dims: [612, 792], t: [-1, 0, 0, 1, 612, 0] },
  270: { dims: [792, 612], t: [0, -1, -1, 0, 792, 612] },
};

describe('makeViewport parity with pdf.js PageViewport', () => {
  for (const rot of [0, 90, 180, 270]) {
    it(`matches pdf.js for rotation ${rot}`, () => {
      const vp = makeViewport({ x: 0, y: 0, w: 612, h: 792 }, 1, rot);
      const p = PARITY[rot];
      expect(vp.width).toBeCloseTo(p.dims[0], 6);
      expect(vp.height).toBeCloseTo(p.dims[1], 6);
      for (let i = 0; i < 6; i++) expect(vp.transform[i]).toBeCloseTo(p.t[i], 6);
    });
  }

  it('scales dimensions and offsets linearly with scale', () => {
    const vp = makeViewport({ x: 0, y: 0, w: 612, h: 792 }, 2, 90);
    expect(vp.width).toBeCloseTo(1584, 6);
    expect(vp.height).toBeCloseTo(1224, 6);
    expect(vp.convertToViewportPoint(100, 400)[0]).toBeCloseTo(800, 6);
    expect(vp.convertToViewportPoint(100, 400)[1]).toBeCloseTo(200, 6);
  });

  it('round-trips content <-> css for every rotation at many points', () => {
    for (const rot of [0, 90, 180, 270]) {
      const vp = makeViewport({ x: 0, y: 0, w: 612, h: 792 }, 0.5, rot);
      for (const [cx, cy] of [
        [0, 0],
        [100, 200],
        [611, 791],
        [306, 396],
        [12.34, 567.89],
      ]) {
        const css = contentToCss(vp, { x: cx, y: cy });
        expect(css.x).toBeGreaterThanOrEqual(-1e-6);
        expect(css.y).toBeGreaterThanOrEqual(-1e-6);
        expect(css.x).toBeLessThanOrEqual(vp.width + 1e-6);
        expect(css.y).toBeLessThanOrEqual(vp.height + 1e-6);
        const back = cssToContent(vp, css);
        expect(back.x).toBeCloseTo(cx, 5);
        expect(back.y).toBeCloseTo(cy, 5);
      }
    }
  });

  it('normalizes negative/overflow rotations', () => {
    expect(makeViewport({ x: 0, y: 0, w: 612, h: 792 }, 1, 450).transform).toEqual(makeViewport({ x: 0, y: 0, w: 612, h: 792 }, 1, 90).transform);
    expect(makeViewport({ x: 0, y: 0, w: 612, h: 792 }, 1, -90).transform).toEqual(makeViewport({ x: 0, y: 0, w: 612, h: 792 }, 1, 270).transform);
  });

  it('is origin-aware: offset CropBox/MediaBox shift the mapping exactly like pdf.js', () => {
    // Ground truth measured from pdf.js PageViewport (see probe output):
    // crop (72,72,468,648): content (0,0) -> (-72,720), dims 468x648
    const vp = makeViewport({ x: 72, y: 72, w: 468, h: 648 }, 1, 0);
    expect(vp.width).toBeCloseTo(468, 6);
    expect(vp.height).toBeCloseTo(648, 6);
    const p00 = vp.convertToViewportPoint(0, 0);
    expect(p00[0]).toBeCloseTo(-72, 6);
    expect(p00[1]).toBeCloseTo(720, 6);
    // crop (100,50,512,742): content (0,0) -> (-100,792)
    const vp2 = makeViewport({ x: 100, y: 50, w: 512, h: 742 }, 1, 0);
    expect(vp2.width).toBeCloseTo(512, 6);
    expect(vp2.height).toBeCloseTo(742, 6);
    expect(vp2.convertToViewportPoint(0, 0)[0]).toBeCloseTo(-100, 6);
    expect(vp2.convertToViewportPoint(0, 0)[1]).toBeCloseTo(792, 6);
    // rot180 + crop (36,200,540,500): content (0,0) -> (576,-200)
    const vp3 = makeViewport({ x: 36, y: 200, w: 540, h: 500 }, 1, 180);
    expect(vp3.width).toBeCloseTo(540, 6);
    expect(vp3.height).toBeCloseTo(500, 6);
    const q = vp3.convertToViewportPoint(0, 0);
    expect(q[0]).toBeCloseTo(576, 6);
    expect(q[1]).toBeCloseTo(-200, 6);
  });

  it('round-trips through an offset box', () => {
    const vp = makeViewport({ x: -30, y: 15, w: 400, h: 300 }, 1.25, 270);
    for (const [cx, cy] of [[-30, 15], [370, 315], [170, 165], [12.5, 300.75]]) {
      const css = contentToCss(vp, { x: cx, y: cy });
      const back = cssToContent(vp, css);
      expect(back.x).toBeCloseTo(cx, 5);
      expect(back.y).toBeCloseTo(cy, 5);
    }
  });
});

describe('parseRanges', () => {
  it('parses comma ranges', () => {
    expect(parseRanges('', 6)).toEqual([]); // callers treat '' as "all"
    expect(parseRanges('1-3', 6)).toEqual([0, 1, 2]);
    expect(parseRanges('1,3,5', 6)).toEqual([0, 2, 4]);
    expect(parseRanges('5-2', 6)).toEqual([1, 2, 3, 4]);
    expect(parseRanges('1-9', 6)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(parseRanges('0,7', 6)).toEqual([]);
    expect(parseRanges('garbage', 6)).toEqual([]);
  });
});
