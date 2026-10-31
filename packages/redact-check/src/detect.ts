/**
 * Detection core for the redaction checker.
 *
 * Two independent questions, answered from data only:
 *  1. Which pixels form a *solid dark box* — the shape people use when they
 *     "redact" by drawing a rectangle over text?
 *  2. Which text runs sit underneath such a box and are still *invisible*
 *     (i.e. actually painted over) — meaning the text was never removed from
 *     the file, only hidden?
 *
 * This module deliberately has no DOM and no pdf.js dependency, so it can be
 * unit-tested in plain Node. `analyze.ts` supplies the raster and the text
 * runs; all geometry lives here.
 *
 * HEURISTIC, NOT ORACLE. A box is "solid" if its connected dark region fills
 * its own bounding box. A leak is "hidden text" if the run sits under the box
 * AND the pixels in the run's glyph band are dark — which distinguishes a
 * genuinely painted-over word from a white label printed *on top of* the box.
 * Anything that merely looks like a box (a dark photo, a navy logo) can be
 * reported as a candidate; the verdict is about text being recoverable from
 * underneath it, which is the failure that actually leaks documents.
 */

export interface Raster {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** Axis-aligned rectangle in device pixels, origin top-left. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SolidBox extends Rect {
  /** filled pixels / bounding-box area, 0..1 */
  solidity: number;
}

export interface DetectOptions {
  /** max luminance (0..255) still counted as "dark". */
  darkMax?: number;
  /** min alpha (0..255) required to count a pixel as painted. */
  alphaMin?: number;
  /** min width/height in device px — smaller is antialiasing, not a box. */
  minSide?: number;
  /** boxes larger than this fraction of the page are backgrounds, not boxes. */
  maxAreaFrac?: number;
  /** min solidity — a box is a filled block, text is not. */
  minSolidity?: number;
}

const lum = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Rec. 709 luminance of the pixel at byte offset `p`. */
export function luminanceAt(data: Uint8ClampedArray, p: number): number {
  return lum(data[p], data[p + 1], data[p + 2]);
}

/**
 * Find solid dark rectangles: connected dark regions whose filled area covers
 * at least `minSolidity` of their own bounding box.
 *
 * Glyphs fail this test (letters are sparse inside their box); filled
 * redaction rectangles pass it. Boxes covering most of the page are rejected
 * as backgrounds so a dark-themed slide isn't reported as one huge redaction.
 */
export function findSolidBoxes(raster: Raster, opts: DetectOptions = {}): SolidBox[] {
  const {
    darkMax = 80,
    alphaMin = 200,
    minSide = 8,
    maxAreaFrac = 0.6,
    minSolidity = 0.85,
  } = opts;
  const { data, width, height } = raster;
  if (width <= 0 || height <= 0) return [];

  const n = width * height;
  const mask = new Uint8Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    if (data[p + 3] < alphaMin) continue;
    if (luminanceAt(data, p) <= darkMax) mask[i] = 1;
  }

  const maxArea = width * height * maxAreaFrac;
  const stack = new Int32Array(n);
  const boxes: SolidBox[] = [];

  for (let seed = 0; seed < n; seed++) {
    if (mask[seed] !== 1) continue;
    let sp = 0;
    stack[sp++] = seed;
    mask[seed] = 2; // visited
    let count = 0;
    let minX = width;
    let maxX = -1;
    let minY = height;
    let maxY = -1;

    while (sp > 0) {
      const idx = stack[--sp];
      const y = (idx / width) | 0;
      const x = idx - y * width;
      count++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      if (x > 0 && mask[idx - 1] === 1) {
        mask[idx - 1] = 2;
        stack[sp++] = idx - 1;
      }
      if (x + 1 < width && mask[idx + 1] === 1) {
        mask[idx + 1] = 2;
        stack[sp++] = idx + 1;
      }
      if (y > 0 && mask[idx - width] === 1) {
        mask[idx - width] = 2;
        stack[sp++] = idx - width;
      }
      if (y + 1 < height && mask[idx + width] === 1) {
        mask[idx + width] = 2;
        stack[sp++] = idx + width;
      }
    }

    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    const area = w * h;
    if (w < minSide || h < minSide || area > maxArea) continue;
    const solidity = count / area;
    if (solidity < minSolidity) continue;
    boxes.push({ x: minX, y: minY, w, h, solidity });
  }

