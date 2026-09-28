/** CLI command tests — exercise commands.ts without processes or the fs. */
import { describe, it, expect } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import {
  cmdInfo,
  cmdExtractText,
  cmdSearch,
  cmdEditText,
  cmdRedact,
  cmdMerge,
  cmdSplit,
  cmdRotate,
  cmdPages,
} from './commands.js';

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

describe('read-only commands', () => {
  it('info', async () => {
    const r = await cmdInfo(await makePdf([['a'], ['b']]), false);
    expect(r.text).toContain('Pages: 2');
    const j = await cmdInfo(await makePdf([['a']]), true);
    expect((j.json as { pages: number }).pages).toBe(1);
  });

  it('extract-text', async () => {
    const r = await cmdExtractText(await makePdf([['hello world']]), undefined, false);
    expect(r.text).toContain('hello world');
    expect(r.text).toContain('page 1');
  });

  it('search finds hits', async () => {
    const r = await cmdSearch(await makePdf([['needle in haystack']]), 'needle', false, false);
    expect(r.text).toContain('p1');
    expect((r.json as unknown[])).toHaveLength(1);
  });
});

describe('mutating commands', () => {
  it('edit-text replaces and reports', async () => {
    const r = await cmdEditText(await makePdf([['Alpha beta']]), {
      find: 'Alpha',
      replace: 'Gamma',
    });
    expect(r.noChange).toBe(false);
    expect(r.bytes).toBeDefined();
    expect(r.report).toContain('p1');
    // verify through the read path
    const back = await cmdExtractText(r.bytes!, undefined, false);
    expect(back.text).toContain('Gamma');
    expect(back.text).not.toContain('Alpha');
  });

  it('edit-text noChange when nothing matches', async () => {
    const r = await cmdEditText(await makePdf([['hello']]), { find: 'zzz', replace: 'x' });
    expect(r.noChange).toBe(true);
  });

  it('redact burns text', async () => {
    const r = await cmdRedact(await makePdf([['keep', 'burn hunter2 now']]), { find: 'hunter2' });
    expect(r.noChange).toBe(false);
    const back = await cmdExtractText(r.bytes!, undefined, false);
    expect(back.text).not.toContain('hunter2');
    expect(back.text).toContain('keep');
  });

  it('redact noChange when nothing matches', async () => {
    const r = await cmdRedact(await makePdf([['hello']]), { find: 'zzz' });
    expect(r.noChange).toBe(true);
  });

  it('merge / split / rotate / pages', async () => {
    const a = await makePdf([['A1']]);
    const b = await makePdf([['B1'], ['B2']]);
    const m = await cmdMerge([a, b]);
    expect(m.noChange).toBe(false);
    expect((await cmdInfo(m.bytes!, false)).text).toContain('Pages: 3');

    const parts = await cmdSplit(m.bytes!, ['1-2', '3']);
    expect(parts).toHaveLength(2);
    expect(parts[1].pages).toEqual([3]);

    const rot = await cmdRotate(parts[0].bytes, 90, '1');
    expect(rot.report).toContain('1 page(s)');

    const pg = await cmdPages(m.bytes!, { delete: '2' });
    expect((pg.json as { newOrder: number[] }).newOrder).toEqual([1, 3]);
  });

  it('pages requires an option', async () => {
    await expect(cmdPages(await makePdf([['a']]), {})).rejects.toThrow(/need --delete/);
  });
});
