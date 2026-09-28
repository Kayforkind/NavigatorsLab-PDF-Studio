/**
 * pdfstudio-core tests — every op exercised against generated PDFs.
 * Edit/redact tests assert the old text is gone from the RAW FILE BYTES,
 * not just from extraction (burned-in guarantee).
 */
import { describe, it, expect } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import {
  assertPdfBytes,
  pdfInfo,
  mergePdfs,
  splitPdf,
  rotatePages,
  arrangePages,
  extractText,
  searchText,
  editText,
  redactText,
  redactRects,
} from './index.js';

async function makePdf(pages: string[][]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) {
    const page = doc.addPage([600, 800]);
    let y = 750;
    for (const line of lines) {
      page.drawText(line, { x: 50, y, size: 14, font });
      y -= 20;
    }
  }
  return doc.save();
}

function rawHas(bytes: Uint8Array, s: string): boolean {
  let latin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    latin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CH)) as number[]);
  }
  return latin.includes(s);
}

describe('pdf basics', () => {
  it('rejects non-PDF input', () => {
    expect(() => assertPdfBytes(new Uint8Array([1, 2, 3]))).toThrow();
    expect(() => assertPdfBytes(new TextEncoder().encode('hello world, not a pdf'))).toThrow(/not a PDF/);
  });

  it('pdfInfo reports pages and geometry', async () => {
    const bytes = await makePdf([['a'], ['b', 'c']]);
    const info = await pdfInfo(bytes);
    expect(info.pages).toBe(2);
    expect(info.pageSizes[0].width).toBe(600);
    expect(info.pageSizes[0].rotation).toBe(0);
  });

  it('extractText + searchText', async () => {
    const bytes = await makePdf([['Alpha line one'], ['Beta line two']]);
    const pg = await extractText(bytes);
    expect(pg).toHaveLength(2);
    expect(pg[0].text).toContain('Alpha line one');
    const hits = await searchText(bytes, 'beta');
    expect(hits).toHaveLength(1);
    expect(hits[0].page).toBe(2);
    const hits2 = await searchText(bytes, 'BETA', { caseSensitive: true });
    expect(hits2).toHaveLength(0);
  });
});

describe('editText (true content-stream rewriting)', () => {
  it('replaces a whole line; old bytes gone from the file', async () => {
    const bytes = await makePdf([['Alpha line one', 'keep me']]);
    const r = await editText(bytes, { find: 'Alpha line one', replace: 'Omega line one' });
    expect(r.replacements).toHaveLength(1);
    expect(r.replacements[0].page).toBe(1);
    const pg = await extractText(r.bytes);
    expect(pg[0].text).toContain('Omega line one');
    expect(pg[0].text).toContain('keep me');
    expect(pg[0].text).not.toContain('Alpha');
    expect(rawHas(r.bytes, 'Alpha line one')).toBe(false);
  });

  it('replaces a substring inside a line', async () => {
    const bytes = await makePdf([['Invoice 12345 total']]);
    const r = await editText(bytes, { find: '12345', replace: '99999' });
    expect(r.replacements).toHaveLength(1);
    const pg = await extractText(r.bytes);
    expect(pg[0].text).toContain('99999');
    expect(pg[0].text).not.toContain('12345');
  });

  it('replace_all replaces every occurrence', async () => {
    const bytes = await makePdf([['foo bar'], ['foo baz']]);
    const r = await editText(bytes, { find: 'foo', replace: 'qux', all: true });
    expect(r.replacements).toHaveLength(2);
    const pg = await extractText(r.bytes);
    expect(pg.map((p) => p.text).join(' ')).not.toContain('foo');
  });

  it('reports no-match honestly', async () => {
    const bytes = await makePdf([['hello']]);
    const r = await editText(bytes, { find: 'zzz-nope', replace: 'x' });
    expect(r.replacements).toHaveLength(0);
  });

  it('empty replace deletes the line', async () => {
    const bytes = await makePdf([['delete me', 'keep me']]);
    const r = await editText(bytes, { find: 'delete me', replace: '' });
    expect(r.replacements).toHaveLength(1);
    const pg = await extractText(r.bytes);
    expect(pg[0].text).not.toContain('delete me');
    expect(pg[0].text).toContain('keep me');
  });
});

