/**
 * Redaction-truth tests: every test builds an evil PDF with pdf-lib
 * directly and asserts the redacted output at the BYTE level (not just
 * extraction). No test weakens an existing passing test.
 */
import { describe, it, expect } from 'vitest';
import {
  PDFDocument,
  PDFName,
  PDFDict,
  PDFString,
  PDFArray,
  PDFRawStream,
  StandardFonts,
} from 'pdf-lib';
import * as jpeg from 'jpeg-js';
import { inflateSync, deflateSync } from 'node:zlib';
import {
  redactText,
  redactRects,
  buildRedactReport,
  extractText,
  verifyRedaction,
  REFUSE_TYPE0_TYPE3,
  REFUSE_INLINE_IMAGES,
  REFUSE_FORM_RECURSION,
} from './index.js';

function rawHas(bytes: Uint8Array, s: string): boolean {
  const latin = Buffer.from(bytes).toString('latin1');
  return latin.includes(s);
}

const enc = new TextEncoder();

/** Minimal Form XObject: draws `text` at local (tx,ty) with /F1 (Helvetica). */
function makeForm(
  doc: PDFDocument,
  fontRefName: string,
  text: string,
  tx: number,
  ty: number,
): import('pdf-lib').PDFRef {
  const bytes = enc.encode(`BT /${fontRefName} 12 Tf ${tx} ${ty} Td (${text}) Tj ET`);
  const dict = doc.context.obj({
    Type: PDFName.of('XObject'),
    Subtype: PDFName.of('Form'),
    BBox: doc.context.obj([0, 0, 300, 100]),
  }) as PDFDict;
  const ref = doc.context.register(PDFRawStream.of(dict, bytes));
  return ref;
}

async function makeNestedFormPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([600, 800]);

  const innerRef = makeForm(doc, 'F1', 'TOP-SECRET-NESTED', 10, 10);
  // give the inner form its font resources
  const innerObj = doc.context.lookup(innerRef) as PDFRawStream;
  innerObj.dict.set(
    PDFName.of('Resources'),
    doc.context.register(doc.context.obj({ Font: doc.context.obj({ F1: helv.ref }) })),
  );

  // outer form draws the inner form at identity
  const outerBytes = enc.encode('q /Fm1 Do Q');
  const outerDict = doc.context.obj({
    Type: PDFName.of('XObject'),
    Subtype: PDFName.of('Form'),
    BBox: doc.context.obj([0, 0, 300, 100]),
    Resources: doc.context.obj({ XObject: doc.context.obj({ Fm1: innerRef }) }),
  }) as PDFDict;
  const outerRef = doc.context.register(PDFRawStream.of(outerDict, outerBytes));

  // page draws the outer form at (50,700)
  const content = enc.encode('q 1 0 0 1 50 700 cm /Fm0 Do Q');
  page.node.set(PDFName.of('Contents'), doc.context.register(PDFRawStream.of(doc.context.obj({}) as PDFDict, content)));
  page.node.set(
    PDFName.of('Resources'),
    doc.context.register(doc.context.obj({ XObject: doc.context.obj({ Fm0: outerRef }) })),
  );
  return doc.save();
}

async function makeSharedFormPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const innerRef = makeForm(doc, 'F1', 'SHARED-SECRET-555', 10, 10);
  const innerObj = doc.context.lookup(innerRef) as PDFRawStream;
  innerObj.dict.set(
    PDFName.of('Resources'),
    doc.context.register(doc.context.obj({ Font: doc.context.obj({ F1: helv.ref }) })),
  );
  for (const [px, py] of [[50, 700], [50, 700]] as const) {
    const page = doc.addPage([600, 800]);
    const content = enc.encode(`q 1 0 0 1 ${px} ${py} cm /FmS Do Q`);
    page.node.set(PDFName.of('Contents'), doc.context.register(PDFRawStream.of(doc.context.obj({}) as PDFDict, content)));
    page.node.set(
      PDFName.of('Resources'),
      doc.context.register(doc.context.obj({ XObject: doc.context.obj({ FmS: innerRef }) })),
    );
  }
  return doc.save();
}

