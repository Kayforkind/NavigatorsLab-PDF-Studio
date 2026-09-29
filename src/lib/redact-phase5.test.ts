/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFString } from 'pdf-lib';
import { inflateSync } from 'node:zlib';
import { getDocument } from 'pdfjs-dist';
import { buildPdf, scrubRedactionArtifacts } from './exportPdf';
import { sanitizeAcroFormUnderRects, sanitizeStructureTree } from './textRewrite';
import { verifyRedactedExport } from './redactVerify';
import type { DocState, PageRec } from '../types';

// Phase-5 redaction-truth fixtures (2026-09-29): evil PDFs built with
// pdf-lib, each carrying a secret in one of the covered channels. Every
// fixture asserts the secret is ABSENT from the exported bytes — the
// verification gate refuses delivery otherwise.

// ---------------------------------------------------------------- helpers

function helvRef(doc: PDFDocument): PDFRef {
  return doc.context.register(
    doc.context.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica' }),
  );
}

function latin1(bytes: Uint8Array): string {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    s += String.fromCharCode(...bytes.subarray(i, i + CH));
  }
  return s;
}

/**
 * Honest content-stream assertion helper: decode every page content stream
 * (inflating /FlateDecode) and return the concatenated text. A raw-byte
 * `not.toContain` on the file can pass vacuously when the stream is
 * compressed — this cannot.
 */
