/**
 * Pixel-level image XObject redaction + page hygiene for burned-in redaction.
 *
 * The vector engine (src/lib/textRewrite.ts) deletes text operators, but it
 * cannot prove anything about pixels: any image XObject reachable from a
 * redacted page forces its refusal. This module closes that gap for
 * page-level image XObjects:
 *
 *  - walk the page content stream (exported collectShowSegments gives every
 *    `Do` with the CTM at the invocation site),
 *  - intersect the drawn quad with the redact rects,
 *  - decode the image (JPEG via jpeg-js, FlateDecode 8-bit RGB/gray via
 *    node:zlib — PNG predictors 10–15 unfiltered via pngjs, TIFF predictor
 *    2 by horizontal-differencing decode, 1-bit image masks), fill the
 *    intersected pixel region black,
 *  - re-encode (JPEG→DCTDecode, raw→FlateDecode 8-bit RGB, predictor-free)
 *    and install the new stream clone-on-write (shared XObjects on other
 *    pages are untouched).
 *
 * Hard boundaries (precise refusals, never silent):
 *  - inline images (BI…EI): pixels cannot be losslessly edited → refuse page.
 *  - image XObjects nested inside Form XObjects: the recursive vector engine
 *    aborts on any image Do mid-recursion, so pages with Form-nested images
 *    are refused (page-level images are handled).
 *  - unsupported encodings (CCITTFaxDecode, JPXDecode, non-1/2/10–15
 *    predictors, Indexed/ICCBased color spaces, non-8-bit Flate, …): refuse
 *    with the exact detail.
 *
 * /SMask soft masks are left as-is: blacking the base image is sufficient
 * (a soft mask only modulates opacity of already-black pixels).
 * ImageMask stencils are handled on the pixel path by erasing (zeroing) the
 * mask bits inside the intersected region — the stencil shape there becomes
 * unrecoverable.
 */
import { PDFDocument, PDFDict, PDFName, PDFNumber, PDFArray, PDFRawStream, PDFRef, PDFObject } from 'pdf-lib';
import { inflateSync, deflateSync } from 'node:zlib';
import * as jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import {
  tokenizeContent,
  collectShowSegments,
  installXObjectStream,
} from '../../../src/lib/textRewrite.js';

/* ------------------------------------------------------------------ */
/* Precise refusal reasons (single source of truth; also asserted by   */
/* tests — keep the wording stable).                                   */
/* ------------------------------------------------------------------ */

export const REFUSE_TYPE0_TYPE3 = (names: string): string =>
  `page uses Type0/Type3 font(s) (${names}); text set in these fonts cannot be decoded, so complete removal cannot be verified`;

export const REFUSE_INLINE_IMAGES =
  'page contains inline images (BI…EI operators); inline image pixels cannot be losslessly edited, so complete removal cannot be verified';

export const REFUSE_PATTERNS =
  'page uses /Pattern resources; pattern content can carry text the engine does not parse, so complete removal cannot be verified';

export const REFUSE_UNRECOGNIZED_TEXT =
  'page contains text the engine cannot decode (missing font or undecodable bytes); complete removal cannot be verified';

export const REFUSE_IMAGE_NESTED_FORM =
  'image XObject nested inside a Form XObject; pixel redaction is implemented for page-level image XObjects only, so complete removal cannot be verified';

export const REFUSE_IMAGE_PIXEL = (detail: string): string =>
  `image XObject could not be pixel-redacted (${detail}); complete removal cannot be verified`;

export const REFUSE_FORM_RECURSION =
  'Form XObject text could not be recursively verified and redacted ' +
  '(possible causes: nesting deeper than 8 levels, a reference cycle, an image XObject inside the Form, ' +
  'or a non-invertible font inside the Form); complete removal cannot be verified';

export const REFUSE_NO_COVERAGE =
  'no fully-covered invertible text lines (partially covered lines are left intact by design)';

/* ------------------------------------------------------------------ */
/* Small matrix helpers (image space <-> page space).                  */
/* ------------------------------------------------------------------ */

type Mat6 = [number, number, number, number, number, number];

