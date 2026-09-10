import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { Annotation, PageRec, Point } from '../types';
import { makeViewport } from './viewport';

/**
 * True redaction support.
 *
 * A clip path (or a black rectangle) can hide content, but the text stays in
 * the file and remains copyable/extractable — a serious privacy failure. The
 * only robust client-side removal is to REPLACE the page content: render the
 * page to pixels with pdf.js, paint the redaction boxes into the bitmap, and
 * export that raster instead of the original content stream. What is gone
 * from the bitmap is gone from the file.
 *
 * `rasterizePage` renders at a DPI-equivalent scale (capped so huge pages
 * stay within memory), mirrors the result when the page is flipped (matching
 * the exporter's display-space flip), fills the boxes, and returns a JPEG
 * data URL. `null` means "nothing to redact / rendering failed" and callers
 * fall back to the vector path.
 */

export interface RedactRect {
  x: number;
  y: number;
  w: number;
  h: number;
  /** css hex fill; defaults to the classic near-black when omitted */
  color?: string;
}

/** Longest canvas side we allow when rasterizing (≈ 2200px ≈ 260 DPI on Letter). */
const MAX_RASTER_PX = 2200;

export interface RasterResult {
  /** JPEG data URL of the fully-rendered page with boxes burned in */
  dataUrl: string;
  /** bitmap dimensions in px (also the new page size in points at 1:1) */
  w: number;
  h: number;
}

export async function rasterizePage(
  proxy: PDFDocumentProxy,
  rec: PageRec,
  pageIndex: number,
  totalRotation: number,
  rects: RedactRect[],
  dpr = Math.min(2, window.devicePixelRatio || 1),
): Promise<RasterResult | null> {
  if (rects.length === 0 || rec.src === null) return null;
  try {
    const page = await proxy.getPage(pageIndex + 1);
    // Fit: scale so the LONGEST display side ≈ MAX_RASTER_PX (css px), then
    // multiply by dpr for the bitmap — same shape the on-screen sheet uses.
    const box = { x: rec.bx, y: rec.by, w: rec.w, h: rec.h };
    const probe = makeViewport(box, 1, totalRotation);
    const longest = Math.max(probe.width, probe.height) || 1;
    const cssScale = Math.min(MAX_RASTER_PX / longest, 4);
    const vp = page.getViewport({ scale: cssScale * dpr, rotation: totalRotation });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(vp.width));
    canvas.height = Math.max(1, Math.floor(vp.height));
    const ctx = canvas.getContext('2d', { willReadFrequently: false });
    if (!ctx) return null;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;

    // Display-space mirror (flip happens AFTER rotation, matching the app
    // and the exporter): bit 1 = horizontal, bit 2 = vertical.
    const flip = rec.flip ?? 0;
    if (flip) {
      const fh = (flip & 1) !== 0;
      const fv = (flip & 2) !== 0;
      const tmp = document.createElement('canvas');
      tmp.width = canvas.width;
      tmp.height = canvas.height;
      tmp.getContext('2d')!.drawImage(canvas, 0, 0);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.translate(fh ? canvas.width : 0, fv ? canvas.height : 0);
      ctx.scale(fh ? -1 : 1, fv ? -1 : 1);
      ctx.drawImage(tmp, 0, 0);
      ctx.restore();
    }

    // Map content-space boxes → bitmap px (via the same viewport math the
    // UI uses), then burn them into the pixels.
    const mapVp = makeViewport(box, cssScale * dpr, totalRotation);
    const toPx = (p: Point): Point => {
      const m = mapVp.transform;
      return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
    };
    for (const r of rects) {
      const tl = toPx({ x: r.x, y: r.y + r.h });
      const br = toPx({ x: r.x + r.w, y: r.y });
      const x = Math.min(tl.x, br.x);
      const y = Math.min(tl.y, br.y);
      const w = Math.abs(br.x - tl.x);
      const h = Math.abs(br.y - tl.y);
      ctx.fillStyle = r.color || '#0a0a0c';
      // +1px bleed so hairline anti-aliased edges of the original glyphs
      // cannot peek out around the box.
      ctx.fillRect(Math.floor(x) - 1, Math.floor(y) - 1, Math.ceil(w) + 2, Math.ceil(h) + 2);
    }
    return { dataUrl: canvas.toDataURL('image/jpeg', 0.92), w: canvas.width, h: canvas.height };
  } catch (e) {
    console.warn('rasterizePage failed — falling back to clip redaction:', e);
    return null; // fall back to the clip-based redaction at export
  }
}

/**
 * Maps annotations from source content space (y-up, box origin) into the
 * DISPLAY space of an already-rotated/flipped raster page (y-up page coords,
 * rotation baked into the bitmap). Used so annotations drawn on top of a
 * rasterized page land exactly where the user placed them.
 */
export function transformAnnsToDisplaySpace(
  anns: Annotation[],
  box: { x: number; y: number; w: number; h: number },
  totalRotation: number,
  flip: number,
  pageW: number,
  pageH: number,
): Annotation[] {
  const m = makeViewport(box, 1, totalRotation, flip).transform;
  // makeViewport yields y-down canvas coords; pdf-lib pages are y-up.
  const map = (x: number, y: number): Point => ({
    x: m[0] * x + m[2] * y + m[4],
    y: pageH - (m[1] * x + m[3] * y + m[5]),
  });
  const rect = (x: number, y: number, w: number, h: number) => {
    const a = map(x, y);
    const b = map(x + w, y + h);
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
  };
  return anns.map((a): Annotation => {
    switch (a.type) {
      case 'highlight':
      case 'underline':
      case 'strike':
      case 'redact':
      case 'whiteout':
      case 'edit':
      case 'image':
      case 'rect':
      case 'ellipse':
        return { ...a, ...rect(a.x, a.y, a.w, a.h) };
      case 'note': {
        const sz = a.w ?? 16;
        return { ...a, ...rect(a.x, a.y, sz, a.h ?? sz) };
      }
      case 'text': {
        const p = map(a.x, a.y);
        return { ...a, x: p.x, y: p.y };
      }
      case 'arrow': {
        const p1 = map(a.x1, a.y1);
        const p2 = map(a.x2, a.y2);
        return { ...a, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
      }
      case 'ink':
        return { ...a, pts: a.pts.map((q) => map(q.x, q.y)) };
    }
  });
}
