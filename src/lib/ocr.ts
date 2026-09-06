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
 * The first run needs to download the ~15 MB eng traineddata (cached by the
 * browser afterwards). Rethrows with a friendly message when offline.
 */
export async function runOcr(canvas: HTMLCanvasElement, onStatus?: (msg: string) => void): Promise<OcrLine[]> {
  onStatus?.('Loading OCR engine…');
  let Tesseract: typeof import('tesseract.js');
  try {
    Tesseract = await import('tesseract.js');
  } catch (e) {
    throw new Error(`Could not load the OCR engine: ${e instanceof Error ? e.message : e}`);
  }
  let worker: import('tesseract.js').Worker;
  try {
    worker = await Tesseract.createWorker('eng', 1, {
      logger: (m: { status: string; progress: number }) => {
        if (m.status === 'recognizing text') onStatus?.(`Recognizing… ${Math.round((m.progress ?? 0) * 100)}%`);
        else if (m.status) onStatus?.(m.status);
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/fetch|network|offline|download|load/i.test(msg)) {
      throw new Error(
        'OCR needs a one-time download of its language data (~15 MB). Check the network connection; afterwards it runs fully offline. Your document never leaves this device.',
      );
    }
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
