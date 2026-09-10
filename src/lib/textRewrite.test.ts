import { describe, it, expect } from 'vitest';
import { PDFDocument, StandardFonts, PDFName, PDFArray, decodePDFRawStream } from 'pdf-lib';
import { planDeepEdit, planVectorRedaction, installStream, tokenizeContent, collectShowSegments } from './textRewrite';

async function buildSample(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const times = await doc.embedFont(StandardFonts.TimesRoman);
  const p = doc.addPage([400, 300]);
  p.drawText('QUANTUM-CERT MARKER', { x: 50, y: 200, size: 14, font: helv });
  p.drawText('Second line here', { x: 50, y: 150, size: 12, font: times });
  return doc.save();
}

async function streamTextOf(bytes: Uint8Array): Promise<string> {
  const lib = await PDFDocument.load(bytes);
  const contents = lib.getPage(0).node.get(PDFName.of('Contents'));
  const raw = contents instanceof PDFArray ? contents.get(0) : contents;
  const resolved = lib.context.lookup(raw) as import('pdf-lib').PDFRawStream;
  return new TextDecoder('latin1').decode(decodePDFRawStream(resolved).decode());
}

describe('tokenizeContent', () => {
  it('tokenizes operators, numbers, names and strings with spans', () => {
    const src = new TextEncoder().encode('BT /F1 12 Tf 72 700 Td (Hi\\)there) Tj <4869> Tj ET');
    const toks = tokenizeContent(src);
    const ops = toks.filter((t) => t.kind === 'op').map((t) => t.value);
    expect(ops).toEqual(['BT', 'Tf', 'Td', 'Tj', 'Tj', 'ET']);
    const str = toks.find((t) => t.kind === 'str');
    expect(str?.value).toBe('Hi)there');
    const hex = toks.find((t) => t.kind === 'hex');
    expect(new TextDecoder().decode(hex!.bytes)).toBe('Hi');
  });
});

describe('collectShowSegments', () => {
  it('records origins and sizes for show ops', () => {
    const src = new TextEncoder().encode('BT /F1 14 Tf 1 0 0 1 50 200 Tm (Hello) Tj 0 -20 Td (World) Tj ET');
    const toks = tokenizeContent(src);
    const { segments } = collectShowSegments(src, toks);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({ font: 'F1', size: 14, tx: 50, ty: 200 });
    expect(segments[1]).toMatchObject({ tx: 50, ty: 180 });
  });
});

describe('planDeepEdit', () => {
  it('rewrites the clicked line and leaves the other intact', async () => {
    const bytes = await buildSample();
    const lib = await PDFDocument.load(bytes);
    const plan = planDeepEdit(lib, 0, { hit: { x: 50, y: 200, w: 150, h: 17, text: 'QUANTUM-CERT MARKER' }, newText: 'EDITED-OK' });
    expect(plan).not.toBeNull();
    installStream(lib, 0, plan!.bytes);
    const out = await lib.save();
    const s = await streamTextOf(out);
    expect(s).toContain('<4544495445442d4f4b>'); // 'EDITED-OK' hex
    expect(s).not.toContain('5155414E54554D2D43455254204D41524B4552'); // old marker bytes gone
    // the OTHER line must survive
    const lib2 = await PDFDocument.load(out);
    const plan2 = planDeepEdit(lib2, 0, { hit: { x: 50, y: 150, w: 100, h: 15, text: 'Second line here' }, newText: 'Second line here' });
    expect(plan2).not.toBeNull();
    expect(plan2!.matched.text).toBe('Second line here');
  });

  it('deletes the line when newText is null', async () => {
    const bytes = await buildSample();
    const lib = await PDFDocument.load(bytes);
    const plan = planDeepEdit(lib, 0, { hit: { x: 50, y: 200, w: 150, h: 17, text: 'QUANTUM-CERT MARKER' }, newText: null });
    expect(plan).not.toBeNull();
    installStream(lib, 0, plan!.bytes);
    const out = await lib.save();
    const s = await streamTextOf(out);
    expect(s).not.toContain('5155414E54554D2D43455254204D41524B4552');
  });

  it('returns null when no line matches', async () => {
    const bytes = await buildSample();
    const lib = await PDFDocument.load(bytes);
    const plan = planDeepEdit(lib, 0, { hit: { x: 300, y: 20, w: 30, h: 10, text: 'zzz-nonexistent' }, newText: 'x' });
    expect(plan).toBeNull();
  });
});

describe('planVectorRedaction', () => {
  it('removes only the fully covered line', async () => {
    const bytes = await buildSample();
    const lib = await PDFDocument.load(bytes);
    // cover the first line (y 200..217) generously
    const plan = planVectorRedaction(lib, 0, [{ x: 40, y: 195, w: 200, h: 30 }]);
    expect(plan).not.toBeNull();
    expect(plan!.removed).toBe(1);
    installStream(lib, 0, plan!.bytes);
    const out = await lib.save();
    const s = await streamTextOf(out);
    expect(s).not.toContain('5155414E54554D2D43455254204D41524B4552');
    // second line untouched
    const lib2 = await PDFDocument.load(out);
    const rec = planDeepEdit(lib2, 0, { hit: { x: 50, y: 150, w: 100, h: 15, text: 'Second line here' }, newText: 'Second line here' });
    expect(rec).not.toBeNull();
  });
});
