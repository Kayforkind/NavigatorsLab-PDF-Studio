import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type PDFPageProxy, type RenderTask } from 'pdfjs-dist';
import { PDFDocument as PdfLibDoc } from 'pdf-lib';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PageInfo, Source, TextHit } from '../types';

export * from './viewport';
export { parseRanges } from './ranges';

GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * pdf.js resource roots (absolute URLs, resolved against the deployed base).
 * Without cMaps, PDFs using CJK / pre-defined CMaps render blank pages and
 * extract no text; without standard font data, pages that rely on the 14
 * standard fonts (very common in generated invoices/statements) render
 * glyphs invisible — the classic "blank page" report. Both trees are
 * bundled into dist/ by vite-plugin-static-copy.
 */
const BASE: string = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
const CMAP_ROOT = new URL(`${BASE}cmaps/`, document.baseURI).href;
const STD_FONT_ROOT = new URL(`${BASE}standard_fonts/`, document.baseURI).href;

export interface LoadedSource {
  source: Source;
  /** pdf.js proxy used for rendering this source */
  js: PDFDocumentProxy;
}

export async function loadSource(bytes: Uint8Array, name: string): Promise<LoadedSource> {
  const lib = await PdfLibDoc.load(bytes, { ignoreEncryption: true });
  const pages: PageInfo[] = lib.getPages().map((p) => {
    // pdf.js renders the CROP box; capture its origin too — generators are free
    // to place it anywhere in user space and clicks/overlays must follow.
    const cb = p.getCropBox();
    return { w: cb.width, h: cb.height, bx: cb.x, by: cb.y, rot: p.getRotation().angle };
  });
  const js = await getDocument({
    data: new Uint8Array(bytes),
    cMapUrl: CMAP_ROOT,
    cMapPacked: true,
    standardFontDataUrl: STD_FONT_ROOT,
  }).promise;
  return { source: { id: crypto.randomUUID(), name, bytes, pages }, js };
}

export interface RenderOpts {
  /** css px per PDF point */
  scale: number;
  dpr: number;
  rotation: number;
  /** bit 1 = mirror horizontally, bit 2 = mirror vertically (display space) */
  flip?: number;
}

/**
 * Sizes a canvas and starts a pdf.js render. Callers must await task.promise
 * and MUST cancel the returned task before starting another render on the
 * same canvas (pdf.js forbids concurrent renders per canvas).
 * When `flip` is set, the painted result is blitted mirrored onto itself.
 */
export function beginRender(canvas: HTMLCanvasElement, page: PDFPageProxy, opts: RenderOpts): import('pdfjs-dist').RenderTask {
  const vp = page.getViewport({ scale: opts.scale * opts.dpr, rotation: opts.rotation });
  canvas.width = Math.max(1, Math.floor(vp.width));
  canvas.height = Math.max(1, Math.floor(vp.height));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  const task = page.render({ canvasContext: ctx, viewport: vp });
  if (opts.flip) {
    // pdf.js RenderTask.promise is getter-only in some builds — never assign to it.
    // Wrap instead: same surface (promise + cancel), but the promise resolves after
    // the mirror blit.
    const fh = (opts.flip & 1) !== 0;
    const fv = (opts.flip & 2) !== 0;
    const wrapped = task.promise.then(() => {
      const w = canvas.width;
      const h = canvas.height;
      const tmp = document.createElement('canvas');
      tmp.width = w;
      tmp.height = h;
      tmp.getContext('2d')!.drawImage(canvas, 0, 0);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.translate(fh ? w : 0, fv ? h : 0);
      ctx.scale(fh ? -1 : 1, fv ? -1 : 1);
      ctx.drawImage(tmp, 0, 0);
      ctx.restore();
    });
    return {
      get promise() {
        return wrapped;
      },
      cancel: (...args: unknown[]) => (task.cancel as (...a: unknown[]) => void)(...args),
    } as unknown as RenderTask;
  }
  return task;
}

/* ------------------------------------------------------------------ */
/* Text extraction                                                     */
/* ------------------------------------------------------------------ */

export interface RawTextItem {
  str: string;
  /** baseline x/y in content space */
  x: number;
  y: number;
  w: number;
  size: number;
  /** pdf.js font resource name when available (useful for diagnostics) */
  fontName?: string;
}

export async function pageTextItems(page: PDFPageProxy): Promise<RawTextItem[]> {
  const tc = await page.getTextContent();
  const out: RawTextItem[] = [];
  for (const it of tc.items as Array<Record<string, unknown>>) {
    const str = String(it.str ?? '');
    if (!str.trim()) continue;
    const t = it.transform as number[];
    if (!t || t.length < 6) continue;
    const w = typeof it.width === 'number' ? (it.width as number) : 0;
    if (w <= 0) continue;
    const height = typeof it.height === 'number' ? (it.height as number) : 0;
    const size = height > 0 ? height : Math.max(4, Math.abs(t[3]));
    out.push({ str, x: t[4], y: t[5], w, size });
  }
  return out;
}