describe('redaction (burned-in)', () => {
  it('redactText deletes matched lines from raw bytes', async () => {
    const bytes = await makePdf([['public info', 'secret password hunter2', 'more public']]);
    const r = await redactText(bytes, { find: 'hunter2' });
    expect(r.removed).toBeGreaterThan(0);
    const pg = await extractText(r.bytes);
    expect(pg[0].text).not.toContain('hunter2');
    expect(pg[0].text).toContain('public info');
    expect(rawHas(r.bytes, 'hunter2')).toBe(false);
  });

  it('redactRects deletes fully-covered lines', async () => {
    const bytes = await makePdf([['nuke this line', 'spare this line']]);
    // line 1 box ~y746-762; line 2 ~y726-742 -> rect covers line 1 fully,
    // only touches line 2 (left intact by design)
    const r = await redactRects([{ page: 1, x: 40, y: 742, w: 400, h: 28 }], bytes);
    expect(r.removed).toBeGreaterThan(0);
    const pg = await extractText(r.bytes);
    expect(pg[0].text).not.toContain('nuke this line');
    expect(pg[0].text).toContain('spare this line');
    expect(rawHas(r.bytes, 'nuke this line')).toBe(false);
  });

  it('redact with no match changes nothing', async () => {
    const bytes = await makePdf([['hello']]);
    const r = await redactText(bytes, { find: 'zzz-nope' });
    expect(r.removed).toBe(0);
  });
});

describe('page ops', () => {
  it('merge concatenates in order', async () => {
    const a = await makePdf([['from-a']]);
    const b = await makePdf([['from-b'], ['from-b2']]);
    const out = await mergePdfs([a, b]);
    expect((await pdfInfo(out)).pages).toBe(3);
    const pg = await extractText(out);
    expect(pg[0].text).toContain('from-a');
    expect(pg[2].text).toContain('from-b2');
  });

  it('split produces one file per spec', async () => {
    const bytes = await makePdf([['p1'], ['p2'], ['p3']]);
    const parts = await splitPdf(bytes, ['1-2', '3']);
    expect(parts).toHaveLength(2);
    expect(parts[0].pages).toEqual([1, 2]);
    expect(parts[1].pages).toEqual([3]);
    expect((await pdfInfo(parts[0].bytes)).pages).toBe(2);
  });

  it('rotate sets rotation', async () => {
    const bytes = await makePdf([['a'], ['b']]);
    const r = await rotatePages(bytes, '1', 90);
    expect(r.pages).toEqual([1]);
    const info = await pdfInfo(r.bytes);
    expect(info.pageSizes[0].rotation).toBe(90);
    expect(info.pageSizes[1].rotation).toBe(0);
  });

  it('rejects non-90-multiple angles', async () => {
    const bytes = await makePdf([['a']]);
    await expect(rotatePages(bytes, '1', 45)).rejects.toThrow(/multiple of 90/);
  });

  it('arrangePages deletes', async () => {
    const bytes = await makePdf([['p1'], ['p2'], ['p3']]);
    const r = await arrangePages(bytes, { delete: '2' });
    expect(r.newOrder).toEqual([1, 3]);
    const pg = await extractText(r.bytes);
    expect(pg[0].text).toContain('p1');
    expect(pg[1].text).toContain('p3');
  });

  it('arrangePages reorders in listed order', async () => {
    const bytes = await makePdf([['p1'], ['p2'], ['p3']]);
    const r = await arrangePages(bytes, { order: '3,1' });
    expect(r.newOrder).toEqual([3, 1, 2]);
    const pg = await extractText(r.bytes);
    expect(pg[0].text).toContain('p3');
    expect(pg[1].text).toContain('p1');
  });
});
