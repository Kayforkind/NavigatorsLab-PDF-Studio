/// <reference types="vite/client" />
/**
 * pdf.js glue for the redaction checker.
 *
 * Renders each page to a canvas (all the geometry the detector needs is in
 * device pixels, so there is no PDF user-space math to get wrong), pulls the
 * text runs with their device-space advances, then hands both to the pure
 * detector.
 *
 * Runs entirely in the browser: the bytes come from a File object and are
 * never sent anywhere. The pdf.js worker is bundled by Vite.
 */
import { getDocument, GlobalWorkerOptions, type PDFPageProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  findSolidBoxes,
  findLeaks,
  toTextRuns,
  type PdfTextItem,
  type Raster,
  type SolidBox,
} from './detect.js';

GlobalWorkerOptions.workerSrc = workerUrl;

/** Render scale. 2× keeps glyph edges crisp enough to separate text from boxes. */
export const SCALE = 2;

export interface PageLeak {
  text: string;
  /** 0-based index into the page's boxes */
  box: number;
  frac: number;
  luma: number;
}

export interface PageReport {
  page: number;
  width: number;
  height: number;
  boxes: SolidBox[];
  leaks: PageLeak[];
}

export interface Report {
  pages: PageReport[];
  boxes: number;
  leaks: number;
  pagesWithLeaks: number[];
  scale: number;
}

export interface AnalyzeOptions {
  onProgress?: (done: number, total: number) => void;
}

async function renderPage(page: PDFPageProxy): Promise<{ raster: Raster; viewport: ReturnType<PDFPageProxy['getViewport']> }> {
  const viewport = page.getViewport({ scale: SCALE });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(viewport.width));
  canvas.height = Math.max(1, Math.ceil(viewport.height));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('could not acquire a 2D canvas context');
  // White underlay: PDFs with no explicit page background are transparent,
  // and a transparent page would make "is this pixel dark?" meaningless.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const raster: Raster = { data: img.data, width: img.width, height: img.height };
  // Release the backing store before the next page allocates one.
  canvas.width = 0;
  canvas.height = 0;
  return { raster, viewport };
}

/** Analyze PDF bytes. Never mutates or transmits them. */
export async function analyzePdf(
  bytes: Uint8Array,
  opts: AnalyzeOptions = {},
): Promise<Report> {
  const doc = await getDocument({ data: new Uint8Array(bytes) }).promise;
  const pages: PageReport[] = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const { raster, viewport } = await renderPage(page);
      const boxes = findSolidBoxes(raster);
      const tc = await page.getTextContent();
      const runs = toTextRuns(tc.items as PdfTextItem[], viewport);
      const leaks = boxes.length === 0 ? [] : findLeaks(runs, boxes, raster);
      pages.push({
        page: i,
        width: Math.round(viewport.width),
        height: Math.round(viewport.height),
        boxes,
        leaks: leaks.map((l) => ({ text: l.text, box: l.box, frac: l.frac, luma: l.luma })),
      });
      page.cleanup();
      opts.onProgress?.(i, doc.numPages);
    }
  } finally {
    await doc.destroy();
  }

  const boxes = pages.reduce((a, p) => a + p.boxes.length, 0);
  const leaks = pages.reduce((a, p) => a + p.leaks.length, 0);
  return {
    pages,
    boxes,
    leaks,
    pagesWithLeaks: pages.filter((p) => p.leaks.length > 0).map((p) => p.page),
    scale: SCALE,
  };
}

export type Verdict = 'leaks' | 'clean' | 'no-boxes';

export function verdictOf(report: Report): Verdict {
  if (report.leaks > 0) return 'leaks';
  if (report.boxes > 0) return 'clean';
  return 'no-boxes';
}

export const VERDICT_TEXT: Record<Verdict, string> = {
  leaks: 'LEAKS FOUND',
  clean: 'NOTHING RECOVERABLE',
  'no-boxes': 'NO SOLID BOXES FOUND',
};
