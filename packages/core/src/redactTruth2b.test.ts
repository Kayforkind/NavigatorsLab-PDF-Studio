/**
 * Evil fixtures for Phase 2b gaps (items 1, 2, 4). Built with pdf-lib
 * directly; assertions are at the byte level.
 */
import { describe, it, expect } from 'vitest';
import {
  PDFDocument,
  PDFName,
  PDFDict,
  PDFString,
  PDFArray,
  PDFNumber,
  PDFRawStream,
  StandardFonts,
} from 'pdf-lib';
import { inflateSync, deflateSync } from 'node:zlib';
import {
  redactRects,
  buildRedactReport,
  REFUSE_IMAGE_PIXEL,
} from './index.js';

const enc2 = new TextEncoder();

function rawHas2(bytes: Uint8Array, s: string): boolean {
  return Buffer.from(bytes).toString('latin1').includes(s);
}

/** Page with annotations but NO text at all (no Contents stream). */
async function makeTextlessAnnotPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  // Deliberately no text: no Contents on the page, so text recognition
  // returns null — the annotation pass must still run.
  const mkAnnot = (rect: number[], contents: string) =>
    doc.context.register(
      doc.context.obj({
        Type: PDFName.of('Annot'),
        Subtype: PDFName.of('Text'),
        Rect: doc.context.obj(rect),
        Contents: PDFString.of(contents),
      }),
    );
  const under = mkAnnot([60, 700, 200, 740], 'TEXTLESS-ANNOT-SECRET');
  // [300,300,400,340] avoids the redact rect AND its 90/180/270° rotations
  // about the page center (the sanitizer tests all four orientations).
  const away = mkAnnot([300, 300, 400, 340], 'far away note');
  const arr = PDFArray.withContext(doc.context);
  arr.push(under);
  arr.push(away);
  page.node.set(PDFName.of('Annots'), doc.context.register(arr));
  return doc.save({ useObjectStreams: false });
}

describe('redaction truth: annotations on textless pages', () => {
  it('removes an intersecting annotation even when the page has no recognizable text', async () => {
    const bytes = await makeTextlessAnnotPdf();
    expect(rawHas2(bytes, 'TEXTLESS-ANNOT-SECRET')).toBe(true);
    const r = await redactRects([{ page: 1, x: 50, y: 690, w: 200, h: 60 }], bytes);
    expect(r.annotationsRemoved).toBe(1);
    expect(rawHas2(r.bytes, 'TEXTLESS-ANNOT-SECRET')).toBe(false);
    // the non-intersecting annotation survives untouched (its dict rides in
    // a compressed object stream, so assert on the parsed value, not bytes)
    const out = await PDFDocument.load(r.bytes);
    const annots = out.getPage(0).node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    expect(annots?.size()).toBe(1);
    const survivor = out.context.lookup(annots!.get(0)) as PDFDict;
    const contents = survivor.get(PDFName.of('Contents'));
    expect(contents instanceof PDFString ? contents.decodeText() : null).toBe('far away note');
    expect(r.verification.pass).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Predictor fixtures                                                  */
/* ------------------------------------------------------------------ */

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * 10x10 FlateDecode 8-bit RGB image, left half red / right half blue, with
 * real predictor bytes:
 *  - predictor 2: TIFF horizontal differencing, no filter bytes;
 *  - predictor 12 (PNG optimum): one filter byte per row — even rows Sub,
 *    odd rows Paeth, so pngjs's unfiltering is exercised across filter types.
 * Drawn at (50,600), 10x10 → occupies x[50,60] y[600,610].
 */
async function makePredictorImagePdf(predictor: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  const W = 10;
  const H = 10;
  const raw = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 3;
      if (x < W / 2) {
        raw[o] = 255;
        raw[o + 1] = 0;
        raw[o + 2] = 0;
      } else {
        raw[o] = 0;
        raw[o + 1] = 0;
        raw[o + 2] = 255;
      }
    }
  }
  let stored: Uint8Array;
  if (predictor === 2) {
    stored = new Uint8Array(W * H * 3);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W * 3; x++) {
        const v = raw[y * W * 3 + x];
        stored[y * W * 3 + x] = x < 3 ? v : (v - raw[y * W * 3 + x - 3]) & 0xff;
      }
    }
  } else {
    stored = new Uint8Array(H * (W * 3 + 1));
    for (let y = 0; y < H; y++) {
      const filter = y % 2 === 0 ? 1 : 4; // Sub / Paeth
      const rowOff = y * (W * 3 + 1);
      stored[rowOff] = filter;
      for (let x = 0; x < W * 3; x++) {
        const v = raw[y * W * 3 + x];
        let pred: number;
        if (filter === 1) {
          pred = x >= 3 ? raw[y * W * 3 + x - 3] : 0;
        } else {
          const a = x >= 3 ? raw[y * W * 3 + x - 3] : 0;
          const b = y > 0 ? raw[(y - 1) * W * 3 + x] : 0;
          const c = x >= 3 && y > 0 ? raw[(y - 1) * W * 3 + x - 3] : 0;
          pred = paethPredictor(a, b, c);
        }
        stored[rowOff + 1 + x] = (v - pred) & 0xff;
      }
    }
  }
  const dict = doc.context.obj({
    Type: PDFName.of('XObject'),
    Subtype: PDFName.of('Image'),
    Width: W,
    Height: H,
    ColorSpace: PDFName.of('DeviceRGB'),
    BitsPerComponent: 8,
    Filter: PDFName.of('FlateDecode'),
    DecodeParms: doc.context.obj({ Predictor: predictor, Columns: W, Colors: 3 }),
  }) as PDFDict;
  const ref = doc.context.register(PDFRawStream.of(dict, deflateSync(stored)));
  const content = enc2.encode(`q ${W} 0 0 ${H} 50 600 cm /ImP Do Q`);
  page.node.set(
    PDFName.of('Contents'),
    doc.context.register(PDFRawStream.of(doc.context.obj({}) as PDFDict, content)),
  );
  page.node.set(
    PDFName.of('Resources'),
    doc.context.register(doc.context.obj({ XObject: doc.context.obj({ ImP: ref }) })),
  );
  return doc.save();
}

