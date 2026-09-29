import { describe, it, expect } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRef } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist';
import { planVectorRedaction, installStream, recognizePageText } from './textRewrite';
import { buildPdf } from './exportPdf';
import type { DocState } from '../types';

// Phase-1 redaction-truth tests (2026-09-29): the vector redaction engine
// now RECURSES into Form XObjects instead of refusing the vector path.
// These tests build evil PDFs with pdf-lib and assert the redacted secrets
// are gone from the exported bytes (via pdfjs text extraction), plus the
// cases that must still force the raster path (return null) or refuse loudly.

function helvRef(doc: PDFDocument): PDFRef {
  return doc.context.register(
    doc.context.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica' }),
  );
}

function formRef(doc: PDFDocument, content: string, extraResources: Record<string, unknown> = {}): PDFRef {
  return doc.context.register(
    doc.context.stream(content, {
      Type: 'XObject',
      Subtype: 'Form',
      BBox: [0, 0, 400, 300],
      Resources: { Font: { F1: helvRef(doc) }, ...extraResources },
    }),
  );
}

function imageRef(doc: PDFDocument): PDFRef {
  // Minimal image XObject stand-in: detection only reads /Subtype, so the
  // pixel data never needs to be valid for these engine-level tests.
  return doc.context.register(
    doc.context.stream(new Uint8Array([0]), {
      Type: 'XObject',
      Subtype: 'Image',
      Width: PDFNumber.of(1),
      Height: PDFNumber.of(1),
      ColorSpace: 'DeviceGray',
      BitsPerComponent: PDFNumber.of(1),
    }),
  );
}

async function textsOf(bytes: Uint8Array): Promise<string[]> {
  const doc = await getDocument({ data: new Uint8Array(bytes) }).promise;
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i);
    const tc = await p.getTextContent();
    out.push((tc.items as Array<{ str?: string }>).map((it) => it.str ?? '').join(' '));
  }
  await doc.destroy();
  return out;
}