  // Reading order, largest first within a band — stable output for reports.
  boxes.sort((a, b) => a.y - b.y || a.x - b.x);
  return boxes;
}

/**
 * One text run in device space. `x,y` is the baseline origin, `dx,dy` the
 * advance vector for the whole run, `height` the font height.
 */
export interface TextRun {
  text: string;
  x: number;
  y: number;
  dx: number;
  dy: number;
  height: number;
}

export interface PdfTextItem {
  str?: string;
  transform?: number[];
  width?: number;
}

export interface ViewportLike {
  transform: number[];
  scale: number;
}

/** Compose two pdf.js 2×3 matrices, same convention as `Util.transform(m1, m2)`. */
export function composeTransform(m1: number[], m2: number[]): number[] {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

/**
 * Convert pdf.js text items into device-space runs.
 *
 * Two units are in play and mixing them up is the classic bug here:
 *  - `item.width` is measured in PDF points (user space),
 *  - `tx` (text matrix ∘ viewport) already has the font size *and* the render
 *    scale baked in, so `tx[0]` alone is not a point-per-unit factor.
 * The advance is therefore `width × scale`, aimed along the normalized
 * composed x-axis, which stays correct for 90/180/270° page rotation.
 */
export function toTextRuns(items: PdfTextItem[], viewport: ViewportLike): TextRun[] {
  const runs: TextRun[] = [];
  for (const it of items) {
    const text = it.str ?? '';
    if (!text.trim() || !it.transform) continue;
    const tx = composeTransform(viewport.transform, it.transform);
    const advance = it.width ?? 0;
    const dir = Math.hypot(tx[0], tx[1]);
    const height = Math.hypot(tx[2], tx[3]);
    if (!Number.isFinite(advance) || advance <= 0 || dir === 0 || height <= 0) continue;
    const advDevice = advance * viewport.scale;
    runs.push({
      text,
      x: tx[4],
      y: tx[5],
      dx: (tx[0] / dir) * advDevice,
      dy: (tx[1] / dir) * advDevice,
      height,
    });
  }
  return runs;
}

export interface Span {
  /** character range [start, end) of `text` that falls inside the box. */
  start: number;
  end: number;
  /** fraction of the run's advance that is covered. */
  frac: number;
  /** device-space bounding rect of the covered characters. */
  rect: Rect;
}

export interface SpanOptions {
  /** min fraction of the glyph band height the box must cover. */
  minBandCover?: number;
  /** min advance fraction — thinner than this is antialiasing noise. */
  minFrac?: number;
}

/**
 * Clip a text run against a box, in the run's own rotated frame so pages
 * rotated by 90/180/270 are handled exactly like upright ones.
 *
 * Returns the covered character range, approximated by mapping the covered
 * length linearly across the string. Proportional fonts make the boundary
 * approximate by a character or two; the tool says so.
 */
export function coveredSpan(run: TextRun, box: Rect, opts: SpanOptions = {}): Span | null {
  const { minBandCover = 0.45, minFrac = 0.02 } = opts;
  const { text, x, y, dx, dy, height } = run;
  if (!text || height <= 0) return null;
  const len = Math.hypot(dx, dy);
  if (len <= 0) return null;

  const ux = dx / len;
  const uy = dy / len;
  // Normal points "down" the glyph band for left-to-right text (device y grows down).
  const nx = -uy;
  const ny = ux;

  let sMin = Infinity;
  let sMax = -Infinity;
  let tMin = Infinity;
  let tMax = -Infinity;
  for (const [cx, cy] of [
    [box.x, box.y],
    [box.x + box.w, box.y],
    [box.x, box.y + box.h],
    [box.x + box.w, box.y + box.h],
  ]) {
    const rx = cx - x;
    const ry = cy - y;
    const s = rx * ux + ry * uy;
    const t = rx * nx + ry * ny;
    if (s < sMin) sMin = s;
    if (s > sMax) sMax = s;
    if (t < tMin) tMin = t;
    if (t > tMax) tMax = t;
  }

  const sA = Math.max(0, sMin);
  const sB = Math.min(len, sMax);
  const tA = Math.max(0, tMin);
  const tB = Math.min(height, tMax);
  if (sB - sA <= 0 || tB - tA <= 0) return null;

  const bandCover = (tB - tA) / height;
  const frac = (sB - sA) / len;
  if (bandCover < minBandCover || frac < minFrac) return null;

  const chars = [...text].length;
  const start = Math.max(0, Math.min(chars, Math.floor((sA / len) * chars)));
  const end = Math.max(start, Math.min(chars, Math.ceil((sB / len) * chars)));
  if (end <= start) return null;

  // AABB of the covered glyph band (baseline strip extruded by font height).
  const ax = x + ux * sA;
  const ay = y + uy * sA;
  const bx = x + ux * sB;
  const by = y + uy * sB;
  const xs = [ax, bx, ax + nx * height, bx + nx * height];
  const ys = [ay, by, ay + ny * height, by + ny * height];
  const rx0 = Math.min(...xs);
  const ry0 = Math.min(...ys);
  const rect: Rect = {
    x: rx0,
    y: ry0,
    w: Math.max(...xs) - rx0,
    h: Math.max(...ys) - ry0,
  };

  return { start, end, frac, rect };
}

/** Mean luminance over `rect`, clamped to the raster. Returns 255 when empty. */
export function meanLuminance(raster: Raster, rect: Rect): number {
  const { data, width, height } = raster;
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(width, Math.ceil(rect.x + rect.w));
  const y1 = Math.min(height, Math.ceil(rect.y + rect.h));
  if (x1 <= x0 || y1 <= y0) return 255;
  let sum = 0;
  let count = 0;
  for (let yy = y0; yy < y1; yy++) {
    let p = (yy * width + x0) * 4;
    for (let xx = x0; xx < x1; xx++, p += 4) {
      sum += luminanceAt(data, p);
      count++;
    }
  }
  return count === 0 ? 255 : sum / count;
}

export interface Leak {
  /** the characters recovered from under the box (approximate boundaries). */
  text: string;
  /** index into the boxes array */
  box: number;
  /** fraction of the run's advance covered by the box */
  frac: number;
  /** mean luminance of the covered glyph band — low means genuinely hidden */
  luma: number;
}

export interface LeakOptions {
  /** text whose glyph band is darker than this was painted over, not labelled. */
  hiddenMaxLuma?: number;
}

/**
 * Find text runs that survive underneath a box.
 *
 * The luminance test is the important half: text printed ON TOP of a black
 * box (a "REDACTED" label, white type) leaves light pixels in its glyph band
 * and is correctly NOT a leak. Text that the box was drawn over leaves only
 * dark pixels — it is invisible on screen and still fully recoverable from
 * the file.
 */
export function findLeaks(
  runs: TextRun[],
  boxes: SolidBox[],
  raster: Raster,
  opts: LeakOptions = {},
): Leak[] {
  const { hiddenMaxLuma = 110 } = opts;
  const leaks: Leak[] = [];
  for (const run of runs) {
    if (!run.text.trim()) continue;
    for (let bi = 0; bi < boxes.length; bi++) {
      const span = coveredSpan(run, boxes[bi]);
      if (!span) continue;
      const chars = [...run.text];
      const slice = chars.slice(span.start, span.end).join('').trim();
      if (!slice) continue;
      const luma = meanLuminance(raster, span.rect);
      if (luma > hiddenMaxLuma) continue;
      leaks.push({ text: slice, box: bi, frac: span.frac, luma });
    }
  }
  return leaks;
}
