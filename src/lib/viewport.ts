import type { Point } from '../types';

/** Structural view of a viewport that we rely on (y-down css pixels). */
export interface ViewportLike {
  width: number;
  height: number;
  transform: number[];
  convertToViewportPoint: (x: number, y: number) => [number, number];
  convertToPdfPoint: (x: number, y: number) => [number, number];
}

/** A page's visible box in PDF user space (we use the CropBox — pdf.js crops to it too). */
export interface PageBox {
  /** box origin in user space */
  x: number;
  y: number;
  /** box size in points */
  w: number;
  h: number;
}

/**
 * Viewport math — faithful port of pdf.js PageViewport so we never need a
 * synchronous page object for coordinate conversions.
 * rotation is the TOTAL page rotation: intrinsic /Rotate + user rotation.
 * flip: bit 1 = horizontal mirror, bit 2 = vertical mirror (applied in
 * display space, after rotation — mirrors what the exporter does).
 * The math is origin-aware (viewBox may start anywhere), matching pdf.js
 * exactly — including files whose CropBox/MediaBox don't start at (0,0).
 */
export function makeViewport(box: PageBox, scale: number, rotation: number, flip = 0): ViewportLike {
  const viewBox = [box.x, box.y, box.x + box.w, box.y + box.h];
  const centerX = (viewBox[2] + viewBox[0]) / 2;
  const centerY = (viewBox[3] + viewBox[1]) / 2;
  const r = ((rotation % 360) + 360) % 360;
  let rotateA: number;
  let rotateB: number;
  let rotateC: number;
  let rotateD: number;
  switch (r) {
    case 0:
      rotateA = 1;
      rotateB = 0;
      rotateC = 0;
      rotateD = -1;
      break;
    case 90:
      rotateA = 0;
      rotateB = 1;
      rotateC = 1;
      rotateD = 0;
      break;
    case 180:
      rotateA = -1;
      rotateB = 0;
      rotateC = 0;
      rotateD = 1;
      break;
    case 270:
      rotateA = 0;
      rotateB = -1;
      rotateC = -1;
      rotateD = 0;
      break;
    default:
      rotateA = 1;
      rotateB = 0;
      rotateC = 0;
      rotateD = -1;
  }
  let offsetCanvasX: number;
  let offsetCanvasY: number;
  let width: number;
  let height: number;
  if (rotateA === 0) {
    offsetCanvasX = Math.abs(centerY - viewBox[1]) * scale;
    offsetCanvasY = Math.abs(centerX - viewBox[0]) * scale;
    width = (viewBox[3] - viewBox[1]) * scale;
    height = (viewBox[2] - viewBox[0]) * scale;
  } else {
    offsetCanvasX = Math.abs(centerX - viewBox[0]) * scale;
    offsetCanvasY = Math.abs(centerY - viewBox[1]) * scale;
    width = (viewBox[2] - viewBox[0]) * scale;
    height = (viewBox[3] - viewBox[1]) * scale;
  }
  const transform = [
    rotateA * scale,
    rotateB * scale,
    rotateC * scale,
    rotateD * scale,
    offsetCanvasX - rotateA * scale * centerX - rotateC * scale * centerY,
    offsetCanvasY - rotateB * scale * centerX - rotateD * scale * centerY,
  ];
  const apply = (m: number[], p: Point): [number, number] => [
    m[0] * p.x + m[2] * p.y + m[4],
    m[1] * p.x + m[3] * p.y + m[5],
  ];
  // display-space mirror: negate css x (flipH) and/or y (flipV) around the canvas
  const fh = (flip & 1) !== 0;
  const fv = (flip & 2) !== 0;
  const post = (p: Point): Point => ({ x: fh ? width - p.x : p.x, y: fv ? height - p.y : p.y });
  const pre = (p: Point): Point => ({ x: fh ? width - p.x : p.x, y: fv ? height - p.y : p.y });
  const [a, b, c, d, e, f] = transform;
  const det = a * d - c * b;
  const inv = det === 0 ? null : [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
  return {
    width,
    height,
    transform,
    convertToViewportPoint: (x, y) => {
      const [vx, vy] = apply(transform, { x, y });
      const q = post({ x: vx, y: vy });
      return [q.x, q.y];
    },
    convertToPdfPoint: (x, y) => {
      const q = pre({ x, y });
      const [px, py] = inv ? apply(inv, q) : [q.x, q.y];
      return [px, py];
    },
  };
}

/** Helper for PageRec-shaped records (blanks default to an origin box). */
export function boxOf(p: { bx?: number; by?: number; w: number; h: number }): PageBox {
  return { x: p.bx ?? 0, y: p.by ?? 0, w: p.w, h: p.h };
}

export function contentToCss(vp: ViewportLike, p: Point): Point {
  const [x, y] = vp.convertToViewportPoint(p.x, p.y);
  return { x, y };
}

export function cssToContent(vp: ViewportLike, p: Point): Point {
  const [x, y] = vp.convertToPdfPoint(p.x, p.y);
  return { x, y };
}

export function clientToContent(vp: ViewportLike, rect: DOMRect, cx: number, cy: number): Point {
  return cssToContent(vp, { x: cx - rect.left, y: cy - rect.top });
}