describe('recursive Form-XObject redaction', () => {
  it('vector plan removes text inside a Form XObject (secret gone from export)', async () => {
    const doc = await PDFDocument.create();
    const font = helvRef(doc);
    const form = formRef(doc, 'BT /F1 14 Tf 50 100 Td (XOBJECT SECRET) Tj ET');
    const page = doc.addPage([400, 300]);
    page.node.set(
      PDFName.of('Resources'),
      doc.context.obj({ Font: { F1: font }, XObject: { Fm1: form } }),
    );
    page.node.addContentStream(
      doc.context.register(
        doc.context.stream('BT /F1 14 Tf 50 200 Td (TOPLEVEL VISIBLE) Tj ET /Fm1 Do'),
      ),
    );
    const bytes = await doc.save();
    const lib = await PDFDocument.load(bytes);

    // Rect covers the XObject text (form space == page space here) but not
    // the top-level line at y=200.
    const plan = planVectorRedaction(lib, 0, [{ x: 40, y: 90, w: 200, h: 30 }]);
    expect(plan).not.toBeNull();
    expect(plan!.removed).toBeGreaterThanOrEqual(1);
    installStream(lib, 0, plan!.bytes);
    const out = await lib.save();
    const texts = await textsOf(out);
    expect(texts[0]).not.toContain('XOBJECT SECRET');
    expect(texts[0]).toContain('TOPLEVEL VISIBLE');
  });

  it('redacts text inside nested Forms (two levels)', async () => {
    const doc = await PDFDocument.create();
    const font = helvRef(doc);
    const inner = formRef(doc, 'BT /F1 14 Tf 50 100 Td (NESTED SECRET) Tj ET');
    const outer = doc.context.register(
      doc.context.stream('q 1 0 0 1 20 30 cm /Fm2 Do Q', {
        Type: 'XObject',
        Subtype: 'Form',
        BBox: [0, 0, 400, 300],
        Resources: { Font: { F1: helvRef(doc) }, XObject: { Fm2: inner } },
      }),
    );
    const page = doc.addPage([400, 300]);
    page.node.set(
      PDFName.of('Resources'),
      doc.context.obj({ Font: { F1: font }, XObject: { Fm1: outer } }),
    );
    page.node.addContentStream(doc.context.register(doc.context.stream('/Fm1 Do')));
    const bytes = await doc.save();
    const lib = await PDFDocument.load(bytes);

    // Inner text lands at page space (50+20, 100+30) = (70,130).
    const plan = planVectorRedaction(lib, 0, [{ x: 60, y: 120, w: 220, h: 30 }]);
    expect(plan).not.toBeNull();
    installStream(lib, 0, plan!.bytes);
    const texts = await textsOf(await lib.save());
    expect(texts[0]).not.toContain('NESTED SECRET');
  });

  it('leaves a shared XObject untouched on the unredacted page', async () => {
    const doc = await PDFDocument.create();
    const font = helvRef(doc);
    const form = formRef(doc, 'BT /F1 14 Tf 50 100 Td (SHARED SECRET) Tj ET');
    for (let i = 0; i < 2; i++) {
      const page = doc.addPage([400, 300]);
      page.node.set(
        PDFName.of('Resources'),
        doc.context.obj({ Font: { F1: font }, XObject: { Fm1: form } }),
      );
      page.node.addContentStream(doc.context.register(doc.context.stream('/Fm1 Do')));
    }
    const bytes = await doc.save();
    const lib = await PDFDocument.load(bytes);

    const plan = planVectorRedaction(lib, 0, [{ x: 40, y: 90, w: 220, h: 30 }]);
    expect(plan).not.toBeNull();
    installStream(lib, 0, plan!.bytes);

    // Page 1's resources must now point at a CLONE; page 2 keeps the original.
    const r1 = lib.getPage(0).node.Resources()!.lookupMaybe(PDFName.of('XObject'), PDFDict)!.get(PDFName.of('Fm1'));
    const r2 = lib.getPage(1).node.Resources()!.lookupMaybe(PDFName.of('XObject'), PDFDict)!.get(PDFName.of('Fm1'));
    expect((r1 as PDFRef).toString()).not.toBe((r2 as PDFRef).toString());

    const texts = await textsOf(await lib.save());
    expect(texts[0]).not.toContain('SHARED SECRET');
    expect(texts[1]).toContain('SHARED SECRET');
  });

  it('redacts a page whose text lives ONLY inside a Form (no top-level text)', async () => {
    const doc = await PDFDocument.create();
    const form = formRef(doc, 'BT /F1 14 Tf 50 100 Td (ONLY IN FORM) Tj ET');
    const page = doc.addPage([400, 300]);
    page.node.set(
      PDFName.of('Resources'),
      doc.context.obj({ Font: { F1: helvRef(doc) }, XObject: { Fm1: form } }),
    );
    page.node.addContentStream(doc.context.register(doc.context.stream('/Fm1 Do')));
    const lib = await PDFDocument.load(await doc.save());

    const plan = planVectorRedaction(lib, 0, [{ x: 40, y: 90, w: 220, h: 30 }]);
    expect(plan).not.toBeNull();
    installStream(lib, 0, plan!.bytes);
    const texts = await textsOf(await lib.save());
    expect(texts[0]).not.toContain('ONLY IN FORM');
  });
});