/** Concatenated plain text of a page (for AI context / OCR-free copy). */
export async function pagePlainText(page: PDFPageProxy): Promise<string> {
  const items = await pageTextItems(page);
  return items.map((it) => it.str).join(' ');
}

/**
 * Split a text item at a content-space x position, distributing the measured
 * width across characters proportionally (glyph-level widths are not exposed
 * by pdf.js text extraction). Returns the two fragments, or null when the
 * split lands outside the item.
 */
function splitItemAt(it: RawTextItem, x: number): [RowItem, RowItem] | null {
  if (x <= it.x + 0.5 || x >= it.x + it.w - 0.5) return null;
  const frac = (x - it.x) / it.w;
  const n = it.str.length;
  let cut = Math.max(1, Math.min(n - 1, Math.round(n * frac)));
  // nudge to the nearest whitespace so cells do not split mid-word
  for (let d = 0; d <= 4; d++) {
    if (it.str[cut - d] === ' ') { cut -= d; break; }
    if (it.str[cut + d] === ' ') { cut += d; break; }
  }
  cut = Math.max(1, Math.min(n - 1, cut));
  const a = it.str.slice(0, cut).replace(/ +$/, '');
  const b = it.str.slice(cut).replace(/^ +/, '');
  if (!a || !b) return null;
  // Place fragments at the ACTUAL column boundary — the proportional cut only
  // distributes the text; if the fragments were positioned at the proportional
  // x, separate cell items at the true column would merge back into them.
  const left = it.x;
  const right = it.x + it.w;
  const mid = x;
  return [
    frag({ str: a, x: left, y: it.y, w: Math.max(1, mid - left), size: it.size }, true),
    frag({ str: b, x: mid, y: it.y, w: Math.max(1, right - mid), size: it.size }, true),
  ];
}

/** Item with a flag marking it as a fragment of a wider run that was cut at a
 *  table column boundary (so grouping never merges cells back together). */
type RowItem = RawTextItem & { frag?: boolean };

function frag(it: RawTextItem, f: boolean): RowItem {
  return { ...it, frag: f };
}

/**
 * Split items that span two table cells (generators that paint a whole row
 * as one text run) at the recurring column boundaries detected below.
 */
function splitWideItems(items: RawTextItem[], recurringColumns: Set<number>): RowItem[] {
  if (recurringColumns.size === 0) return items.map((it) => ({ ...it, frag: false }));
  const out: RowItem[] = [];
  const splitOne = (it: RowItem): void => {
    for (const col of [...recurringColumns].sort((a, b) => a - b)) {
      if (col > it.x + 0.5 && col < it.x + it.w - 0.5) {
        const frags = splitItemAt(it, col);
        if (frags) {
          splitOne(frags[0]);
          splitOne(frags[1]);
          return;
        }
      }
    }
    out.push(frag(it, it.frag === true));
  };
  for (const it of items) splitOne(it);
  return out;
}

/**
 * Turn pdf.js text items into safe edit targets.
 *
 * A PDF has no paragraphs, cells, or words — only positioned glyph runs.
 * The old implementation merged every run sharing a baseline. That is
 * disastrous for tables: an entire row became one hit and editing one cell
 * repainted/re-drew the whole row, changing its apparent formatting.
 *
 * We still join nearby runs into a normal prose line, but split at repeated
 * x-coordinate columns and at genuinely large gaps. Repeated x starts are a
 * strong table signal (the same columns recur down the page), so each cell
 * becomes its own target. Wide runs that SPAN two columns (some generators
 * paint an entire row as one show-text operator) are split at the recurring
 * boundaries too. This preserves untouched cells and their exact original
 * PDF positioning during export.
 */
