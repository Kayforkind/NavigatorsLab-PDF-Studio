/**
 * pdfstudio-core — document load/save, metadata, and page operations.
 *
 * Node-safe (no DOM): built on pdf-lib. The heavier content-stream engines
 * (true text rewriting, vector redaction) live in src/lib/textRewrite.ts and
 * are reused directly — see edit.ts.
 */
import { PDFDocument, degrees } from 'pdf-lib';
import { parseRanges } from '../../../src/lib/ranges.js';

/** Refuse absurd inputs before pdf-lib ever sees them (memory-bomb guard). */
export const MAX_INPUT_BYTES = 100 * 1024 * 1024;

export function assertPdfBytes(bytes: Uint8Array, label = 'input'): void {
  if (!(bytes instanceof Uint8Array)) throw new Error(`${label}: expected bytes`);
  if (bytes.length < 8) throw new Error(`${label}: too small to be a PDF`);
  let head = '';
  for (let i = 0; i < 5; i++) head += String.fromCharCode(bytes[i]);
  if (head !== '%PDF-') throw new Error(`${label}: not a PDF (missing %PDF- header)`);
  if (bytes.length > MAX_INPUT_BYTES) {
    throw new Error(`${label}: exceeds the 100 MB input limit`);
  }
}

export async function loadPdf(bytes: Uint8Array): Promise<PDFDocument> {
  assertPdfBytes(bytes);
  return PDFDocument.load(bytes, { ignoreEncryption: true });
}

export interface PageGeometry {
  width: number;
  height: number;
  rotation: number;
}

export interface PdfInfo {
  pages: number;
  pageSizes: PageGeometry[];
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
  creator?: string;
  producer?: string;
  creationDate?: string;
  modificationDate?: string;
}

function safeMeta(fn: () => string | undefined): string | undefined {
  try {
    const v = fn();
    return v || undefined;
  } catch {
    return undefined;
  }
}

export async function pdfInfo(bytes: Uint8Array): Promise<PdfInfo> {
  const doc = await loadPdf(bytes);
  const n = doc.getPageCount();
  const pageSizes: PageGeometry[] = [];
  for (let i = 0; i < n; i++) {
    const p = doc.getPage(i);
    const s = p.getSize();
    pageSizes.push({ width: s.width, height: s.height, rotation: p.getRotation().angle });
  }
  return {
    pages: n,
    pageSizes,
    title: safeMeta(() => doc.getTitle()),
    author: safeMeta(() => doc.getAuthor()),
    subject: safeMeta(() => doc.getSubject()),
    keywords: safeMeta(() => doc.getKeywords()),
    creator: safeMeta(() => doc.getCreator()),
    producer: safeMeta(() => doc.getProducer()),
    creationDate: safeMeta(() => doc.getCreationDate()?.toISOString()),
    modificationDate: safeMeta(() => doc.getModificationDate()?.toISOString()),
  };
}

/** Merge inputs in order. Every page of every input is preserved. */
export async function mergePdfs(inputs: Uint8Array[]): Promise<Uint8Array> {
  if (inputs.length === 0) throw new Error('merge: need at least one input PDF');
  if (inputs.length === 1) {
    const single = await loadPdf(inputs[0]);
    return single.save();
  }
  const out = await PDFDocument.create();
  for (const bytes of inputs) {
    const src = await loadPdf(bytes);
    const pages = await out.copyPages(src, src.getPageIndices());
    for (const p of pages) out.addPage(p);
  }
  return out.save();
}

/**
 * Split into one output per range spec, e.g. specs ["1-3", "4-5"].
 * Range syntax is the app's parseRanges: "1-3,5" (1-based, comma groups).
 */