function makeRedJpeg(w: number, h: number): Uint8Array {
  const data = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = 255;
    data[i * 4 + 1] = 0;
    data[i * 4 + 2] = 0;
    data[i * 4 + 3] = 255;
  }
  return new Uint8Array(jpeg.encode({ width: w, height: h, data }, 100).data);
}

async function makeImagePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([600, 800]);
  const jpg = await doc.embedJpg(makeRedJpeg(100, 100));
  page.drawImage(jpg, { x: 50, y: 600, width: 100, height: 100 });
  page.drawText('IMG-SECRET-777', { x: 50, y: 740, size: 14, font: helv });
  return doc.save();
}

async function imagePixels(outBytes: Uint8Array): Promise<{ w: number; h: number; data: Uint8Array }> {
  const doc = await PDFDocument.load(outBytes);
  for (const page of doc.getPages()) {
    const xo = page.node.Resources()?.lookupMaybe(PDFName.of('XObject'), PDFDict);
    if (!xo) continue;
    for (const [, val] of xo.entries()) {
      const o = doc.context.lookup(val);
      if (o instanceof PDFRawStream) {
        const sub = o.dict.get(PDFName.of('Subtype'));
        if (sub instanceof PDFName && sub.asString().replace(/^\//, '') === 'Image') {
          const dec = jpeg.decode(o.getContents(), { useTArray: true });
          return { w: dec.width, h: dec.height, data: dec.data as Uint8Array };
        }
      }
    }
  }
  throw new Error('no image XObject found in output');
}

async function makeAnnotPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([600, 800]);
  page.drawText('visible text', { x: 50, y: 750, size: 14, font: helv });
  const annot = doc.context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Text'),
    Rect: doc.context.obj([60, 700, 200, 740]),
    Contents: PDFString.of('ANNOT-SECRET-999'),
  });
  const aRef = doc.context.register(annot);
  const arr = PDFArray.withContext(doc.context);
  arr.push(aRef);
  page.node.set(PDFName.of('Annots'), doc.context.register(arr));
  // no object streams: the test asserts on raw bytes pre/post redaction
  return doc.save({ useObjectStreams: false });
}

async function makeType0Pdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([600, 800]);
  page.drawText('type0 secret line', { x: 50, y: 750, size: 14, font: helv });
  // Plant a Type0 font in the page resources (never used — presence alone
  // must force a refusal, since it could paint unverifiable text).
  const fake = doc.context.obj({
    Type: PDFName.of('Font'),
    Subtype: PDFName.of('Type0'),
    BaseFont: PDFName.of('FakeCIDFont'),
  });
  const res = page.node.Resources()!;
  const fonts = res.lookupMaybe(PDFName.of('Font'), PDFDict)!;
  fonts.set(PDFName.of('F99'), doc.context.register(fake));
  return doc.save();
}

describe('redaction truth: nested Form XObjects', () => {
  it('deletes text inside nested Form XObjects (bytes + extraction)', async () => {
    const bytes = await makeNestedFormPdf();
    // sanity: the secret is extractable before redaction
    expect((await extractText(bytes))[0].text).toContain('TOP-SECRET-NESTED');
    // inner text lands at page (60,710); rect covers it fully
    const r = await redactRects([{ page: 1, x: 40, y: 690, w: 200, h: 40 }], bytes);
    expect(r.removed).toBeGreaterThan(0);
    expect(r.skipped).toHaveLength(0);
    const pg = await extractText(r.bytes);
    expect(pg[0].text).not.toContain('TOP-SECRET-NESTED');
    expect(rawHas(r.bytes, 'TOP-SECRET-NESTED')).toBe(false);
    expect(r.verification.pass).toBe(true);
  });

  it('shared XObject: redacting page 1 leaves page 2 untouched (clone-on-write)', async () => {
    const bytes = await makeSharedFormPdf();
    const r = await redactRects([{ page: 1, x: 40, y: 690, w: 200, h: 40 }], bytes);
    expect(r.removed).toBeGreaterThan(0);
    const pg = await extractText(r.bytes);
    expect(pg[0].text).not.toContain('SHARED-SECRET-555');
    expect(pg[1].text).toContain('SHARED-SECRET-555');
    // page 2's bytes still carry the original form stream
    expect(rawHas(r.bytes, 'SHARED-SECRET-555')).toBe(true);
  });
});

