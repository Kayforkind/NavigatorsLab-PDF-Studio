import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { PageRec, Point, Source } from '../types';
import { groupIntoLines, pageTextItems } from './pdfio';

export interface SearchMatch {
  pageId: string;
  /** 0-based index into doc.pages */
  pageIndex: number;
  /** content-space rect of the approximate matched span */
  rect: { x: number; y: number; w: number; h: number };
  snippet: string;
}

interface LineLike {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  size: number;
}

/**
 * Case-insensitive full-document search across text pages of the working doc.
 * Returns per-line matches with proportional sub-rects (good enough for
 * navigation highlighting).
 */
export async function searchDocument(
  query: string,
  pages: PageRec[],
  sources: Source[],
  proxies: ReadonlyMap<string, PDFDocumentProxy>,
): Promise<SearchMatch[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const out: SearchMatch[] = [];
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    if (!p.src || p.page === null) continue;
    const proxy = proxies.get(p.src);
    if (!proxy) continue;
    try {
      const pp = await proxy.getPage(p.page + 1);
      const items = await pageTextItems(pp);
      const lines = groupIntoLines(items) as unknown as LineLike[];
      for (const ln of lines) {
        const hay = ln.text.toLowerCase();
        let from = 0;
        for (;;) {
          const at = hay.indexOf(q, from);
          if (at < 0) break;
          // proportional x-offset of the match inside the line
          const before = ln.text.slice(0, at);
          const whole = ln.text;
          const x0 = ln.x + (ln.w * before.length) / Math.max(1, whole.length);
          const w = (ln.w * q.length) / Math.max(1, whole.length);
          out.push({
            pageId: p.id,
            pageIndex: i,
            rect: { x: x0, y: ln.y, w, h: ln.h },
            snippet: whole.slice(Math.max(0, at - 16), Math.min(whole.length, at + q.length + 16)).trim(),
          });
          from = at + q.length;
          if (out.length > 500) return out; // hard cap
        }
      }
    } catch {
      /* page unreadable — skip */
    }
  }
  return out;
}

export type { Point };
