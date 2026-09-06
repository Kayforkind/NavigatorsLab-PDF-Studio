import { getDocument } from 'pdfjs-dist';
import { GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;

export interface CompareLine {
  text: string;
  page: number;
}

export type DiffOp = 'same' | 'add' | 'del';

export interface DiffRow {
  op: DiffOp;
  left?: CompareLine;
  right?: CompareLine;
}

/** Extract per-line text of every page (pdf.js items grouped by baseline). */
export async function extractLines(bytes: Uint8Array): Promise<CompareLine[]> {
  const doc = await getDocument({ data: new Uint8Array(bytes) }).promise;
  const out: CompareLine[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i);
    const tc = await p.getTextContent();
    const items = (tc.items as Array<{ str?: string; transform?: number[]; width?: number; height?: number }>).filter(
      (it) => (it.str ?? '').trim() && it.transform && (it.width ?? 0) > 0,
    );
    // group by baseline y (rounded) in reading order
    const buckets = new Map<number, Array<{ str: string; x: number }>>();
    for (const it of items) {
      const y = Math.round(it.transform![5] / 2) * 2;
      const arr = buckets.get(y) ?? [];
      arr.push({ str: it.str!, x: it.transform![4] });
      buckets.set(y, arr);
    }
    const ys = [...buckets.keys()].sort((a, b) => b - a); // y-up: top first
    for (const y of ys) {
      const line = buckets
        .get(y)!
        .sort((a, b) => a.x - b.x)
        .map((s) => s.str)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (line) out.push({ text: line, page: i });
    }
  }
  await doc.destroy();
  return out;
}

/** Classic LCS diff — fine for documents up to a few thousand lines. */
export function diffLines(a: CompareLine[], b: CompareLine[]): DiffRow[] {
  const n = a.length;
  const m = b.length;
  // LCS table (n+1)x(m+1); guard memory
  const table: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i][j] = a[i].text === b[j].text ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i].text === b[j].text) {
      rows.push({ op: 'same', left: a[i], right: b[j] });
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      rows.push({ op: 'del', left: a[i] });
      i++;
    } else {
      rows.push({ op: 'add', right: b[j] });
      j++;
    }
  }
  while (i < n) rows.push({ op: 'del', left: a[i++] });
  while (j < m) rows.push({ op: 'add', right: b[j++] });
  return rows;
}

export interface CompareSummary {
  added: number;
  removed: number;
  same: number;
}

export function summarize(rows: DiffRow[]): CompareSummary {
  const s: CompareSummary = { added: 0, removed: 0, same: 0 };
  for (const r of rows) {
    if (r.op === 'add') s.added++;
    else if (r.op === 'del') s.removed++;
    else s.same++;
  }
  return s;
}