describe('vector-path refusals (must return null → raster)', () => {
  async function libOf(build: (doc: PDFDocument) => Promise<void>): Promise<PDFDocument> {
    const doc = await PDFDocument.create();
    await build(doc);
    return PDFDocument.load(await doc.save());
  }

  it('still refuses when an image XObject is reachable through a Form', async () => {
    const lib = await libOf(async (doc) => {
      const font = helvRef(doc);
      const form = doc.context.register(
        doc.context.stream('BT /F1 14 Tf 50 100 Td (BEHIND IMAGE) Tj ET /Im1 Do', {
          Type: 'XObject',
          Subtype: 'Form',
          BBox: [0, 0, 400, 300],
          Resources: { Font: { F1: helvRef(doc) }, XObject: { Im1: imageRef(doc) } },
        }),
      );
      const page = doc.addPage([400, 300]);
      page.node.set(
        PDFName.of('Resources'),
        doc.context.obj({ Font: { F1: font }, XObject: { Fm1: form } }),
      );
      page.node.addContentStream(doc.context.register(doc.context.stream('/Fm1 Do')));
    });
    expect(planVectorRedaction(lib, 0, [{ x: 0, y: 0, w: 400, h: 300 }])).toBeNull();
  });

  it('refuses Type0/CID text (hasUnrecognizedText)', async () => {
    const lib = await libOf(async (doc) => {
      const cidFont = doc.context.register(
        doc.context.obj({
          Type: 'Font',
          Subtype: 'Type0',
          BaseFont: 'CIDFont',
          Encoding: 'Identity-H',
          DescendantFonts: [],
        }),
      );
      const page = doc.addPage([400, 300]);
      page.node.set(PDFName.of('Resources'), doc.context.obj({ Font: { F1: cidFont } }));
      page.node.addContentStream(
        doc.context.register(doc.context.stream('BT /F1 14 Tf 50 200 Td <FEFF0041> Tj ET')),
      );
    });
    const rec = recognizePageText(lib, 0);
    expect(rec!.hasUnrecognizedText).toBe(true);
    expect(planVectorRedaction(lib, 0, [{ x: 0, y: 0, w: 400, h: 300 }])).toBeNull();
  });

  it('refuses /Pattern resources', async () => {
    const lib = await libOf(async (doc) => {
      const font = helvRef(doc);
      const pat = doc.context.register(
        doc.context.stream('BT /F1 10 Tf 0 0 Td (pat) Tj ET', {
          Type: 'Pattern',
          PatternType: 1,
          PaintType: 1,
          TilingType: 1,
          BBox: [0, 0, 10, 10],
          XStep: 10,
          YStep: 10,
          Resources: { Font: { F1: helvRef(doc) } },
        }),
      );
      const page = doc.addPage([400, 300]);
      page.node.set(
        PDFName.of('Resources'),
        doc.context.obj({ Font: { F1: font }, Pattern: { P1: pat } }),
      );
      page.node.addContentStream(
        doc.context.register(doc.context.stream('BT /F1 14 Tf 50 200 Td (PATTERN PAGE) Tj ET')),
      );
    });
    const rec = recognizePageText(lib, 0);
    expect(rec!.hasPatterns).toBe(true);
    expect(planVectorRedaction(lib, 0, [{ x: 40, y: 190, w: 200, h: 30 }])).toBeNull();
  });

  it('refuses inline images (BI…EI)', async () => {
    const lib = await libOf(async (doc) => {
      const font = helvRef(doc);
      const page = doc.addPage([400, 300]);
      page.node.set(PDFName.of('Resources'), doc.context.obj({ Font: { F1: font } }));
      const bin = new Uint8Array([66, 73, 32, 47, 87, 32, 49, 32, 47, 72, 32, 49, 32, 73, 68, 32, 0, 32, 69, 73]);
      // "BT … Tj ET q BI /W 1 /H 1 ID <0> EI Q" — the BI operator marks it.
      const head = new TextEncoder().encode('BT /F1 14 Tf 50 200 Td (INLINE PAGE) Tj ET q 10 0 0 10 50 50 cm\n');
      const tail = new TextEncoder().encode('\nQ');
      const stream = new Uint8Array(head.length + bin.length + tail.length);
      stream.set(head, 0);
      stream.set(bin, head.length);
      stream.set(tail, head.length + bin.length);
      page.node.addContentStream(doc.context.register(doc.context.stream(stream)));
    });
    const rec = recognizePageText(lib, 0);
    expect(rec!.hasInlineImages).toBe(true);
    expect(planVectorRedaction(lib, 0, [{ x: 40, y: 190, w: 200, h: 30 }])).toBeNull();
  });

  it('keeps the vector path for plain pages without Forms', async () => {
    const doc = await PDFDocument.create();
    const font = helvRef(doc);
    const page = doc.addPage([400, 300]);
    page.node.set(PDFName.of('Resources'), doc.context.obj({ Font: { F1: font } }));
    page.node.addContentStream(
      doc.context.register(doc.context.stream('BT /F1 14 Tf 50 200 Td (PLAIN TOPLEVEL) Tj ET')),
    );
    const lib = await PDFDocument.load(await doc.save());
    const plan = planVectorRedaction(lib, 0, [{ x: 40, y: 190, w: 200, h: 30 }]);
    expect(plan).not.toBeNull();
    expect(plan!.removed).toBeGreaterThanOrEqual(1);
  });
});

