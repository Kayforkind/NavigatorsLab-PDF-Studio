import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist';
import type { DocState, PageRec } from '../types';
import { buildPdf } from './exportPdf';
import { makeSamplePdf } from './sample';

async function textsOf(bytes: Uint8Array): Promise<Array<{ page: number; text: string }>> {
  const doc = await getDocument({ data: new Uint8Array(bytes) }).promise;
  const out: Array<{ page: number; text: string }> = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i);
    const tc = await p.getTextContent();
    out.push({ page: i, text: (tc.items as Array<{ str?: string }>).map((it) => it.str ?? '').join(' ') });
  }
  await doc.destroy();
  return out;
}

async function makeDocState(): Promise<DocState> {
  const bytes = await makeSamplePdf();
  const lib = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const sourcePages = lib.getPages().map((p) => {
    const cb = p.getCropBox();
    return { w: cb.width, h: cb.height, bx: cb.x, by: cb.y, rot: p.getRotation().angle };
  });
  const source = { id: 'demo', name: 'demo.pdf', bytes, pages: sourcePages };
  const pageIds = sourcePages.map((_, i) => `pg${i}`);
  const pages: PageRec[] = sourcePages.map<PageRec>((p, i) => ({ id: pageIds[i], src: 'demo', page: i, w: p.w, h: p.h, bx: p.bx, by: p.by, rot: i === 1 ? 90 : 0 }));
  pages.push({ id: 'blank', src: null, page: null, w: 612, h: 792, bx: 0, by: 0, rot: 0 });
  const anns = [
    { id: 'a1', pageId: pageIds[0], type: 'text' as const, x: 60, y: 660, text: 'QUANTUM-CERT MARKER', size: 14, color: '#17171b' },
    { id: 'a2', pageId: pageIds[0], type: 'highlight' as const, x: 60, y: 600, w: 200, h: 20, color: '#ffd400', opacity: 0.4 },
    { id: 'a3', pageId: pageIds[1], type: 'edit' as const, x: 60, y: 500, w: 220, h: 18, text: 'REWRITTEN PARAGRAPH', size: 13, color: '#17171b', bg: '#ffffff' },
    { id: 'a4', pageId: 'blank', type: 'note' as const, x: 100, y: 600, text: 'hello', color: '#ffd43b', n: 1 },
  ];
  return { name: 'demo.pdf', sources: [source], pages, anns };
}

describe('buildPdf export', () => {
  it('exports pages, rotation, blanks and flattened annotations', async () => {
    const doc = await makeDocState();
    const { bytes, pages } = await buildPdf({
      doc,
      meta: { title: 'T', author: 'A', subject: 'S', keywords: 'k1, k2' },
      range: '',
    });
    expect(pages).toBe(doc.pages.length);

    const reload = await PDFDocument.load(bytes, { ignoreEncryption: true });
    expect(reload.getPageCount()).toBe(5); // 4 source pages + 1 blank
    const rots = reload.getPages().map((p) => p.getRotation().angle);
    expect(rots).toEqual([0, 90, 0, 0, 0]);
    expect(await reload.getTitle()).toBe('T');
    expect(await reload.getAuthor()).toBe('A');
    expect(await reload.getKeywords()).toBe('k1 k2');

    const texts = await textsOf(bytes);
    expect(texts[0].text).toContain('QUANTUM-CERT MARKER');
    expect(texts[1].text).toContain('REWRITTEN PARAGRAPH');
    // original content is preserved as well
    expect(texts[3].text).toContain('ONBOARDING CHECKLIST');
  });

  it('extracts a page range', async () => {
    const doc = await makeDocState();
    const { bytes, pages } = await buildPdf({ doc, meta: { title: '', author: '', subject: '', keywords: '' }, range: '2-3' });
    expect(pages).toBe(2);
    const reload = await PDFDocument.load(bytes, { ignoreEncryption: true });
    expect(reload.getPageCount()).toBe(2);
    const texts = await textsOf(bytes);
    expect(texts[0].text).toContain('REWRITTEN PARAGRAPH');
    expect(texts.map((t) => t.text).join(' ')).not.toContain('QUANTUM-CERT MARKER');
  });
});
