/**
 * Text extraction for Node via pdfjs-dist's legacy build.
 *
 * pdf.js does the PDF parsing here — this module is a thin adapter:
 * getDocument + getTextContent, then a small geometric line grouper
 * (buckets by baseline y; presentation logic, not parsing).
 */
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { assertPdfBytes } from './pdf.js';

export interface PdfJsTextItem {
  str: string;
  transform: number[];
  hasEOL?: boolean;
}

export interface TextLine {
  text: string;
  /** x of line start, PDF user-space points */
  x: number;
  /** baseline y, PDF user-space points */
  y: number;
}

export interface PageText {
  page: number; // 1-based
  text: string;
  lines: TextLine[];
}

async function openDocument(bytes: Uint8Array) {
  assertPdfBytes(bytes);
  const task = pdfjs.getDocument({
    // Copy: pdf.js may detach/transfer the underlying buffer.
    data: bytes.slice().buffer as ArrayBuffer,
    isEvalSupported: false,
    useWorkerFetch: false,
    // pdf.js logs warnings via console.log -> process.stdout, which would
    // corrupt piped CLI output and the MCP stdio channel. Silence them;
    // real failures still surface as thrown exceptions.
    verbosity: pdfjs.VerbosityLevel.ERRORS,
  });
  return task.promise;
}

/** Group raw text items into lines by baseline proximity. */
export function groupItemsIntoLines(items: PdfJsTextItem[]): TextLine[] {
  const rows: Array<{ y: number; items: PdfJsTextItem[] }> = [];
  for (const it of items) {
    if (!it.str) continue;
    const y = it.transform[5];
    let row = rows.find((r) => Math.abs(r.y - y) <= 2);
    if (!row) {
      row = { y, items: [] };
      rows.push(row);
    }
    row.items.push(it);
  }
  rows.sort((a, b) => b.y - a.y);
  return rows.map((r) => {
    const sorted = [...r.items].sort((a, b) => a.transform[4] - b.transform[4]);
    return {
      text: sorted.map((i) => i.str).join(''),
      x: sorted[0]?.transform[4] ?? 0,
      y: r.y,
    };
  });
}

/**
 * Extract text. `pages` is an array of 1-based page numbers; omitted = all.
 */
export async function extractText(
  bytes: Uint8Array,
  pages?: number[],
): Promise<PageText[]> {
  const doc = await openDocument(bytes);
  try {
    const n = doc.numPages;
    const wanted =
      pages && pages.length > 0
        ? [...new Set(pages)].filter((p) => p >= 1 && p <= n).sort((a, b) => a - b)
        : Array.from({ length: n }, (_, i) => i + 1);
    if (wanted.length === 0) throw new Error('extract-text: page selection is empty');
    const out: PageText[] = [];
    for (const p of wanted) {
      const page = await doc.getPage(p);
      try {
        const tc = await page.getTextContent();
        const lines = groupItemsIntoLines(tc.items as unknown as PdfJsTextItem[]);
        out.push({ page: p, text: lines.map((l) => l.text).join('\n'), lines });
      } finally {
        page.cleanup();
      }
    }
    return out;
  } finally {
    await doc.destroy();
  }
}

export interface SearchOptions {
  caseSensitive?: boolean;
  /** max hits returned */
  limit?: number;
}

export interface SearchHit {
  page: number;
  line: number; // 1-based line index on the page
  snippet: string;
}

/** Case-insensitive substring search over extracted lines. */
export async function searchText(
  bytes: Uint8Array,
  query: string,
  opts: SearchOptions = {},
): Promise<SearchHit[]> {
  if (!query) throw new Error('search: query must not be empty');
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 5000);
  const pages = await extractText(bytes);
  const hits: SearchHit[] = [];
  const q = opts.caseSensitive ? query : query.toLowerCase();
  outer: for (const pg of pages) {
    pg.lines.forEach((ln, i) => {
      const hay = opts.caseSensitive ? ln.text : ln.text.toLowerCase();
      if (hay.includes(q)) {
        const t = ln.text.length > 160 ? ln.text.slice(0, 157) + '...' : ln.text;
        hits.push({ page: pg.page, line: i + 1, snippet: t });
        if (hits.length >= limit) return;
      }
    });
    if (hits.length >= limit) break outer;
  }
  return hits;
}