describe('annotation sanitization + hard refusal (buildPdf)', () => {
  async function sourceWithAnnot(): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const font = helvRef(doc);
    const page = doc.addPage([400, 300]);
    page.node.set(PDFName.of('Resources'), doc.context.obj({ Font: { F1: font } }));
    page.node.addContentStream(
      doc.context.register(
        doc.context.stream('BT /F1 14 Tf 50 200 Td (REDACT ME) Tj ET BT /F1 14 Tf 50 100 Td (KEEP THIS) Tj ET'),
      ),
    );
    // A real PDF text annotation sitting under the future redact box.
    const annot = doc.context.obj({
      Type: 'Annot',
      Subtype: 'Text',
      Rect: [40, 190, 140, 215],
      Contents: 'ANNOT SECRET',
      C: [1, 1, 0],
    });
    const arr = PDFArray.withContext(doc.context);
    arr.push(doc.context.register(annot));
    page.node.set(PDFName.of('Annots'), doc.context.register(arr));
    return doc.save();
  }

  function docStateFor(srcBytes: Uint8Array, anns: DocState['anns']): DocState {
    return {
      name: 'evil.pdf',
      sources: [{ id: 's1', name: 'evil.pdf', bytes: srcBytes, pages: [{ w: 400, h: 300, bx: 0, by: 0, rot: 0 }] }],
      pages: [{ id: 'pg0', src: 's1', page: 0, w: 400, h: 300, bx: 0, by: 0, rot: 0 }],
      anns,
    };
  }

  it('strips a source annotation under the redact box (vector path)', async () => {
    const src = await sourceWithAnnot();
    const doc = docStateFor(src, [
      { id: 'r1', pageId: 'pg0', type: 'redact', x: 30, y: 180, w: 200, h: 40, color: '#101014', opacity: 1 },
      // An app text annotation under the box must not be drawn either.
      { id: 't1', pageId: 'pg0', type: 'text', x: 60, y: 195, text: 'APP SECRET', size: 12, color: '#17171b' },
    ]);
    // No proxies: the vector path must fully handle this page.
    const { bytes } = await buildPdf({ doc, meta: { title: '', author: '', subject: '', keywords: '' }, range: '' });
    const texts = await textsOf(bytes);
    expect(texts[0]).not.toContain('REDACT ME');
    expect(texts[0]).not.toContain('APP SECRET');
    expect(texts[0]).toContain('KEEP THIS');
    // The source /Annots entry is gone from the exported page.
    const reload = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const annots = reload.getPage(0).node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    expect(annots === undefined || annots.size() === 0).toBe(true);
    // Raw-byte check: neither secret survives anywhere in the file.
    const raw = new TextDecoder('latin1').decode(bytes);
    expect(raw).not.toContain('ANNOT SECRET');
    expect(raw).not.toContain('APP SECRET');
  });

  it('throws redaction-failed when neither vector nor raster can complete', async () => {
    const doc = await PDFDocument.create();
    const font = helvRef(doc);
    const page = doc.addPage([400, 300]);
    page.node.set(
      PDFName.of('Resources'),
      doc.context.obj({ Font: { F1: font }, XObject: { Im1: imageRef(doc) } }),
    );
    page.node.addContentStream(
      doc.context.register(doc.context.stream('BT /F1 14 Tf 50 200 Td (PHOTO SECRET) Tj ET /Im1 Do')),
    );
    const src = await doc.save();
    const state = docStateFor(src, [
      { id: 'r1', pageId: 'pg0', type: 'redact', x: 0, y: 0, w: 400, h: 300, color: '#101014', opacity: 1 },
    ]);
    // No proxies → raster unavailable; vector refused (image XObject).
    await expect(
      buildPdf({ doc: state, meta: { title: '', author: '', subject: '', keywords: '' }, range: '' }),
    ).rejects.toThrow(/redaction-failed: page 1 could not be securely redacted/);
  });
});