export function groupIntoLines(items: RawTextItem[]): TextHit[] {
  interface Row { items: RawTextItem[]; y: number; size: number; right: number; }
  const rows: Row[] = [];
  for (const it of [...items].sort((a, b) => a.x - b.x)) {
    // Join the matching row with the rightmost extent. A wide run that spans
    // a whole table row makes every cell item sit inside its extent, so the
    // join only requires y-alignment plus a generous overlap allowance; rows
    // that are genuinely separate (different baselines) never match.
    let row: Row | undefined;
    for (const r of rows) {
      if (Math.abs(r.y - it.y) >= Math.max(2, Math.max(r.size, it.size) * 0.45)) continue;
      // The first item of a row has right == its own right edge; only items
      // that start near/inside that extent join. This keeps separate columns
      // apart while allowing a wide run to span the whole row.
      const tol = Math.max(2, r.right * 0.25, it.size * 2);
      if (it.x >= r.right - tol && (!row || r.right > row.right)) row = r;
    }
    if (row) {
      row.items.push(it);
      row.y = (row.y + it.y) / 2;
      row.size = Math.max(row.size, it.size);
      row.right = Math.max(row.right, it.x + it.w);
    } else {
      rows.push({ items: [it], y: it.y, size: it.size, right: it.x + it.w });
    }
  }

  // Detect recurring column starts. A prose paragraph normally repeats only
  // its left margin; that does not split anything because its first item has
  // no predecessor. A table repeats several starts across many rows.
  const starts = new Map<number, Set<number>>();
  const startKey = (x: number) => Math.round(x * 2) / 2;
  rows.forEach((row, rowIndex) => {
    for (const it of row.items) {
      const key = startKey(it.x);
      const seen = starts.get(key) ?? new Set<number>();
      seen.add(rowIndex);
      starts.set(key, seen);
    }
  });
  const rowThreshold = rows.length >= 3 ? 3 : 2;
  const recurringColumns = new Set<number>();
  for (const [key, seenRows] of starts) {
    if (seenRows.size >= rowThreshold) recurringColumns.add(key);
  }


  const result: TextHit[] = [];
  const makeHit = (group: RawTextItem[], cell: boolean, gapBefore: number): TextHit => {
    const x = Math.min(...group.map((it) => it.x));
    const right = Math.max(...group.map((it) => it.x + it.w));
    const size = Math.max(...group.map((it) => it.size));
    let text = '';
    let previousRight = x;
    for (const it of group) {
      const gap = it.x - previousRight;
      if (text && gap > Math.max(1, it.size * 0.12)) {
        // Preserve a readable approximation for search/edit matching without
        // manufacturing a huge run of spaces across a table gap.
        text += ' '.repeat(Math.min(4, Math.max(1, Math.round(gap / Math.max(1, it.size * 0.3)))));
      }
      text += it.str;
      previousRight = Math.max(previousRight, it.x + it.w);
    }
    return { text, x, y: Math.min(...group.map((it) => it.y)) - size * 0.3, w: right - x, h: size * 1.2, size, color: '#161616', cell, gapBefore };
  };

  for (const row of rows) {
    // Split any run that spans recurring column boundaries into per-cell
    // fragments, then group fragments into cells. A boundary only counts when
    // THIS row actually has a separate cell item there — right-aligned runs
    // like "TOTAL DUE" share x-positions with OTHER rows' numbers but have no
    // cell of their own at that spot, so they must not be cut.
    const ownStarts = new Set(row.items.filter((i) => !(i as RowItem).frag).map((i) => startKey(i.x)));
    const rowCols = new Set<number>();
    for (const c of recurringColumns) if (ownStarts.has(startKey(c))) rowCols.add(c);
    const wide = splitWideItems(row.items, rowCols);
    const ordered = [...wide].sort((a, b) => a.x - b.x);
    let group: RawTextItem[] = [];
    let cell = false;
    let gapBefore = 0;
    let prevRight: number | null = null;
    for (const it of ordered) {
      const repeatedColumn = recurringColumns.has(startKey(it.x));
      const fragment = it.frag === true;
      if (group.length === 0) {
        group = [it];
        gapBefore = 0;
        prevRight = it.x + it.w;
        continue;
      }
      const prevR = prevRight;
      if (prevR === null) {
        group.push(it);
        prevRight = it.x + it.w;
        continue;
      }
      const gap = it.x - prevR;
      const largeGap = gap > Math.max(8, it.size * 1.6);
      // Fragments of a wide run are cells by construction: never merge them
      // with adjacent/overlapping items (the run tail overlaps the separate
      // cell's span). Only a genuinely wide gap joins them to a neighbor.
      const lastFrag = group[group.length - 1] && (group[group.length - 1] as RowItem).frag === true;
      const touchingFragment = (fragment || lastFrag) && gap < Math.max(8, it.size * 1.6);
      // A recurring column start marks a new cell ONLY when it carries a real
      // gap — right-aligned text like "TOTAL DUE" has runs whose x repeats
      // across rows, but they sit next to each other (2–3 pt apart), so they
      // must stay one line. A cell boundary needs roughly a full glyph width
      // of separation.
      const minCellGap = Math.max(8, it.size * 0.9);
      const newCell = (repeatedColumn || fragment) && gap > minCellGap && gap > -Math.max(1, it.size * 0.25);
      if (largeGap || newCell || touchingFragment) {
        result.push(makeHit(group, cell, gapBefore));
        group = [it];
        cell = repeatedColumn || fragment;
        gapBefore = Math.max(0, gap);
        prevRight = it.x + it.w;
        continue;
      }
      group.push(it);
      prevRight = Math.max(prevR, it.x + it.w);
    }
    if (group.length) result.push(makeHit(group, cell, gapBefore));
  }
  return result;
}