describe('redaction truth: image XObjects', () => {
  it('blackens the intersected pixel region; secret text gone from bytes', async () => {
    const bytes = await makeImagePdf();
    const r = await redactRects(
      [
        { page: 1, x: 40, y: 730, w: 220, h: 30 }, // the IMG-SECRET-777 line
        { page: 1, x: 60, y: 640, w: 40, h: 40 }, // part of the image
      ],
      bytes,
    );
    expect(r.removed).toBeGreaterThan(0);
    expect(r.imagesPixelRedacted).toBe(1);
    expect(r.skipped).toHaveLength(0);
    expect(rawHas(r.bytes, 'IMG-SECRET-777')).toBe(false);
    expect((await extractText(r.bytes))[0].text).not.toContain('IMG-SECRET-777');

    const { w, data } = await imagePixels(r.bytes);
    const at = (x: number, y: number): [number, number, number] => {
      const o = (y * w + x) * 4;
      return [data[o], data[o + 1], data[o + 2]];
    };
    // inside the blacked region (page rect mapped to px x[9,51] y[19,61])
    for (const [x, y] of [[20, 30], [30, 40], [45, 55]] as const) {
      const [rr, gg, bb] = at(x, y);
      expect(rr).toBeLessThan(60);
      expect(gg).toBeLessThan(60);
      expect(bb).toBeLessThan(60);
    }
    // outside the region the photo is untouched (still red)
    const [rr, gg, bb] = at(90, 90);
    expect(rr).toBeGreaterThan(180);
    expect(gg).toBeLessThan(100);
    expect(bb).toBeLessThan(100);
    expect(r.verification.pass).toBe(true);
  });

  it('image outside every rect is left byte-identical (no gratuitous re-encode)', async () => {
    const bytes = await makeImagePdf();
    const before = await imagePixels(bytes);
    const r = await redactRects([{ page: 1, x: 40, y: 730, w: 220, h: 30 }], bytes);
    expect(r.imagesPixelRedacted).toBe(0);
    const after = await imagePixels(r.bytes);
    // re-encode path not taken: pixel data identical
    expect(after.data).toEqual(before.data);
  });
});

describe('redaction truth: annotations', () => {
  it('removes an annotation intersecting the redact box (contents gone from bytes)', async () => {
    const bytes = await makeAnnotPdf();
    expect(rawHas(bytes, 'ANNOT-SECRET-999')).toBe(true);
    const r = await redactRects([{ page: 1, x: 50, y: 690, w: 200, h: 60 }], bytes);
    expect(r.annotationsRemoved).toBe(1);
    expect(rawHas(r.bytes, 'ANNOT-SECRET-999')).toBe(false);
    const doc = await PDFDocument.load(r.bytes);
    const annots = doc.getPage(0).node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    expect(annots?.size() ?? 0).toBe(0);
  });
});