function applyMat(m: Mat6, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function invertMat(m: Mat6): Mat6 | null {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  const [a, b, c, d, e, f] = m;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

/** PDFName asString() keeps the leading slash ('/Image'); strip it. */
function nameOf(o: unknown): string {
  return o instanceof PDFName ? o.asString().replace(/^\//, '') : '';
}

function numOf(lib: PDFDocument, o: unknown): number | undefined {
  const n = lib.context.lookupMaybe(o as never, PDFNumber);
  return n ? n.asNumber() : undefined;
}

/* ------------------------------------------------------------------ */
/* Resource scans                                                      */
/* ------------------------------------------------------------------ */

/**
 * Names of Type0/Type3 fonts reachable from the page's resources,
 * recursing through Form XObjects (cycle-safe). Presence alone forces a
 * refusal: such a font could paint text anywhere in the subtree.
 */
export function findType0Type3Fonts(lib: PDFDocument, pageIndex: number): string[] {
  const found = new Set<string>();
  const seen = new Set<string>();
  const walkRes = (res: PDFDict | undefined): void => {
    if (!res) return;
    try {
      const fonts = res.lookupMaybe(PDFName.of('Font'), PDFDict);
      if (fonts) {
        for (const [key, val] of fonts.entries()) {
          const d = val instanceof PDFRef ? lib.context.lookup(val) : val;
          if (d instanceof PDFDict) {
            const sub = nameOf(d.get(PDFName.of('Subtype')));
            if (sub === 'Type0' || sub === 'Type3') found.add(key.asString());
          }
        }
      }
      const xo = res.lookupMaybe(PDFName.of('XObject'), PDFDict);
      if (xo) {
        for (const [, val] of xo.entries()) {
          const refKey = val instanceof PDFRef ? val.toString() : '';
          if (refKey && seen.has(refKey)) continue;
          if (refKey) seen.add(refKey);
          const o = lib.context.lookup(val);
          if (o instanceof PDFRawStream && nameOf(o.dict.get(PDFName.of('Subtype'))) === 'Form') {
            const r = o.dict.get(PDFName.of('Resources'));
            const rd = r instanceof PDFRef ? lib.context.lookup(r) : r;
            if (rd instanceof PDFDict) walkRes(rd);
          }
        }
      }
    } catch {
      /* walk errors: ignore this branch (other checks stay conservative) */
    }
  };
  try {
    walkRes(lib.getPage(pageIndex).node.Resources());
  } catch {
    /* ignore */
  }
  return [...found];
}

/**
 * True when any image XObject is reachable through nested Form XObjects
 * (cycle-safe). Page-level images are NOT included — those are handled by
 * the pixel path; only Form-nested images force a refusal.
 */
export function formTreeHasImages(lib: PDFDocument, res: PDFDict | undefined, seen: Set<string> = new Set()): boolean {
  if (!res) return false;
  try {
    const xo = res.lookupMaybe(PDFName.of('XObject'), PDFDict);
    if (!xo) return false;
    for (const [, val] of xo.entries()) {
      const obj = lib.context.lookup(val);
      if (!(obj instanceof PDFRawStream)) continue;
      const sub = nameOf(obj.dict.get(PDFName.of('Subtype')));
      if (sub !== 'Form') continue;
      const refKey = val instanceof PDFRef ? val.toString() : '';
      if (refKey && seen.has(refKey)) continue;
      if (refKey) seen.add(refKey);
      const r = obj.dict.get(PDFName.of('Resources'));
      const rd = r instanceof PDFRef ? lib.context.lookup(r) : r;
      if (!(rd instanceof PDFDict)) continue;
      const inner = rd.lookupMaybe(PDFName.of('XObject'), PDFDict);
      if (!inner) continue;
      for (const [, ival] of inner.entries()) {
        const io = lib.context.lookup(ival);
        if (io instanceof PDFRawStream && nameOf(io.dict.get(PDFName.of('Subtype'))) === 'Image') return true;
      }
      if (formTreeHasImages(lib, rd, seen)) return true;
    }
  } catch {
    return true; // be safe: assume images when unsure
  }
  return false;
}

/** True when any image XObject sits directly in the page's /Resources. */
export function pageHasDirectImages(lib: PDFDocument, pageIndex: number): boolean {
  try {
    const res = lib.getPage(pageIndex).node.Resources();
    const xo = res?.lookupMaybe(PDFName.of('XObject'), PDFDict);
    if (!xo) return false;
    for (const [, val] of xo.entries()) {
      const o = lib.context.lookup(val);
      if (o instanceof PDFRawStream && nameOf(o.dict.get(PDFName.of('Subtype'))) === 'Image') return true;
    }
  } catch {
    return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Image decode / blacken / re-encode                                 */
/* ------------------------------------------------------------------ */

interface DecodedImage {
  w: number;
  h: number;
  /** RGBA for photos, RGB for flate; mask images use `mask` instead. */
  data?: Uint8Array;
  mask?: Uint8Array;
  maskStride?: number;
  kind: 'rgba' | 'rgb' | 'mask';
}

function filterList(dict: PDFDict): string[] {
  const f = dict.get(PDFName.of('Filter'));
  const out: string[] = [];
  const push = (o: unknown): void => {
    const n = nameOf(o);
    if (n) out.push(n);
  };
  if (f instanceof PDFArray) {
    for (let i = 0; i < f.size(); i++) push(f.get(i));
  } else {
    push(f);
  }
  return out;
}

function decodeParmsDict(lib: PDFDocument, dict: PDFDict): PDFDict | undefined {
  try {
    const dp = dict.get(PDFName.of('DecodeParms'));
    const raw = dp instanceof PDFRef ? lib.context.lookup(dp) : dp;
    const first = raw instanceof PDFArray ? (raw.size() > 0 ? lib.context.lookup(raw.get(0)) : raw) : raw;
    return first instanceof PDFDict ? first : undefined;
  } catch {
    /* ignore */
  }
  return undefined;
}

function decodeParmsNumber(lib: PDFDocument, dict: PDFDict, key: string): number | undefined {
  try {
    const dp = decodeParmsDict(lib, dict);
    if (!dp) return undefined;
    const n = dp.lookupMaybe(PDFName.of(key), PDFNumber);
    return n ? n.asNumber() : undefined;
  } catch {
    /* ignore */
  }
  return undefined;
}

function decodeParmsPredictor(lib: PDFDocument, dict: PDFDict): number | undefined {
  return decodeParmsNumber(lib, dict, 'Predictor');
}

/* ------------------------------------------------------------------ */
/* PNG / TIFF predictor handling (FlateDecode image XObjects)         */
/* ------------------------------------------------------------------ */

const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Wrap PNG-filtered rows (one filter byte + samples per row) in a minimal
 * valid PNG so pngjs can unfilter them with its own (battle-tested) filter
 * implementations — no reimplementation of Sub/Up/Average/Paeth here.
 */
function buildMinimalPng(filteredRows: Uint8Array, w: number, h: number, colors: 1 | 3): Uint8Array {
  const parts: Uint8Array[] = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])];
  const te = new TextEncoder();
  const pushChunk = (type: string, data: Uint8Array): void => {
    const name = te.encode(type);
    const len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, data.length);
    const body = new Uint8Array(name.length + data.length);
    body.set(name, 0);
    body.set(data, name.length);
    const crc = new Uint8Array(4);
    new DataView(crc.buffer).setUint32(0, crc32(body));
    parts.push(len, body, crc);
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 8; // bit depth
  ihdr[9] = colors === 3 ? 2 : 0; // color type: 2 = RGB, 0 = grayscale
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter method: adaptive
  ihdr[12] = 0; // no interlace
  pushChunk('IHDR', ihdr);
  pushChunk('IDAT', deflateSync(filteredRows));
  pushChunk('IEND', new Uint8Array(0));
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/**
 * Undo PDF predictor bytes on inflated FlateDecode data, returning plain
 * 8-bit sample rows (no filter bytes, no prediction).
 *  - Predictor 2 (TIFF): horizontal differencing, no filter bytes;
 *    decoded directly (each byte adds the previous same-component byte).
 *  - Predictors 10–15 (PNG): one filter byte per row; the filtered rows are
 *    wrapped in a minimal PNG and unfiltered by pngjs.
 * Anything else (or a /Columns–/Width mismatch) returns a precise error —
 * the caller refuses loudly rather than guessing geometry.
 */
function unfilterPredictedRows(
  lib: PDFDocument,
  dict: PDFDict,
  inflated: Uint8Array,
  w: number,
  h: number,
  comps: number,
  predictor: number,
): { bytes: Uint8Array } | { error: string } {
  const columns = decodeParmsNumber(lib, dict, 'Columns') ?? w;
  const colors = decodeParmsNumber(lib, dict, 'Colors') ?? comps;
  if (!Number.isInteger(columns) || columns <= 0 || columns > 20000) {
    return { error: `FlateDecode with bogus /Columns ${columns}` };
  }
  if (colors !== comps) {
    return { error: `FlateDecode /Colors ${colors} disagrees with the color space (${comps} components)` };
  }
  if (columns !== w) {
    // Row width != image width: the pixel→geometry mapping is ambiguous;
    // refuse loudly rather than blackening the wrong pixels.
    return { error: `FlateDecode /Columns ${columns} differs from /Width ${w}` };
  }
  const stride = columns * colors;

  if (predictor === 2) {
    if (inflated.length < h * stride) {
      return { error: 'TIFF-predicted FlateDecode data shorter than Height×row-bytes' };
    }
    const out = inflated.slice(0, h * stride);
    for (let y = 0; y < h; y++) {
      const base = y * stride;
      for (let x = colors; x < stride; x++) {
        out[base + x] = (out[base + x] + out[base + x - colors]) & 0xff;
      }
    }
    return { bytes: out };
  }

  if (predictor >= 10 && predictor <= 15) {
    if (inflated.length < h * (stride + 1)) {
      return { error: 'PNG-predicted FlateDecode data shorter than Height×(row-bytes+1)' };
    }
    const rows = inflated.slice(0, h * (stride + 1));
    let img: { width: number; height: number; data: Uint8Array };
    try {
      // pngjs's sync reader needs a real Buffer (it calls readUInt32BE).
      img = PNG.sync.read(Buffer.from(buildMinimalPng(rows, columns, h, colors === 3 ? 3 : 1)));
    } catch {
      return { error: 'PNG-predicted FlateDecode rows failed pngjs decode' };
    }
    if (img.width !== columns || img.height !== h) {
      return { error: 'PNG-predicted decode produced wrong dimensions' };
    }
    // pngjs normalizes to RGBA; reduce to the image's component count.
    const out = new Uint8Array(columns * h * colors);
    for (let i = 0; i < columns * h; i++) {
      for (let c = 0; c < colors; c++) out[i * colors + c] = img.data[i * 4 + c];
    }
    return { bytes: out };
  }

  return { error: `FlateDecode with /Predictor ${predictor} (only predictors 1, 2 and PNG 10-15 supported)` };
}

/**
 * Decode an image XObject to raw pixels. Returns `{ error }` with a precise
 * detail string when the encoding is unsupported — the caller turns it into
 * REFUSE_IMAGE_PIXEL.
 */
function decodeImage(
  lib: PDFDocument,
  stream: PDFRawStream,
): DecodedImage | { error: string } {
  const dict = stream.dict;
  const w = numOf(lib, dict.get(PDFName.of('Width')));
  const h = numOf(lib, dict.get(PDFName.of('Height')));
  if (!w || !h || w <= 0 || h <= 0 || w > 20000 || h > 20000) {
    return { error: `bogus dimensions ${w}x${h}` };
  }
  const raw = stream.getContents();
  const filters = filterList(dict);
  // pdf-lib represents booleans as PDFBool; read /ImageMask via asBoolean().
  const maskFlag = (() => {
    try {
      const v = lib.context.lookup(dict.get(PDFName.of('ImageMask')));
      const b = v as unknown as { asBoolean?: () => boolean };
      return typeof b.asBoolean === 'function' && b.asBoolean();
    } catch {
      return false;
    }
  })();

  if (maskFlag) {
    const bpc = numOf(lib, dict.get(PDFName.of('BitsPerComponent'))) ?? 1;
    if (bpc !== 1) return { error: `ImageMask with ${bpc} bits per component` };
    if (filters.length > 1 || (filters.length === 1 && filters[0] !== 'FlateDecode')) {
      return { error: `ImageMask with unsupported filters [${filters.join(', ')}]` };
    }
    let bytes = raw;
    try {
      if (filters[0] === 'FlateDecode') bytes = inflateSync(raw);
    } catch {
      return { error: 'ImageMask FlateDecode inflate failed' };
    }
    const stride = Math.ceil(w / 8);
    if (bytes.length < stride * h) return { error: 'ImageMask data shorter than Width×Height bits' };
    return { w, h, mask: bytes.slice(0, stride * h), maskStride: stride, kind: 'mask' };
  }

  if (filters.length === 1 && filters[0] === 'DCTDecode') {
    let img: { width: number; height: number; data: Uint8Array };
    try {
      img = jpeg.decode(raw, { useTArray: true, maxMemoryUsageInMB: 512 });
    } catch {
      return { error: 'DCTDecode JPEG decode failed' };
    }
    if (img.width <= 0 || img.height <= 0) return { error: 'DCTDecode produced empty image' };
    return { w: img.width, h: img.height, data: img.data, kind: 'rgba' };
  }

  if (filters.length === 1 && filters[0] === 'FlateDecode') {
    const bpc = numOf(lib, dict.get(PDFName.of('BitsPerComponent')));
    if (bpc !== 8) return { error: `FlateDecode with ${bpc ?? '?'} bits per component (only 8-bit supported)` };
    const predictor = decodeParmsPredictor(lib, dict);
    const csRaw = dict.get(PDFName.of('ColorSpace'));
    const cs = nameOf(csRaw);
    let comps: number;
    if (cs === 'DeviceRGB') comps = 3;
    else if (cs === 'DeviceGray') comps = 1;
    else return { error: `FlateDecode with color space ${cs || '(missing)'} (only DeviceRGB/DeviceGray supported)` };
    let bytes: Uint8Array;
    try {
      bytes = inflateSync(raw);
    } catch {
      return { error: 'FlateDecode inflate failed' };
    }
    if (predictor !== undefined && predictor !== 1) {
      const unf = unfilterPredictedRows(lib, dict, bytes, w, h, comps, predictor);
      if ('error' in unf) return unf;
      bytes = unf.bytes;
    }
    if (bytes.length < w * h * comps) return { error: 'FlateDecode data shorter than Width×Height×components' };
    bytes = bytes.slice(0, w * h * comps);
    if (comps === 1) {
      const rgb = new Uint8Array(w * h * 3);
      for (let i = 0; i < w * h; i++) rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = bytes[i];
      return { w, h, data: rgb, kind: 'rgb' };
    }
    return { w, h, data: bytes, kind: 'rgb' };
  }

  if (filters.length === 0) return { error: 'unfiltered raw image data (unsupported)' };
  return { error: `unsupported filters [${filters.join(', ')}]` };
}

/**
 * Blacken (or erase, for masks) the pixel rectangle [x0,x1)×[y0,y1).
 * Returns the re-encoded stream bytes + the dict entries to set.
 */
function blackenAndEncode(
  img: DecodedImage,
  x0: number, y0: number, x1: number, y1: number,
): { bytes: Uint8Array; setFilter: string; setCS: string; setBPC: number } | { error: string } {
  if (img.kind === 'mask' && img.mask && img.maskStride) {
    const out = img.mask.slice();
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        out[y * img.maskStride + (x >> 3)] &= ~(0x80 >> (x & 7)); // erase stencil
      }
    }
    return { bytes: deflateSync(out), setFilter: 'FlateDecode', setCS: '', setBPC: 1 };
  }
  const data = img.data!;
  const comps = img.kind === 'rgba' ? 4 : 3;
  const rgb = new Uint8Array(img.w * img.h * 3);
  for (let i = 0; i < img.w * img.h; i++) {
    rgb[i * 3] = data[i * comps];
    rgb[i * 3 + 1] = data[i * comps + 1];
    rgb[i * 3 + 2] = data[i * comps + 2];
  }
  // blacken (JPEG re-encode below; flate path uses rgb directly)
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const o = (y * img.w + x) * 3;
      rgb[o] = rgb[o + 1] = rgb[o + 2] = 0;
    }
  }
  // Re-encode: photos that came from JPEG go back to DCTDecode (keeps the
  // file small); everything else becomes FlateDecode 8-bit RGB.
  if (img.kind === 'rgba') {
    const rgba = new Uint8Array(img.w * img.h * 4);
    for (let i = 0; i < img.w * img.h; i++) {
      rgba[i * 4] = rgb[i * 3];
      rgba[i * 4 + 1] = rgb[i * 3 + 1];
      rgba[i * 4 + 2] = rgb[i * 3 + 2];
      rgba[i * 4 + 3] = 255;
    }
    const enc = jpeg.encode({ width: img.w, height: img.h, data: rgba }, 90);
    return { bytes: new Uint8Array(enc.data), setFilter: 'DCTDecode', setCS: 'DeviceRGB', setBPC: 8 };
  }
  return { bytes: deflateSync(rgb), setFilter: 'FlateDecode', setCS: 'DeviceRGB', setBPC: 8 };
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Pixel-redact every page-level image XObject whose drawn quad intersects
 * any redact rect (rects in crop-box-relative space, like the vector path).
 * Returns the number of image streams replaced, or a precise refusal.
 *
 * Clone-on-write: the page's /Resources /XObject dict is cloned before any
 * name is remapped, so pages sharing the image keep the original bytes.
 */
