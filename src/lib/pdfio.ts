import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type PDFPageProxy, type RenderTask } from 'pdfjs-dist';
import { PDFDocument as PdfLibDoc } from 'pdf-lib';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PageInfo, Source, TextHit } from '../types';

export * from './viewport';
export { parseRanges } from './ranges';

GlobalWorkerOptions.workerSrc = workerUrl;

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
  const js = await getDocument({ data: new Uint8Array(bytes) }).promise;
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

interface RawTextItem {
  str: string;
  /** baseline x/y in content space */
  x: number;
  y: number;
  w: number;
  size: number;
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

/** Groups raw runs that share a baseline into lines, returning editable hits. */
export function groupIntoLines(items: RawTextItem[]): TextHit[] {
  const lines: TextHit[] = [];
  for (const it of items) {
    let line = lines.find((l) => Math.abs(l.y - it.y) < Math.max(2, l.size * 0.45));
    if (!line) {
      line = { text: '', x: it.x, y: it.y, w: 0, h: it.size, size: it.size, color: '#161616' };
      lines.push(line);
    }
    const gap = it.x - (line.x + line.w);
    if (line.text && gap > 0) {
      line.text += ' '.repeat(Math.min(4, Math.max(1, Math.round(gap / (it.size * 0.3)))));
    }
    line.text += it.str;
    line.x = Math.min(line.x, it.x);
    line.w = Math.max(line.x + line.w, it.x + it.w) - line.x;
    line.size = Math.max(line.size, it.size);
    line.h = line.size * 1.2;
    line.y = it.y - line.size * 0.3;
  }
  return lines;
}
