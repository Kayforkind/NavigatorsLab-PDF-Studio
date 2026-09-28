/** MCP server tests — handlers + path containment, no network, temp root. */
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { handlers, resolveWithin, createServer, type Ctx } from './index.js';

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

let root: string;
let ctx: Ctx;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pdfstudio-mcp-test-'));
  ctx = { root };
});

function put(name: string, bytes: Uint8Array): void {
  mkdirSync(join(root, 'docs'), { recursive: true });
  writeFileSync(join(root, name), Buffer.from(bytes));
}

describe('path containment', () => {
  it('allows paths inside the root', () => {
    expect(resolveWithin(root, 'docs/a.pdf')).toBe(join(root, 'docs/a.pdf'));
  });
  it('rejects .. escapes', () => {
    expect(() => resolveWithin(root, '../evil.pdf')).toThrow(/escapes/);
    expect(() => resolveWithin(root, 'docs/../../evil.pdf')).toThrow(/escapes/);
  });
  it('rejects absolute paths outside root', () => {
    expect(() => resolveWithin(root, '/etc/passwd')).toThrow(/escapes/);
  });
  it('rejects the root itself and NUL bytes', () => {
    expect(() => resolveWithin(root, '.')).toThrow();
    expect(() => resolveWithin(root, 'a\0b.pdf')).toThrow();
  });
});

describe('tool handlers', () => {
  it('pdf_info', async () => {
    put('a.pdf', await makePdf([['x'], ['y']]));
    const r = await handlers.pdf_info(ctx, { path: 'a.pdf' });
    expect(JSON.parse(r.content[0].text).pages).toBe(2);
  });

  it('pdf_extract_text marks output untrusted', async () => {
    put('a.pdf', await makePdf([['hello agent']]));
    const r = await handlers.pdf_extract_text(ctx, { path: 'a.pdf' });
    expect(r.content[0].text).toContain('UNTRUSTED');
    expect(r.content[0].text).toContain('hello agent');
  });

  it('pdf_search_text', async () => {
    put('a.pdf', await makePdf([['find the needle']]));
    const r = await handlers.pdf_search_text(ctx, { path: 'a.pdf', query: 'needle' });
    expect(r.content[0].text).toContain('p1');
  });

  it('pdf_edit_text writes output inside root', async () => {
    put('a.pdf', await makePdf([['Alpha beta']]));
    const r = await handlers.pdf_edit_text(ctx, {
      path: 'a.pdf',
      find: 'Alpha',
      replace: 'Gamma',
      output: 'out/edited.pdf',
    });
    expect(r.content[0].text).toContain('wrote');
    const back = readFileSync(join(root, 'out/edited.pdf'));
    expect(back.length).toBeGreaterThan(100);
  });

  it('pdf_edit_text refuses to write outside root', async () => {
    put('a.pdf', await makePdf([['Alpha']]));
    await expect(
      handlers.pdf_edit_text(ctx, { path: 'a.pdf', find: 'Alpha', replace: 'x', output: '../evil.pdf' }),
    ).rejects.toThrow(/escapes/);
  });

  it('pdf_redact_text burns text', async () => {
    put('a.pdf', await makePdf([['keep', 'burn hunter2']]));
    const r = await handlers.pdf_redact_text(ctx, { path: 'a.pdf', find: 'hunter2', output: 'red.pdf' });
    expect(r.content[0].text).toContain('BURNED-IN');
    const check = await handlers.pdf_search_text(ctx, { path: 'red.pdf', query: 'hunter2' });
    expect(check.content[0].text).toContain('no matches');
  });

  it('pdf_merge / pdf_split / pdf_rotate / pdf_pages', async () => {
    put('a.pdf', await makePdf([['A1']]));
    put('b.pdf', await makePdf([['B1']]));
    const m = await handlers.pdf_merge(ctx, { inputs: ['a.pdf', 'b.pdf'], output: 'm.pdf' });
    expect(m.content[0].text).toContain('wrote');
    const s = await handlers.pdf_split(ctx, { path: 'm.pdf', ranges: ['1', '2'], output_template: 's-%d.pdf' });
    expect(s.content[0].text).toContain('s-1.pdf');
    const ro = await handlers.pdf_rotate(ctx, { path: 'm.pdf', output: 'r.pdf', angle: 90 });
    expect(ro.content[0].text).toContain('90');
    const pg = await handlers.pdf_pages(ctx, { path: 'm.pdf', output: 'p.pdf', delete: '1' });
    expect(pg.content[0].text).toContain('2');
  });

  it('createServer registers the tools', () => {
    const server = createServer(root);
    expect(server).toBeDefined();
  });
});