export function pixelRedactPageImages(
  lib: PDFDocument,
  pageIndex: number,
  rects: Rect[],
  cropX: number,
  cropY: number,
  decoded: Uint8Array,
): { redacted: number } | { refusal: string } {
  if (rects.length === 0) return { redacted: 0 };
  const pageNode = lib.getPage(pageIndex).node;
  let res: PDFDict | undefined;
  try {
    res = pageNode.Resources();
  } catch {
    return { refusal: REFUSE_IMAGE_PIXEL('page resources unreadable') };
  }
  const xoDict = res?.lookupMaybe(PDFName.of('XObject'), PDFDict);
  if (!xoDict) return { redacted: 0 };

  const toks = tokenizeContent(decoded);
  const { dos } = collectShowSegments(decoded, toks);
  const remap = new Map<string, PDFRef>();
  let redacted = 0;

  for (const d of dos) {
    const val = xoDict.get(PDFName.of(d.name));
    if (!val) continue; // dangling Do — renders nothing
    const obj = val instanceof PDFRef ? lib.context.lookup(val) : val;
    if (!(obj instanceof PDFRawStream)) continue;
    if (nameOf(obj.dict.get(PDFName.of('Subtype'))) !== 'Image') continue;

    const ctm = [d.ctm[0], d.ctm[1], d.ctm[2], d.ctm[3], d.ctm[4], d.ctm[5]] as Mat6;
    // Drawn quad: unit square through the CTM (default user space).
    const corners = [
      applyMat(ctm, 0, 0),
      applyMat(ctm, 1, 0),
      applyMat(ctm, 1, 1),
      applyMat(ctm, 0, 1),
    ];
    const qx0 = Math.min(...corners.map((c) => c[0]));
    const qx1 = Math.max(...corners.map((c) => c[0]));
    const qy0 = Math.min(...corners.map((c) => c[1]));
    const qy1 = Math.max(...corners.map((c) => c[1]));

    // Intersect the quad bbox with every redact rect (media space).
    // Overlap of bboxes is conservative: over-blackening is the safe direction.
    let ix0 = Infinity;
    let iy0 = Infinity;
    let ix1 = -Infinity;
    let iy1 = -Infinity;
    for (const r of rects) {
      const rx0 = r.x + cropX;
      const ry0 = r.y + cropY;
      const rx1 = rx0 + r.w;
      const ry1 = ry0 + r.h;
      const cx0 = Math.max(qx0, rx0);
      const cy0 = Math.max(qy0, ry0);
      const cx1 = Math.min(qx1, rx1);
      const cy1 = Math.min(qy1, ry1);
      if (cx1 > cx0 && cy1 > cy0) {
        ix0 = Math.min(ix0, cx0);
        iy0 = Math.min(iy0, cy0);
        ix1 = Math.max(ix1, cx1);
        iy1 = Math.max(iy1, cy1);
      }
    }
    if (!(ix1 > ix0 && iy1 > iy0)) continue; // image untouched by any rect

    // Map the intersect rect into image pixel space via the inverse CTM.
    // PDF image space: (0,0) is the BOTTOM-left of the image as drawn, row 0
    // of the sample data is the TOP row → pixel y = (1 - v) * H.
    const inv = invertMat(ctm);
    if (!inv) return { refusal: REFUSE_IMAGE_PIXEL('image XObject has a non-invertible CTM') };
    const dec = decodeImage(lib, obj);
    if ('error' in dec) return { refusal: REFUSE_IMAGE_PIXEL(dec.error) };
    const px: number[] = [];
    const py: number[] = [];
    for (const [qx, qy] of [
      [ix0, iy0],
      [ix1, iy0],
      [ix1, iy1],
      [ix0, iy1],
    ]) {
      const [u, v] = applyMat(inv, qx, qy);
      px.push(u * dec.w);
      py.push((1 - v) * dec.h);
    }
    // Expand by 1px on every side: the safe direction is over-blackening.
    const x0 = Math.max(0, Math.floor(Math.min(...px)) - 1);
    const x1 = Math.min(dec.w, Math.ceil(Math.max(...px)) + 1);
    const y0 = Math.max(0, Math.floor(Math.min(...py)) - 1);
    const y1 = Math.min(dec.h, Math.ceil(Math.max(...py)) + 1);
    if (!(x1 > x0 && y1 > y0)) continue;

    const enc = blackenAndEncode(dec, x0, y0, x1, y1);
    if ('error' in enc) return { refusal: REFUSE_IMAGE_PIXEL(enc.error) };

    const newDict = obj.dict.clone(lib.context);
    newDict.set(PDFName.of('Filter'), PDFName.of(enc.setFilter));
    if (enc.setCS) newDict.set(PDFName.of('ColorSpace'), PDFName.of(enc.setCS));
    newDict.set(PDFName.of('BitsPerComponent'), PDFNumber.of(enc.setBPC));
    newDict.delete(PDFName.of('DecodeParms'));
    const newRef = installXObjectStream(lib, enc.bytes, newDict);
    remap.set(d.name, newRef);
    redacted++;
  }

  if (remap.size > 0) {
    // Clone the page's /Resources (and its /XObject dict) — never mutate a
    // possibly-shared dict, so other pages keep the original image bytes.
    const newRes = res ? res.clone(lib.context) : lib.context.obj({});
    const newXo = xoDict.clone(lib.context);
    for (const [name, ref] of remap) newXo.set(PDFName.of(name), ref);
    newRes.set(PDFName.of('XObject'), lib.context.register(newXo));
    pageNode.set(PDFName.of('Resources'), lib.context.register(newRes));
  }
  return { redacted };
}

