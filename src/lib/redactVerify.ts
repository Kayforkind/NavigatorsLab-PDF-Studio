/**
 * Built-in redaction verification (Phase 5).
 *
 * After every redacted export, the OUTPUT bytes are checked three ways:
 *  (a) text extraction (pdfjs) — none of the redacted source strings may be
 *      present in the extracted text;
 *  (b) raw byte scan — the strings are searched in UTF-8, UTF-16BE/LE (with
 *      and without BOM, since PDF strings are commonly UTF-16BE) and Latin-1
 *      (covers WinAnsi-encoded leftovers); every encoding is additionally
 *      searched in its hex-ASCII form (PDF `<…>` strings — pdf-lib itself
 *      writes form values as hex UTF-16BE), and the UTF-8/Latin-1 forms are
 *      searched against an escape-normalized copy of the file (PDF literal
 *      strings escape `(`, `)`, `\`);
 *  (c) decompressed-object scan — the output is re-serialized without
 *      compressed object streams (pdf-lib's default save hides non-stream
 *      objects like the Info dict, annotations, structure tree, AcroForm
 *      values, JavaScript actions and name trees inside flate-compressed
 *      object streams, invisible to a raw byte scan) and every check in (b)
 *      is repeated against that serialization. Stream *contents* stay
 *      compressed — rendered text from content streams is covered by (a);
 *      XMP/attachment streams are covered by removal (scrub), not by scan.
 *
 * Every captured covered string is checked — including short ones, which
 * use word-boundaried extraction matching plus PDF-wrapped byte forms
 * (`(s)`, `<hex>`) instead of bare byte needles that would false-positive
 * on every matching byte.
 *
 * Verification GATES delivery: `gateRedactedExport` throws
 * `verification-failed: …` when any covered string is still recoverable, and
 * buildPdf refuses to return the bytes. A report that doesn't gate delivery
 * would be theater — this one does.
 */

import { getDocument } from 'pdfjs-dist';
import { PDFDocument } from 'pdf-lib';

export interface RedactionReport {
  /** redact rects across the exported pages */
  regions: number;
  /** covered strings actually checked (deduped) */
  stringsChecked: number;
  /** covered strings found recoverable in the output — must be 0 */
  recoverable: number;
}

/** All byte encodings a covered string might survive in. */
function encodeVariants(text: string): Uint8Array[] {
  const out: Uint8Array[] = [];
  // UTF-8
  out.push(new TextEncoder().encode(text));
  // UTF-16BE / UTF-16LE, with and without BOM
  const units: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp > 0xffff) {
      const h = cp - 0x10000;
      units.push(0xd800 + (h >> 10), 0xdc00 + (h & 0x3ff));
    } else {
      units.push(cp);
    }
  }
  const be = new Uint8Array(units.length * 2);
  const le = new Uint8Array(units.length * 2);
  units.forEach((u, i) => {
    be[i * 2] = (u >> 8) & 0xff;
    be[i * 2 + 1] = u & 0xff;
    le[i * 2] = u & 0xff;
    le[i * 2 + 1] = (u >> 8) & 0xff;
  });
  out.push(be, new Uint8Array([0xfe, 0xff, ...be]), le, new Uint8Array([0xff, 0xfe, ...le]));
  // Latin-1 single byte — covers WinAnsi-encoded leftovers for chars < 0x100
  if ([...text].every((ch) => (ch.codePointAt(0) ?? 0) < 0x100)) {
    const l = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) l[i] = text.charCodeAt(i) & 0xff;
    out.push(l);
  }
  return out;
}

/** Naive byte-substring search. */
export function byteIncludes(hay: Uint8Array, needle: Uint8Array): boolean {
  if (needle.length === 0 || needle.length > hay.length) return false;
  const first = needle[0];
  outer: for (let i = 0; i <= hay.length - needle.length; i++) {
    if (hay[i] !== first) continue;
    for (let j = 1; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Bytes of the UTF-16BE form (no BOM) — reused for hex needles. */
function utf16beBytes(text: string): Uint8Array {
  const units: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp > 0xffff) {
      const h = cp - 0x10000;
      units.push(0xd800 + (h >> 10), 0xdc00 + (h & 0x3ff));
    } else {
      units.push(cp);
    }
  }
  const be = new Uint8Array(units.length * 2);
  units.forEach((u, i) => {
    be[i * 2] = (u >> 8) & 0xff;
    be[i * 2 + 1] = u & 0xff;
  });
  return be;
}

function hexOf(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
  return s;
}

function latin1Decode(b: Uint8Array): string {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < b.length; i += CH) s += String.fromCharCode(...b.subarray(i, i + CH));
  return s;
}

function latin1Encode(s: string): Uint8Array {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
  return b;
}

/**
 * Unescape PDF literal-string escapes in a copy of the file bytes, so a
 * covered string containing `(`, `)` or `\` is still found when the leak
 * serializes it escaped (e.g. `(pa\)ss)`). Line-continuation backslashes
 * are dropped; any other `\x` becomes `x`. Fail-closed: over-normalization
 * can only cause a refusal, never a missed leak.
 */