async function decodedPageStreams(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  let out = '';
  for (const page of doc.getPages()) {
    const contents = page.node.get(PDFName.of('Contents'));
    const refs: PDFRef[] = [];
    if (contents instanceof PDFRef) refs.push(contents);
    else if (contents instanceof PDFArray) {
      for (let i = 0; i < contents.size(); i++) {
        const r = contents.get(i);
        if (r instanceof PDFRef) refs.push(r);
      }
    }
    for (const ref of refs) {
      const stream = doc.context.lookup(ref);
      if (!(stream instanceof PDFRawStream)) continue;
      const raw = stream.getContents();
      const filter = stream.dict.get(PDFName.of('Filter'));
      const isFlate =
        (filter instanceof PDFName && filter.asString() === '/FlateDecode') ||
        (filter instanceof PDFArray &&
          Array.from({ length: filter.size() }, (_, i) => filter.get(i)).some(
            (f) => f instanceof PDFName && f.asString() === '/FlateDecode',
          ));
      try {
        out += latin1(isFlate ? inflateSync(raw) : raw) + '\n';
      } catch {
        out += latin1(raw) + '\n';
      }
    }
  }
  return out;
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

function docStateFor(
  srcBytes: Uint8Array,
  rects: Array<{ x: number; y: number; w: number; h: number }>,
  name = 'evil.pdf',
): DocState {
  const pages: PageRec[] = [{ id: 'pg0', src: 's0', page: 0, w: 400, h: 300, bx: 0, by: 0, rot: 0 }];
  return {
    name,
    sources: [{ id: 's0', name, bytes: srcBytes, pages: [{ w: 400, h: 300, bx: 0, by: 0, rot: 0 }] }],
    pages,
    anns: rects.map((r, i) => ({
      id: `r${i}`,
      pageId: 'pg0',
      type: 'redact' as const,
      x: r.x,
      y: r.y,
      w: r.w,
      h: r.h,
      color: '#000000',
      opacity: 1,
    })),
  };
}

const EMPTY_META = { title: '', author: '', subject: '', keywords: '' };

// ---------------------------------------------------------------- fixtures

describe('phase-5 redaction truth', () => {
  it('fixture 1: metadata, XMP, attachments, JavaScript and thumbnails are scrubbed from redacted exports', async () => {
    const doc = await PDFDocument.create();
    const font = helvRef(doc);
    const page = doc.addPage([400, 300]);
    page.node.set(PDFName.of('Resources'), doc.context.obj({ Font: { F1: font } }));
    page.node.addContentStream(
      doc.context.register(doc.context.stream('BT /F1 14 Tf 50 200 Td (REDACTTHIS) Tj ET')),
    );
    // Info dictionary
    doc.setAuthor('AUTHORSECRET');
    doc.setTitle('TITLESECRET');
    // XMP metadata stream
    const xmp = doc.context.register(
      doc.context.stream('<x:xmpmeta>XMPPSECRET</x:xmpmeta>', { Type: 'Metadata', Subtype: 'XML' }),
    );
    doc.catalog.set(PDFName.of('Metadata'), xmp);
    // Embedded file
    const efStream = doc.context.register(
      doc.context.stream('ATTACHSECRET file payload', { Type: 'EmbeddedFile' }),
    );
    const fileSpec = doc.context.register(
      doc.context.obj({ Type: 'Filespec', F: 'secret.txt', EF: doc.context.obj({ F: efStream }) }),
    );
    doc.catalog.set(
      PDFName.of('Names'),
      doc.context.register(
        doc.context.obj({ EmbeddedFiles: doc.context.obj({ Names: [PDFString.of('secret.txt'), fileSpec] }) }),
      ),
    );
    // Document-level OpenAction JavaScript
    const jsOpen = doc.context.register(
      doc.context.obj({ Type: 'Action', S: 'JavaScript', JS: 'OAJSSECRET()' }),
    );
    doc.catalog.set(PDFName.of('OpenAction'), jsOpen);
    // Page-level additional action JavaScript
    const jsPage = doc.context.register(
      doc.context.obj({ Type: 'Action', S: 'JavaScript', JS: 'AAJSSECRET()' }),
    );
    page.node.set(PDFName.of('AA'), doc.context.obj({ O: jsPage }));
    // Page thumbnail
    page.node.set(
      PDFName.of('Thumb'),
      doc.context.register(
        doc.context.stream(new Uint8Array([1, 2, 3]), {
          Width: 1,
          Height: 1,
          ColorSpace: 'DeviceGray',
          BitsPerComponent: 8,
        }),
      ),
    );
    const srcBytes = await doc.save();

    const { bytes, verification } = await buildPdf({
      doc: docStateFor(srcBytes, [{ x: 30, y: 180, w: 200, h: 40 }]),
      meta: EMPTY_META,
      range: '',
    });
    // The delivery gate itself must see a clean file: every planted secret
    // absent under all encodings — including inside compressed object
    // streams, which a naive raw-byte scan cannot see.
    const gateSecrets = ['AUTHORSECRET', 'TITLESECRET', 'XMPPSECRET', 'ATTACHSECRET', 'OAJSSECRET', 'AAJSSECRET'];
    const { recoverable } = await verifyRedactedExport(bytes, gateSecrets);
    expect(recoverable, 'gate found recoverable secrets').toBe(0);
    const reload = await PDFDocument.load(bytes, { ignoreEncryption: true });
    // Info lives in the trailer, not the catalog. Note: pdf-lib's save()
    // always re-creates a trailer Info dict with its own Producer/ModDate
    // stamp — what matters is that no SOURCE keys survive the scrub.
    const infoDict = reload.context.lookup(reload.context.trailerInfo.Info);
    if (infoDict instanceof PDFDict) {
      expect(infoDict.get(PDFName.of('Author')), 'Info Author not scrubbed').toBeUndefined();
      expect(infoDict.get(PDFName.of('Title')), 'Info Title not scrubbed').toBeUndefined();
    }
    expect(reload.catalog.get(PDFName.of('Metadata'))).toBeUndefined();
    const names = reload.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
    expect(names?.get(PDFName.of('EmbeddedFiles'))).toBeUndefined();
    expect(reload.catalog.get(PDFName.of('OpenAction'))).toBeUndefined();
    expect(reload.getPage(0).node.get(PDFName.of('AA'))).toBeUndefined();
    expect(reload.getPage(0).node.get(PDFName.of('Thumb'))).toBeUndefined();
    // Redacted export carries a verification report: 1 region, ≥1 string checked, 0 recoverable.
    expect(verification).toBeDefined();
    expect(verification!.regions).toBe(1);
    expect(verification!.stringsChecked).toBeGreaterThanOrEqual(1);
    expect(verification!.recoverable).toBe(0);
  });

  it('fixture 1b: scrubRedactionArtifacts purges Info/XMP/attachments/JS directly', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([400, 300]);
    doc.setAuthor('AUTHORSECRET');
    doc.catalog.set(
      PDFName.of('Metadata'),
      doc.context.register(doc.context.stream('<x:xmpmeta>XMPPSECRET</x:xmpmeta>', { Type: 'Metadata' })),
    );
    const efStream = doc.context.register(doc.context.stream('ATTACHSECRET', { Type: 'EmbeddedFile' }));
    const fileSpec = doc.context.register(
      doc.context.obj({ Type: 'Filespec', F: 's.txt', EF: doc.context.obj({ F: efStream }) }),
    );
    doc.catalog.set(
      PDFName.of('Names'),
      doc.context.register(
        doc.context.obj({ EmbeddedFiles: doc.context.obj({ Names: [PDFString.of('s.txt'), fileSpec] }) }),
      ),
    );
    doc.catalog.set(
      PDFName.of('OpenAction'),
      doc.context.register(doc.context.obj({ Type: 'Action', S: 'JavaScript', JS: 'JSSECRET()' })),
    );
    scrubRedactionArtifacts(doc);
    const scrubbed = await doc.save();
    // The gate must see a clean file — this also proves the trailer Info
    // dict is really gone (pdf-lib hex-encodes its strings, so a naive
    // ASCII scan of the raw bytes would pass vacuously).
    const { recoverable } = await verifyRedactedExport(scrubbed, [
      'AUTHORSECRET',
      'XMPPSECRET',
      'ATTACHSECRET',
      'JSSECRET',
    ]);
    expect(recoverable, 'scrub left recoverable secrets').toBe(0);
    const reload = await PDFDocument.load(scrubbed, { ignoreEncryption: true });
    // pdf-lib's save() re-creates a trailer Info dict with its own stamp —
    // assert the source keys are gone, not the dict itself.
    const infoDict = reload.context.lookup(reload.context.trailerInfo.Info);
    if (infoDict instanceof PDFDict) {
      expect(infoDict.get(PDFName.of('Author')), 'Info Author not purged').toBeUndefined();
    }
    expect(reload.catalog.get(PDFName.of('Metadata'))).toBeUndefined();
    const names = reload.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
    expect(names?.get(PDFName.of('EmbeddedFiles'))).toBeUndefined();
    expect(reload.catalog.get(PDFName.of('OpenAction'))).toBeUndefined();
  });

  it('fixture 2: AcroForm text-field value under the rect is cleared (value, appearance and widget all gone)', async () => {
    const doc = await PDFDocument.create();
    const font = helvRef(doc);
    const page = doc.addPage([400, 300]);
    page.node.set(PDFName.of('Resources'), doc.context.obj({ Font: { F1: font } }));
    page.node.addContentStream(
      doc.context.register(doc.context.stream('BT /F1 14 Tf 50 250 Td (VISIBLE KEEP) Tj ET')),
    );
    const form = doc.getForm();
    const tf = form.createTextField('secretfield');
    tf.setText('FIELDSECRET');
    tf.addToPage(page, { x: 50, y: 200, width: 200, height: 20 });
    const srcBytes = await doc.save();

    const { bytes, verification } = await buildPdf({
      doc: docStateFor(srcBytes, [{ x: 40, y: 190, w: 220, h: 40 }]),
      meta: EMPTY_META,
      range: '',
    });
    expect(latin1(bytes), 'form value leaked').not.toContain('FIELDSECRET');
    // Visible text outside the rect survives: the page was NOT blanket-rasterized.
    expect((await textsOf(bytes))[0]).toContain('VISIBLE KEEP');
    expect(verification).toBeDefined();
    expect(verification!.regions).toBe(1);
    expect(verification!.recoverable).toBe(0);
  });

  it('fixture 3: structure-tree /Alt and marked-content /ActualText under the rect are sanitized', async () => {
    const doc = await PDFDocument.create();
    const font = helvRef(doc);
    const page = doc.addPage([400, 300]);
    page.node.set(PDFName.of('Resources'), doc.context.obj({ Font: { F1: font } }));
    page.node.addContentStream(
      doc.context.register(
        doc.context.stream(
          '/P << /ActualText (MCSECRET) >> BDC BT /F1 14 Tf 50 200 Td (STRUCTTEXT) Tj ET EMC',
        ),
      ),
    );
    const elem = doc.context.register(
      doc.context.obj({
        Type: 'StructElem',
        S: PDFName.of('P'),
        BBox: [PDFNumber.of(40), PDFNumber.of(190), PDFNumber.of(260), PDFNumber.of(230)],
        Alt: PDFString.of('ALTSECRET'),
        K: [],
      }),
    );
    const kids = PDFArray.withContext(doc.context);
    kids.push(elem);
    doc.catalog.set(
      PDFName.of('StructTreeRoot'),
      doc.context.register(doc.context.obj({ Type: 'StructTreeRoot', K: kids })),
    );
    const srcBytes = await doc.save();

    // Direct unit check: the sanitizer strips /Alt from the intersecting element.
    {
      const lib = await PDFDocument.load(srcBytes);
      expect(sanitizeStructureTree(lib, 0, [{ x: 30, y: 180, w: 220, h: 40 }])).toBe(true);
      const root = lib.catalog.lookupMaybe(PDFName.of('StructTreeRoot'), PDFDict);
      const kArr = root!.lookupMaybe(PDFName.of('K'), PDFArray)!;
      const elDict = lib.context.lookup(kArr.get(0)) as PDFDict;
      expect(elDict.get(PDFName.of('Alt'))).toBeUndefined();
    }

    const { bytes } = await buildPdf({
      doc: docStateFor(srcBytes, [{ x: 30, y: 180, w: 220, h: 40 }]),
      meta: EMPTY_META,
      range: '',
    });
    const raw = latin1(bytes);
    expect(raw, 'content text leaked').not.toContain('STRUCTTEXT');
    expect(raw, '/ActualText leaked').not.toContain('MCSECRET');
    expect(raw, '/Alt leaked').not.toContain('ALTSECRET');
    // The gate instrument must also see a clean file — /Alt values are not
    // part of buildPdf's coveredStrings, so this is the only gate-level
    // check for the structure channel (the instrument itself is proven by
    // fixtures 5a/5b/5c).
    const v3 = await verifyRedactedExport(bytes, ['STRUCTTEXT', 'MCSECRET', 'ALTSECRET']);
    expect(v3.recoverable, 'structure/marked-content secret recoverable').toBe(0);
  });

  it('fixture 4: vector-drawn content under the rect is removed (page stays vector)', async () => {
    const doc = await PDFDocument.create();
    const font = helvRef(doc);
    const page = doc.addPage([400, 300]);
    page.node.set(PDFName.of('Resources'), doc.context.obj({ Font: { F1: font } }));
    page.node.addContentStream(
      doc.context.register(
        doc.context.stream(
          'BT /F1 14 Tf 50 250 Td (VECTEXT) Tj ET\n0.123 0.456 0.789 rg 61.5 191.5 182.5 32.5 re f',
        ),
      ),
    );
    const srcBytes = await doc.save();

    const { bytes, verification } = await buildPdf({
      doc: docStateFor(srcBytes, [{ x: 40, y: 180, w: 220, h: 50 }]),
      meta: EMPTY_META,
      range: '',
    });
    // The filled-rect path geometry is gone from the (decoded) content
    // stream — decode honestly rather than trusting the stream's encoding.
    expect(await decodedPageStreams(bytes), 'vector fill leaked').not.toContain('61.5');
    // …while the text outside the rect is still real, selectable text —
    // the vector path was taken, not a blanket rasterization.
    expect((await textsOf(bytes))[0]).toContain('VECTEXT');
    expect(verification).toBeDefined();
    expect(verification!.regions).toBe(1);
    expect(verification!.recoverable).toBe(0);
  });

  it('fixture 5a: the verifier reports a deliberately leaky output as recoverable', async () => {
    const doc = await PDFDocument.create();
    const font = helvRef(doc);
    const page = doc.addPage([400, 300]);
    page.node.set(PDFName.of('Resources'), doc.context.obj({ Font: { F1: font } }));
    page.node.addContentStream(
      doc.context.register(doc.context.stream('BT /F1 14 Tf 50 200 Td (LEAKEDCOVEREDSTRING) Tj ET')),
    );
    const leaky = await doc.save();
    const report = await verifyRedactedExport(leaky, ['LEAKEDCOVEREDSTRING']);
    expect(report.stringsChecked).toBe(1);
    expect(report.recoverable).toBe(1);
  });

  it('fixture 5b: the pipeline refuses delivery when a covered string survives (duplicate outside the rect)', async () => {
    const doc = await PDFDocument.create();
    const font = helvRef(doc);
    const page = doc.addPage([400, 300]);
    page.node.set(PDFName.of('Resources'), doc.context.obj({ Font: { F1: font } }));
    page.node.addContentStream(
      doc.context.register(
        doc.context.stream(
          'BT /F1 14 Tf 50 200 Td (DUPESECRET) Tj ET BT /F1 14 Tf 50 250 Td (DUPESECRET) Tj ET',
        ),
      ),
    );
    const srcBytes = await doc.save();
    // Rect covers only the y=200 line; the y=250 duplicate stays.
    await expect(
      buildPdf({
        doc: docStateFor(srcBytes, [{ x: 30, y: 190, w: 200, h: 25 }]),
        meta: EMPTY_META,
        range: '',
      }),
    ).rejects.toThrow(/verification-failed/);
  });

  it('fixture 5c: the verifier catches a leak hidden inside a compressed object stream', async () => {
    // A secret in a non-rendered object (custom catalog entry) lands in a
    // flate-compressed object stream: invisible to a raw byte scan and to
    // text extraction. The gate must still catch it via the decompressed
    // serialization scan.
    const doc = await PDFDocument.create();
    doc.addPage([400, 300]);
    doc.catalog.set(PDFName.of('KazymLeakTest'), PDFString.of('HIDDENLEAKSECRET'));
    const bytes = await doc.save({ useObjectStreams: true });
    // Sanity: the secret really is hidden from naive inspection…
    expect(latin1(bytes)).not.toContain('HIDDENLEAKSECRET');
    // …but the gate finds it.
    const report = await verifyRedactedExport(bytes, ['HIDDENLEAKSECRET']);
    expect(report.stringsChecked).toBe(1);
    expect(report.recoverable).toBe(1);
  });

  it('fixture 6: indirect /V and /Alt values are neutralized, not orphaned', async () => {
    // Some producers store field values and structure strings as INDIRECT
    // objects. Merely deleting the dict entry would orphan the secret —
    // and pdf-lib serializes orphans — so the sanitizers must neutralize
    // the referenced object itself. This is a DIRECT unit test: the same
    // document is saved (no copyPages to hide orphans behind
    // reachability), so any orphaned secret would be caught by the gate.
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 300]);
    // Widget whose /V is an indirect hex string.
    const vRef = doc.context.register(PDFHexString.fromText('INDIRECTVSECRET'));
    const widgetRef = doc.context.register(
      doc.context.obj({
        Type: 'Annot',
        Subtype: 'Widget',
        FT: 'Tx',
        T: PDFString.of('f1'),
        V: vRef,
        Rect: [50, 200, 250, 220],
      }),
    );
    page.node.set(PDFName.of('Annots'), doc.context.obj([widgetRef]));
    doc.catalog.set(PDFName.of('AcroForm'), doc.context.obj({ Fields: [widgetRef] }));
    // Structure element whose /Alt is an indirect string.
    const altRef = doc.context.register(PDFString.of('INDIRECTALTSECRET'));
    const elem = doc.context.register(
      doc.context.obj({
        Type: 'StructElem',
        S: PDFName.of('P'),
        BBox: [PDFNumber.of(40), PDFNumber.of(190), PDFNumber.of(260), PDFNumber.of(230)],
        Alt: altRef,
        K: [],
      }),
    );
    const kids = PDFArray.withContext(doc.context);
    kids.push(elem);
    doc.catalog.set(
      PDFName.of('StructTreeRoot'),
      doc.context.register(doc.context.obj({ Type: 'StructTreeRoot', K: kids })),
    );

    const rects = [{ x: 40, y: 180, w: 220, h: 60 }];
    const formRes = sanitizeAcroFormUnderRects(doc, 0, rects);
    expect(formRes.ok).toBe(true);
    // The sanitizer really processed the widget (not vacuous).
    expect(formRes.cleared).toContain('INDIRECTVSECRET');
    expect(sanitizeStructureTree(doc, 0, rects)).toBe(true);

    const bytes = await doc.save({ useObjectStreams: true });
    const v = await verifyRedactedExport(bytes, ['INDIRECTVSECRET', 'INDIRECTALTSECRET']);
    expect(v.recoverable, 'indirect secret value recoverable').toBe(0);
  });
});