/* ------------------------------------------------------------------ */
/* Annotation sanitizer (same conservative rule as the web exporter)   */
/* ------------------------------------------------------------------ */

function rotRectAboutCenter(r: Rect, mw: number, mh: number, deg: 90 | 180 | 270): Rect {
  const cx = mw / 2;
  const cy = mh / 2;
  const rot = (x: number, y: number): [number, number] => {
    const dx = x - cx;
    const dy = y - cy;
    if (deg === 90) return [cx - dy, cy + dx];
    if (deg === 180) return [cx - dx, cy - dy];
    return [cx + dy, cy - dx];
  };
  const pts = [
    rot(r.x, r.y),
    rot(r.x + r.w, r.y),
    rot(r.x + r.w, r.y + r.h),
    rot(r.x, r.y + r.h),
  ];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  return { x: x0, y: y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 };
}

/**
 * Remove page annotations whose /Rect intersects any redact rect.
 * Conservative: annotations live in default user space, so the rects are
 * tested unrotated AND rotated 90/180/270° about the page center; an
 * annotation whose geometry cannot be determined is removed (over-removal
 * is the safe direction). /AA (JS actions) is stripped from survivors.
 * Returns the number of annotations removed.
 */
export function sanitizeAnnots(
  lib: PDFDocument,
  pageIndex: number,
  rects: Rect[],
  cropX: number,
  cropY: number,
): number {
  if (rects.length === 0) return 0;
  const node = lib.getPage(pageIndex).node;
  let annots: PDFArray | undefined;
  try {
    annots = node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  } catch {
    return 0;
  }
  if (!annots || annots.size() === 0) return 0;

  let mw = 612;
  let mh = 792;
  try {
    const mediaArr = node.MediaBox();
    if (mediaArr && mediaArr.size() >= 4) {
      const w = lib.context.lookupMaybe(mediaArr.get(2), PDFNumber);
      const h = lib.context.lookupMaybe(mediaArr.get(3), PDFNumber);
      if (w && h) {
        mw = w.asNumber();
        mh = h.asNumber();
      }
    }
  } catch {
    /* keep defaults */
  }
  const base = rects.map((r) => ({ x: r.x + cropX, y: r.y + cropY, w: r.w, h: r.h }));
  const allRects: Rect[] = [...base];
  for (const deg of [90, 180, 270] as const) {
    for (const r of base) allRects.push(rotRectAboutCenter(r, mw, mh, deg));
  }

  const keep: PDFObject[] = [];
  let removed = 0;
  for (let i = 0; i < annots.size(); i++) {
    const raw = annots.get(i);
    let drop = false;
    try {
      const a = lib.context.lookup(raw);
      const rectArr = a instanceof PDFDict ? a.lookupMaybe(PDFName.of('Rect'), PDFArray) : undefined;
      if (!rectArr || rectArr.size() < 4) {
        drop = true; // unknown geometry — safe direction
      } else {
        const xs: number[] = [];
        const ys: number[] = [];
        for (let k = 0; k < 4; k++) {
          const n = lib.context.lookupMaybe(rectArr.get(k), PDFNumber);
          if (!n) throw new Error('bad rect');
          (k % 2 === 0 ? xs : ys).push(n.asNumber());
        }
        const ax0 = Math.min(...xs);
        const ay0 = Math.min(...ys);
        const ax1 = Math.max(...xs);
        const ay1 = Math.max(...ys);
        drop = allRects.some((r) => ax0 < r.x + r.w && ax1 > r.x && ay0 < r.y + r.h && ay1 > r.y);
      }
      if (!drop && a instanceof PDFDict) a.delete(PDFName.of('AA')); // strip JS actions from survivors
    } catch {
      drop = true; // unreadable annotation — safe direction
    }
    if (drop) removed++;
    else keep.push(raw);
  }
  try {
    if (removed > 0) {
      const arr = PDFArray.withContext(lib.context);
      for (const k of keep) arr.push(k);
      node.set(PDFName.of('Annots'), lib.context.register(arr));
    }
  } catch {
    /* leave annots as-is on write failure */
  }
  return removed;
}

