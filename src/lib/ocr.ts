export interface OcrWord {
  text: string;
  /** coordinates in the input canvas pixel space */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  confidence: number;
}

export interface OcrLine {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  confidence: number;
}

/**
 * Recognizes text in a rendered page canvas fully locally (Tesseract WASM).
 * The engine (worker script, WASM cores and the eng model) ships with the app
 * under /tess and /tessdata — nothing is fetched from a CDN, so OCR works
 * offline and on fully air-gapped deployments.
 */
export async function runOcr(canvas: HTMLCanvasElement, onStatus?: (msg: string) => void): Promise<OcrLine[]> {
  onStatus?.('Loading OCR engine…');
  let Tesseract: typeof import('tesseract.js');
  try {
    Tesseract = await import('tesseract.js');
  } catch (e) {
    throw new Error(`Could not load the OCR engine: ${e instanceof Error ? e.message : e}`);
  }
  // Resolve engine asset roots against the deployed base (works at a site
  // root AND under a sub-path like GitHub Pages /repo/).
  const base: string = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
  const asset = (p: string) => new URL(`${base}${p}`, document.baseURI).href;
  let worker: import('tesseract.js').Worker;
  try {
    worker = await Tesseract.createWorker('eng', 1, {
      workerPath: asset('tess/worker.min.js'),
      corePath: asset('tess/'),
      langPath: asset('tessdata/'),
      logger: (m: { status: string; progress: number }) => {
        if (m.status === 'recognizing text') onStatus?.(`Recognizing… ${Math.round((m.progress ?? 0) * 100)}%`);
        else if (m.status) onStatus?.(m.status);
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`OCR engine failed to start: ${msg}`);
  }
  try {
    // tesseract.js v7 defaults `blocks: false` — without this override
    // recognize() returns only flat text and every page reads as "no
    // confident text". Request the block tree we group into lines.
    const data = await worker.recognize(canvas, {}, { blocks: true, text: true });
    const words: OcrWord[] = [];
    for (const block of data.data.blocks ?? []) {
      for (const para of block.paragraphs ?? []) {
        for (const line of para.lines ?? []) {
          for (const word of line.words ?? []) {
            const w = word.text.trim();
            if (!w) continue;
            words.push({
              text: w,
              x0: word.bbox.x0,
              y0: word.bbox.y0,
              x1: word.bbox.x1,
              y1: word.bbox.y1,
              confidence: word.confidence,
            });
          }
        }
      }
    }
    return groupToLines(words);
  } finally {
    try {
      await worker.terminate();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Groups flat OCR words into text lines.
 *
 * Geometry notes (learned from a real failure): a word's bbox TOP varies
 * with its letter shapes — "over" (x-height letters) sits ~0.3em lower than
 * "The" (cap + ascender) on the same baseline. Sorting or grouping by raw
 * y0 therefore scrambles reading order ("the lazy dog 1234567890over").
 * Row clustering uses bbox CENTERS, which are stable across glyph shapes,
 * and words are ordered left-to-right by x0 within each row.
 *
 * Word spacing: a genuine inter-word space is ~0.25em, while fragments of a
 * single word tesseract split apart sit ~0 apart. The gap threshold is a
 * small fraction of the median word height so normal spaces are kept
 * ("fox jumps", not "foxjumps") without gluing split fragments.
 */
export function groupToLines(words: OcrWord[]): OcrLine[] {
  interface Row { words: OcrWord[]; yc: number; h: number }
  const rows: Row[] = [];
  const byCenter = [...words].sort(
    (a, b) => (a.y0 + a.y1) - (b.y0 + b.y1) || a.x0 - b.x0,
  );
  for (const w of byCenter) {
    const yc = (w.y0 + w.y1) / 2;
    const h = Math.max(1, w.y1 - w.y0);
    let row = rows.find((r) => Math.abs(yc - r.yc) < Math.max(r.h, h) * 0.6);
    if (!row) {
      row = { words: [], yc, h };
      rows.push(row);
    }
    row.words.push(w);
    const n = row.words.length;
    row.yc = (row.yc * (n - 1) + yc) / n;
    row.h = Math.max(row.h, h);
  }
  const lines: OcrLine[] = [];
  for (const row of rows) {
    const ws = row.words.sort((a, b) => a.x0 - b.x0);
    const heights = ws.map((w) => w.y1 - w.y0).sort((a, b) => a - b);
    const medH = heights[Math.floor(heights.length / 2)] || 10;
    let text = '';
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    let conf = Infinity;
    for (const w of ws) {
      if (text && w.x0 - x1 > medH * 0.18) text += ' ';
      text += w.text;
      x0 = Math.min(x0, w.x0);
      y0 = Math.min(y0, w.y0);
      x1 = Math.max(x1, w.x1);
      y1 = Math.max(y1, w.y1);
      conf = Math.min(conf, w.confidence);
    }
    lines.push({ text, x0, y0, x1, y1, confidence: conf });
  }
  return lines
    .sort((a, b) => a.y0 - b.y0)
    .filter((l) => l.confidence >= 45 && l.text.trim().length > 0);
}