export async function splitPdf(
  bytes: Uint8Array,
  specs: string[],
): Promise<Array<{ spec: string; pages: number[]; bytes: Uint8Array }>> {
  if (specs.length === 0) throw new Error('split: need at least one --ranges spec');
  const src = await loadPdf(bytes);
  const n = src.getPageCount();
  const outputs: Array<{ spec: string; pages: number[]; bytes: Uint8Array }> = [];
  for (const spec of specs) {
    const idxs = parseRanges(spec, n);
    if (idxs.length === 0) throw new Error(`split: range "${spec}" selects no pages`);
    const d = await PDFDocument.create();
    const pages = await d.copyPages(src, idxs);
    for (const p of pages) d.addPage(p);
    outputs.push({ spec, pages: idxs.map((i) => i + 1), bytes: await d.save() });
  }
  return outputs;
}

/** Rotate pages by a multiple of 90 degrees (clockwise). */
export async function rotatePages(
  bytes: Uint8Array,
  rangeSpec: string | undefined,
  angle: number,
): Promise<{ bytes: Uint8Array; pages: number[] }> {
  if (!Number.isFinite(angle) || angle % 90 !== 0) {
    throw new Error('rotate: --angle must be a multiple of 90');
  }
  const doc = await loadPdf(bytes);
  const n = doc.getPageCount();
  const idxs = parseRanges(rangeSpec?.trim() ? rangeSpec : `1-${n}`, n);
  if (idxs.length === 0) throw new Error('rotate: range selects no pages');
  for (const i of idxs) {
    const page = doc.getPage(i);
    const cur = page.getRotation().angle;
    page.setRotation(degrees(((cur + angle) % 360 + 360) % 360));
  }
  return { bytes: await doc.save(), pages: idxs.map((i) => i + 1) };
}

export interface PageSelection {
  /** 1-based page numbers in the desired output order. Pages not listed keep
   *  their relative order and are appended after the listed ones. */
  order?: string;
  /** 1-based ranges to drop, e.g. "2,5-7". Applied before --order. */
  delete?: string;
}

/**
 * Delete and/or reorder pages. Returns the new document bytes plus the
 * 1-based source page numbers in their new order (for reporting).
 */
export async function arrangePages(
  bytes: Uint8Array,
  sel: PageSelection,
): Promise<{ bytes: Uint8Array; newOrder: number[] }> {
  const src = await loadPdf(bytes);
  const n = src.getPageCount();
  let remaining = Array.from({ length: n }, (_, i) => i); // 0-based
  if (sel.delete?.trim()) {
    const drop = new Set(parseRanges(sel.delete, n));
    remaining = remaining.filter((i) => !drop.has(i));
    if (remaining.length === 0) throw new Error('pages: --delete removes every page');
  }
  if (sel.order?.trim()) {
    // Parse manually: parseRanges sorts, but --order must keep the LISTED order.
    const seq: number[] = [];
    for (const rawPart of sel.order.split(',')) {
      const part = rawPart.trim();
      if (!part) continue;
      const m = /^(\d+)\s*-\s*(\d+)$/.exec(part);
      if (m) {
        const a = parseInt(m[1], 10);
        const b = parseInt(m[2], 10);
        const step = a <= b ? 1 : -1;
        for (let v = a; step > 0 ? v <= b : v >= b; v += step) seq.push(v - 1);
      } else if (/^\d+$/.test(part)) {
        seq.push(parseInt(part, 10) - 1);
      } else {
        throw new Error(`pages: bad --order part "${part}"`);
      }
    }
    const seen = new Set<number>();
    const wanted: number[] = [];
    for (const i of seq) {
      if (i < 0 || i >= n || seen.has(i) || !remaining.includes(i)) continue;
      seen.add(i);
      wanted.push(i);
    }
    if (wanted.length === 0) throw new Error('pages: --order selects no pages');
    const rest = remaining.filter((i) => !seen.has(i));
    remaining = wanted.concat(rest);
  }
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, remaining);
  for (const p of pages) out.addPage(p);
  return { bytes: await out.save(), newOrder: remaining.map((i) => i + 1) };
}