/* ------------------------------------------------------------------ */
/* Metadata / attachment / JavaScript scrub for redaction outputs      */
/* ------------------------------------------------------------------ */

/** Entries stripped from every redaction output (reported in `scrubbed`). */
export const SCRUBBED_ENTRIES = [
  'info-dict',
  'xmp-metadata',
  'embedded-files',
  'javascript',
  'open-action',
  'aa-actions',
  'thumbnails',
] as const;

/**
 * Strip document Info dict, XMP metadata stream, embedded files /
 * attachments, JavaScript (OpenAction, /AA entries, /Names /JavaScript) and
 * page thumbnails. Runs on the FRESH output document inside rebuildClean —
 * most catalog-level vectors never survive copyPages anyway; this is the
 * belt-and-braces pass over what the copy does carry (Info via copyMeta is
 * skipped entirely on the scrub path, page /AA and /Thumb ride along).
 */
export function scrubRedactedDocument(doc: PDFDocument): void {
  const ctx = doc.context;
  const resolve = (o: unknown): unknown => (o instanceof PDFRef ? ctx.lookup(o) : o);
  try {
    const info = resolve((ctx.trailerInfo as { Info?: unknown }).Info);
    if (info instanceof PDFDict) {
      for (const k of [...info.keys()]) info.delete(k);
    }
  } catch {
    /* ignore */
  }
  try {
    const catalog = resolve((ctx.trailerInfo as { Root?: unknown }).Root);
    if (catalog instanceof PDFDict) {
      catalog.delete(PDFName.of('OpenAction'));
      catalog.delete(PDFName.of('AA'));
      catalog.delete(PDFName.of('Metadata'));
      const names = catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
      if (names) {
        names.delete(PDFName.of('EmbeddedFiles'));
        names.delete(PDFName.of('JavaScript'));
      }
    }
  } catch {
    /* ignore */
  }
  try {
    for (const page of doc.getPages()) {
      page.node.delete(PDFName.of('Thumb'));
      page.node.delete(PDFName.of('AA'));
      page.node.delete(PDFName.of('Metadata'));
    }
  } catch {
    /* ignore */
  }
}