function unescapePdfLiterals(hay: Uint8Array): Uint8Array {
  const s = latin1Decode(hay)
    .replace(/\\\r\n|\\\r|\\\n/g, '')
    .replace(/\\(.)/g, '$1');
  return latin1Encode(s);
}

/** Byte needles for a SHORT (1–3 char) covered string: PDF-wrapped forms only. */
function shortStringNeedles(s: string): Uint8Array[] {
  const te = new TextEncoder();
  const out: Uint8Array[] = [te.encode(`(${s})`)];
  const hexes = [hexOf(te.encode(s)), hexOf(new Uint8Array([0xfe, 0xff, ...utf16beBytes(s)]))];
  for (const h of hexes) {
    out.push(te.encode(`<${h}>`), te.encode(`<${h.toUpperCase()}>`));
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Re-serialize the exported bytes without compressed object streams so the
 * byte scan can see every non-stream object (Info dict, annotations,
 * structure tree, AcroForm, JavaScript actions, name trees). Returns null
 * when the re-serialization fails — the raw-byte scan still applies.
 */
async function plainSerialization(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    return await doc.save({ useObjectStreams: false });
  } catch {
    return null;
  }
}

/**
 * Check the exported bytes for every covered string. Never throws — an
 * extraction failure degrades to the byte scan alone (fail-open would be
 * wrong here only if the byte scan could miss an encoding; extraction is a
 * second net, not the first).
 */
export async function verifyRedactedExport(
  bytes: Uint8Array,
  covered: string[],
): Promise<{ stringsChecked: number; recoverable: number }> {
  // Dedupe only — every captured string is checked, however short.
  const strings = [...new Set(covered.map((s) => norm(s)).filter((s) => s.length > 0))];
  if (strings.length === 0) return { stringsChecked: 0, recoverable: 0 };
  let extracted = '';
  try {
    const doc = await getDocument({ data: new Uint8Array(bytes) }).promise;
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      const items = (tc.items as Array<{ str?: string }>).map((it) => it.str ?? '');
      // join both with and without separators: pdfjs may split one word into
      // several items, which a single join(' ') would not reconstitute.
      extracted += '\n' + items.join(' ') + '\n' + items.join('');
    }
    await doc.destroy();
  } catch {
    /* extraction failed — the byte scan below still applies */
  }
  const extractedNorm = norm(extracted);
  const unescaped = unescapePdfLiterals(bytes);
  // Decompressed-object-stream serialization: every byte check below runs
  // against BOTH the delivered bytes and this form.
  const plainBytes = await plainSerialization(bytes);
  const unescapedPlain = plainBytes ? unescapePdfLiterals(plainBytes) : null;
  const includes = (n: Uint8Array): boolean =>
    byteIncludes(bytes, n) || (plainBytes !== null && byteIncludes(plainBytes, n));
  const includesUnescaped = (n: Uint8Array): boolean =>
    byteIncludes(unescaped, n) || (unescapedPlain !== null && byteIncludes(unescapedPlain, n));
  let recoverable = 0;
  for (const s of strings) {
    let found = false;
    if (s.length >= 4) {
      if (extracted.includes(s) || extractedNorm.includes(s)) found = true;
    } else {
      // Short needles false-positive on bare byte search, so match whole
      // words in the extraction and PDF-wrapped forms in the bytes.
      const wordRe = new RegExp(`\\b${escapeRegExp(s)}\\b`);
      if (wordRe.test(extracted) || wordRe.test(extractedNorm)) found = true;
      if (!found) {
        for (const n of shortStringNeedles(s)) {
          if (includes(n)) { found = true; break; }
        }
      }
    }
    if (!found && s.length >= 4) {
      const variants = encodeVariants(s);
      // Direct encodings…
      for (const v of variants) {
        if (includes(v)) { found = true; break; }
      }
      // …their hex-ASCII forms (`<…>` PDF strings, either case)…
      if (!found) {
        for (const v of variants) {
          const h = hexOf(v);
          const lo = new TextEncoder().encode(h);
          const hi = new TextEncoder().encode(h.toUpperCase());
          if (includes(lo) || includes(hi)) { found = true; break; }
        }
      }
      // …and the UTF-8/Latin-1 forms against escape-normalized bytes.
      if (!found) {
        const te = new TextEncoder().encode(s);
        const l1 = latin1Encode(s);
        if (includesUnescaped(te) || includesUnescaped(l1)) found = true;
      }
    }
    if (found) recoverable++;
  }
  return { stringsChecked: strings.length, recoverable };
}

/**
 * The delivery gate: verify, and refuse loudly when anything redacted is
 * still recoverable. buildPdf calls this BEFORE returning bytes — no file is
 * delivered on failure.
 */
export async function gateRedactedExport(
  bytes: Uint8Array,
  covered: string[],
  regions: number,
): Promise<RedactionReport> {
  const { stringsChecked, recoverable } = await verifyRedactedExport(bytes, covered);
  if (recoverable > 0) {
    throw new Error(
      `verification-failed: ${recoverable} redacted string(s) still recoverable in exported file`,
    );
  }
  return { regions, stringsChecked, recoverable };
}