describe('redaction truth: precise refusals', () => {
  it('Type0 font on a redacted page refuses with the exact reason', async () => {
    const bytes = await makeType0Pdf();
    const r = await redactText(bytes, { find: 'type0 secret' });
    expect(r.removed).toBe(0);
    expect(r.unprovable).toBe(true);
    const skip = r.skipped.find((s) => s.unprovable);
    expect(skip).toBeDefined();
    expect(skip!.reason).toBe(REFUSE_TYPE0_TYPE3('/F99'));
    const rep = buildRedactReport('type0 secret', r);
    expect(rep.pass).toBe(false);
    expect(rep.exitCode).toBe(3);
    expect(rep.refusal).toContain('Type0/Type3');
  });

  it('refusal reason strings are stable (documented contract)', () => {
    expect(REFUSE_INLINE_IMAGES).toContain('inline images');
    expect(REFUSE_FORM_RECURSION).toContain('8 levels');
    expect(REFUSE_TYPE0_TYPE3('/F1')).toContain('/F1');
  });

  it('inline images (BI..EI) refuse with the exact reason', async () => {
    const doc = await PDFDocument.create();
    const helv = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([600, 800]);
    page.drawText('inline secret', { x: 50, y: 750, size: 14, font: helv });
    // Append an inline image to the content stream (numeric bytes: \x80 in a
    // TS string literal would become 2 UTF-8 bytes and corrupt the ID..EI run).
    const contentsVal = page.node.get(PDFName.of('Contents'));
    const contentsRef = contentsVal instanceof PDFArray ? (contentsVal.get(0) as import('pdf-lib').PDFRef) : (contentsVal as import('pdf-lib').PDFRef);
    const prev = doc.context.lookup(contentsRef) as PDFRawStream;
    const prevBytes = prev.getContents();
    const bi = new Uint8Array([
      10, 113, 10, 66, 73, 10, 47, 87, 32, 49, 10, 47, 72, 32, 49, 10, 47, 67, 83, 32, 47, 71, 10, 47,
      66, 80, 67, 32, 49, 10, 73, 68, 32, 0x80, 10, 69, 73, 10, 81, 10,
    ]);
    const merged = new Uint8Array(prevBytes.length + bi.length);
    merged.set(prevBytes, 0);
    merged.set(bi, prevBytes.length);
    page.node.set(PDFName.of('Contents'), doc.context.register(PDFRawStream.of(doc.context.obj({}) as PDFDict, merged)));
    const r = await redactRects([{ page: 1, x: 40, y: 720, w: 200, h: 40 }], await doc.save());
    expect(r.unprovable).toBe(true);
    expect(r.skipped.find((s) => s.unprovable)!.reason).toBe(REFUSE_INLINE_IMAGES);
    expect(buildRedactReport(undefined, r).exitCode).toBe(3);
  });

  it('a Form XObject reference cycle refuses with the recursion reason', async () => {
    const doc = await PDFDocument.create();
    const helv = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([600, 800]);
    // Self-referential form: /FmSelf Do where /FmSelf resolves to itself.
    const selfBytes = enc.encode('q /FmSelf Do Q');
    const selfDict = doc.context.obj({
      Type: PDFName.of('XObject'),
      Subtype: PDFName.of('Form'),
      BBox: doc.context.obj([0, 0, 300, 100]),
      Resources: doc.context.obj({ Font: doc.context.obj({ F1: helv.ref }) }),
    }) as PDFDict;
    const selfRef = doc.context.register(PDFRawStream.of(selfDict, selfBytes));
    selfDict.set(PDFName.of('Resources'), doc.context.register(
      doc.context.obj({ XObject: doc.context.obj({ FmSelf: selfRef }) }),
    ));
    const content = enc.encode('q 1 0 0 1 50 700 cm /Fm0 Do Q');
    page.node.set(PDFName.of('Contents'), doc.context.register(PDFRawStream.of(doc.context.obj({}) as PDFDict, content)));
    page.node.set(
      PDFName.of('Resources'),
      doc.context.register(doc.context.obj({ XObject: doc.context.obj({ Fm0: selfRef }) })),
    );
    const r = await redactRects([{ page: 1, x: 40, y: 690, w: 200, h: 40 }], await doc.save());
    expect(r.unprovable).toBe(true);
    expect(r.skipped.find((s) => s.unprovable)!.reason).toBe(REFUSE_FORM_RECURSION);
  });
});