/** Read back the redacted image: output is always FlateDecode 8-bit RGB. */
async function flateImagePixels(outBytes: Uint8Array): Promise<{ w: number; h: number; data: Uint8Array }> {
  const doc = await PDFDocument.load(outBytes);
  for (const page of doc.getPages()) {
    const xo = page.node.Resources()?.lookupMaybe(PDFName.of('XObject'), PDFDict);
    if (!xo) continue;
    for (const [, val] of xo.entries()) {
      const o = doc.context.lookup(val);
      if (o instanceof PDFRawStream) {
        const sub = o.dict.get(PDFName.of('Subtype'));
        if (sub instanceof PDFName && sub.asString().replace(/^\//, '') === 'Image') {
          const w = o.dict.lookupMaybe(PDFName.of('Width'), PDFNumber);
          const h = o.dict.lookupMaybe(PDFName.of('Height'), PDFNumber);
          if (!w || !h) throw new Error('image XObject missing Width/Height');
          return { w: w.asNumber(), h: h.asNumber(), data: inflateSync(o.getContents()) };
        }
      }
    }
  }
  throw new Error('no image XObject found in output');
}

describe('redaction truth: predictor images (FlateDecode)', () => {
  // Rect x[45,53] hits drawn x[50,53] → pixel x[0,3], expanded ±1 → [0,4).
  it('blackens the intersected region of a PNG-predicted (Sub+Paeth) image; surroundings intact', async () => {
    const bytes = await makePredictorImagePdf(12);
    const r = await redactRects([{ page: 1, x: 45, y: 595, w: 8, h: 20 }], bytes);
    expect(r.skipped).toHaveLength(0);
    expect(r.imagesPixelRedacted).toBe(1);
    const { w, data } = await flateImagePixels(r.bytes);
    expect(w).toBe(10);
    const at = (x: number, y: number): [number, number, number] => {
      const o = (y * w + x) * 3;
      return [data[o], data[o + 1], data[o + 2]];
    };
    // blackened region (Flate is lossless: exact black). The driver expands
    // the mapped region by 1px per side, so assert the core, not the edge.
    for (const [x, y] of [
      [0, 0],
      [1, 5],
      [2, 9],
    ] as const) {
      expect(at(x, y)).toEqual([0, 0, 0]);
    }
    // outside the expanded region the photo is untouched (left half red up
    // to x=4, right half blue from x=5)
    for (const [x, y] of [
      [5, 0],
      [6, 5],
      [8, 5],
      [9, 9],
    ] as const) {
      expect(at(x, y)).toEqual([0, 0, 255]);
    }
    expect(r.verification.pass).toBe(true);
  });

  it('blackens the intersected region of a TIFF-predicted image', async () => {
    const bytes = await makePredictorImagePdf(2);
    const r = await redactRects([{ page: 1, x: 45, y: 595, w: 8, h: 20 }], bytes);
    expect(r.skipped).toHaveLength(0);
    expect(r.imagesPixelRedacted).toBe(1);
    const { w, data } = await flateImagePixels(r.bytes);
    const at = (x: number, y: number): [number, number, number] => {
      const o = (y * w + x) * 3;
      return [data[o], data[o + 1], data[o + 2]];
    };
    expect(at(1, 3)).toEqual([0, 0, 0]);
    expect(at(2, 7)).toEqual([0, 0, 0]);
    expect(at(5, 3)).toEqual([0, 0, 255]);
    expect(at(8, 3)).toEqual([0, 0, 255]);
    expect(r.verification.pass).toBe(true);
  });

  it('refuses loudly on an unsupported Flate predictor (precise refusal string)', async () => {
    const bytes = await makePredictorImagePdf(99);
    const r = await redactRects([{ page: 1, x: 45, y: 595, w: 8, h: 20 }], bytes);
    expect(r.unprovable).toBe(true);
    const skip = r.skipped.find((s) => s.unprovable);
    expect(skip).toBeDefined();
    expect(skip!.reason).toBe(REFUSE_IMAGE_PIXEL('FlateDecode with /Predictor 99 (only predictors 1, 2 and PNG 10-15 supported)'));
    expect(buildRedactReport(undefined, r).exitCode).toBe(3);
  });
});

describe('redaction truth: report stringsChecked covers nested Forms', () => {
  it('a secret redacted from a nested Form XObject appears in stringsChecked and the report shows pass', async () => {
    // rebuild the nested-form fixture locally (it lives in the sibling file)
    const doc = await PDFDocument.create();
    const helv = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([600, 800]);
    const innerBytes = enc2.encode('BT /F1 12 Tf 10 10 Td (TOP-SECRET-NESTED) Tj ET');
    const innerDict = doc.context.obj({
      Type: PDFName.of('XObject'),
      Subtype: PDFName.of('Form'),
      BBox: doc.context.obj([0, 0, 300, 100]),
    }) as PDFDict;
    const innerRef = doc.context.register(PDFRawStream.of(innerDict, innerBytes));
    (doc.context.lookup(innerRef) as PDFRawStream).dict.set(
      PDFName.of('Resources'),
      doc.context.register(doc.context.obj({ Font: doc.context.obj({ F1: helv.ref }) })),
    );
    const outerDict = doc.context.obj({
      Type: PDFName.of('XObject'),
      Subtype: PDFName.of('Form'),
      BBox: doc.context.obj([0, 0, 300, 100]),
      Resources: doc.context.obj({ XObject: doc.context.obj({ Fm1: innerRef }) }),
    }) as PDFDict;
    const outerRef = doc.context.register(PDFRawStream.of(outerDict, enc2.encode('q /Fm1 Do Q')));
    page.node.set(
      PDFName.of('Contents'),
      doc.context.register(PDFRawStream.of(doc.context.obj({}) as PDFDict, enc2.encode('q 1 0 0 1 50 700 cm /Fm0 Do Q'))),
    );
    page.node.set(
      PDFName.of('Resources'),
      doc.context.register(doc.context.obj({ XObject: doc.context.obj({ Fm0: outerRef }) })),
    );
    const bytes = await doc.save();

    const r = await redactRects([{ page: 1, x: 40, y: 690, w: 200, h: 40 }], bytes);
    expect(r.verification.pass).toBe(true);
    expect(r.verification.stringsChecked.map((c) => c.text)).toContain('TOP-SECRET-NESTED');
    const rep = buildRedactReport(undefined, r);
    expect(rep.pass).toBe(true);
    expect(rep.exitCode).toBe(0);
    expect(rep.verification.stringsChecked.map((c) => c.text)).toContain('TOP-SECRET-NESTED');
  });
});
