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
    const data = await worker.recognize(canvas);
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

function groupToLines(words: OcrWord[]): OcrLine[] {
  const sorted = [...words].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const lines: OcrLine[] = [];
  for (const w of sorted) {
    let line = lines[lines.length - 1];
    const sameLine = line && Math.abs(w.y0 - line.y0) < Math.max(6, (line.y1 - line.y0) * 0.8);
    if (!sameLine) {
      line = { text: '', x0: w.x0, y0: w.y0, x1: w.x1, y1: w.y1, confidence: w.confidence };
      lines.push(line);
    }
    const gap = w.x0 - line.x1;
    if (line.text && gap > Math.max(2, (line.y1 - line.y0) * 0.4)) line.text += ' ';
    line.text += w.text;
    line.x0 = Math.min(line.x0, w.x0);
    line.y0 = Math.min(line.y0, w.y0);
    line.x1 = Math.max(line.x1, w.x1);
    line.y1 = Math.max(line.y1, w.y1);
    line.confidence = Math.min(line.confidence, w.confidence);
  }
  return lines.filter((l) => l.confidence >= 45 && l.text.trim().length > 0);
}