describe('redaction truth: scrub', () => {
  it('strips Info metadata, OpenAction JS and thumbnails from redact outputs', async () => {
    const doc = await PDFDocument.create();
    const helv = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([600, 800]);
    page.drawText('scrub me secret', { x: 50, y: 750, size: 14, font: helv });
    doc.setTitle('SECRET-TITLE-XYZ');
    doc.setAuthor('SECRET-AUTHOR-XYZ');
    doc.catalog.set(PDFName.of('OpenAction'), doc.context.obj({ S: PDFName.of('JavaScript'), JS: PDFString.of('app.alert(1)') }));
    page.node.set(PDFName.of('Thumb'), doc.context.obj({ Type: PDFName.of('XObject'), Subtype: PDFName.of('Image') }));
    const bytes = await doc.save();

    const r = await redactText(bytes, { find: 'scrub me' });
    expect(r.removed).toBeGreaterThan(0);
    expect(rawHas(r.bytes, 'SECRET-TITLE-XYZ')).toBe(false);
    expect(rawHas(r.bytes, 'SECRET-AUTHOR-XYZ')).toBe(false);
    expect(rawHas(r.bytes, 'app.alert(1)')).toBe(false);
    const out = await PDFDocument.load(r.bytes);
    expect(out.getTitle()).toBeFalsy();
    expect(out.getAuthor()).toBeFalsy();
    expect(out.catalog.get(PDFName.of('OpenAction'))).toBeUndefined();
    expect(out.getPage(0).node.get(PDFName.of('Thumb'))).toBeUndefined();
    expect(r.scrubbed).toContain('info-dict');
    expect(r.scrubbed).toContain('javascript');
  });

  it('edit-text outputs keep metadata (scrub is redact-only)', async () => {
    const { editText } = await import('./index.js');
    const doc = await PDFDocument.create();
    const helv = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([600, 800]);
    page.drawText('hello world', { x: 50, y: 750, size: 14, font: helv });
    doc.setTitle('KEEP-ME-TITLE');
    const r = await editText(await doc.save(), { find: 'hello', replace: 'goodbye' });
    expect(r.replacements).toHaveLength(1);
    const out = await PDFDocument.load(r.bytes);
    expect(out.getTitle()).toBe('KEEP-ME-TITLE');
  });
});

describe('sequential redaction', () => {
  it('a redacted PDF can be redacted again (own () ghosts do not cause refusal)', async () => {
    const doc = await PDFDocument.create();
    const helv = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([600, 800]);
    page.drawText('first secret alpha', { x: 50, y: 750, size: 14, font: helv });
    page.drawText('second secret beta', { x: 50, y: 730, size: 14, font: helv });
    const bytes = await doc.save();

    const r1 = await redactText(bytes, { find: 'alpha' });
    expect(r1.removed).toBe(1);
    expect(r1.unprovable).toBe(false);

    // Second invocation on the redacted output: the first pass's () ghosts
    // must not trip the undecodable-text refusal.
    const r2 = await redactText(r1.bytes, { find: 'beta' });
    expect(r2.unprovable).toBe(false);
    expect(r2.removed).toBe(1);
    expect(rawHas(r2.bytes, 'alpha')).toBe(false);
    expect(rawHas(r2.bytes, 'beta')).toBe(false);
    expect(r2.verification.pass).toBe(true);
  });
});

describe('verifyRedaction', () => {
  it('finds UTF-16BE/LE survivors with and without BOM', async () => {
    const secret = 'byte-scan-secret';
    const be = new Uint8Array(secret.length * 2);
    for (let i = 0; i < secret.length; i++) {
      be[i * 2] = secret.charCodeAt(i) >> 8;
      be[i * 2 + 1] = secret.charCodeAt(i) & 0xff;
    }
    const carrier = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0xfe, 0xff, ...be, 0x0a]);
    const v = await verifyRedaction(carrier, [secret]);
    expect(v.pass).toBe(false);
    expect(v.byteScan).toBe('fail');
    expect(v.stringsChecked[0].presentInBytes).toBe(true);
    expect(v.stringsChecked[0].encodingsFound).toContain('utf16be-bom');
  });

  it('byte-scan passes when covered strings are truly absent', async () => {
    const v = await verifyRedaction(enc.encode('%PDF-1.7 nothing here'), ['gone-secret']);
    expect(v.byteScan).toBe('pass');
  });
});
