/**
 * True in-place text editing + vector redaction.
 *
 * "Edit Text" used to paint a background-colored rectangle over the original
 * glyphs and stamp new text on top — an overlay. The original text stayed in
 * the file (selectable, searchable, extractable). This module makes Edit Text
 * REAL: we parse the page's decoded content stream, find the show-text
 * operator that produced the clicked line, and splice the stream so that
 * string is REPLACED with the re-encoded replacement (or removed outright).
 * The exported file contains only the new text — the old bytes are gone.
 *
 * The same engine powers "vector redaction": when a redact box fully covers
 * a line's glyphs, the show operator behind it is deleted from the stream,
 * so the text is unrecoverable even from a hex editor — while the rest of
 * the page stays vector, searchable and razor-sharp. (Pixels-level removal
 * via rasterization remains the fallback for image content / weird fonts.)
 *
 * Feasibility: a show operator can only be rewritten when every byte of its
 * string decodes to exactly one glyph through a single-byte encoding we can
 * invert — standard-14 fonts' WinAnsi/Standard encodings, and embedded
 * TrueType/Type1 simple fonts with a usable single-byte /Differences.
 * Identity/CID subset fonts (2-byte glyph ids) are rejected and keep the
 * overlay fallback in the exporter.
 */

import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFObject,
  PDFRawStream,
  PDFRef,
  PDFString,
  decodePDFRawStream,
} from 'pdf-lib';
// (CropBox/MediaBox accessors come from PDFPageLeaf via page.node)
import type { TextHit } from '../types.js';

/* ------------------------------------------------------------------ */
/* Content-stream tokenizer                                            */
/* ------------------------------------------------------------------ */

export interface Tok {
  kind: 'op' | 'num' | 'name' | 'str' | 'hex' | 'arr' | 'dict' | 'bool' | 'null';
  value?: string | number | boolean | null;
  /** decoded bytes for str/hex tokens */
  bytes?: Uint8Array;
  /** byte range of this token in the decoded stream */
  start: number;
  end: number;
}

/** Decode a Uint8Array to a latin1 string without blowing the call stack. */
function latin1(src: Uint8Array): string {
  let out = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < src.length; i += CHUNK) {
    out += String.fromCharCode.apply(null, Array.from(src.subarray(i, i + CHUNK)) as number[]);
  }
  return out;
}

function bytesOf(str: string): Uint8Array {
  const b = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) b[i] = str.charCodeAt(i) & 0xff;
  return b;
}

/** Tokenize a decoded content stream into tokens with byte spans. */
export function tokenizeContent(src: Uint8Array): Tok[] {
  const s = latin1(src);
  const n = s.length;
  const toks: Tok[] = [];
  let i = 0;
  const isWs = (c: string) => c === '\0' || c === '\t' || c === '\n' || c === '\f' || c === '\r' || c === ' ';
  const isDelim = (c: string) => '()<>[]{}/%'.includes(c);

  while (i < n) {
    const c = s[i];
    if (isWs(c)) { i++; continue; }
    if (c === '%') { while (i < n && s[i] !== '\n' && s[i] !== '\r') i++; continue; }
    if (c === '(') {
      const t = readStringLit(s, i);
      toks.push({ kind: 'str', value: t.text, bytes: bytesOf(t.text), start: i, end: t.end });
      i = t.end;
      continue;
    }
    if (c === '<') {
      if (s[i + 1] === '<') {
        const end = skipDict(s, i);
        toks.push({ kind: 'dict', start: i, end });
        i = end;
      } else {
        const t = readHexLit(s, i);
        toks.push({ kind: 'hex', bytes: t.bytes, start: i, end: t.end });
        i = t.end;
      }
      continue;
    }
    if (c === '[') {
      // record the whole array; sub-tokens parsed on demand for TJ
      let depth = 1;
      let j = i + 1;
      while (j < n && depth > 0) {
        const ch = s[j];
        if (ch === '(') { const t = readStringLit(s, j); j = t.end; continue; }
        if (ch === '<') {
          if (s[j + 1] === '<') j += 2;
          else { const t = readHexLit(s, j); j = t.end; }
          continue;
        }
        if (ch === '[') depth++;
        else if (ch === ']') { depth--; j++; break; }
        if (ch === '%') { while (j < n && s[j] !== '\n' && s[j] !== '\r') j++; continue; }
        j++;
      }
      toks.push({ kind: 'arr', start: i, end: j });
      i = j;
      continue;
    }
    if (c === '/' || c === ']' || c === '{' || c === '}') {
      let j = i + 1;
      if (c === '/') while (j < n && !isWs(s[j]) && !isDelim(s[j])) j++;
      toks.push({ kind: 'name', value: s.slice(i + 1, j), start: i, end: j });
      i = j;
      continue;
    }
    if (/[A-Za-z'" ]/.test(c) && !/[0-9.+-]/.test(c)) {
      let j = i;
      while (j < n && !isWs(s[j]) && !isDelim(s[j])) j++;
      toks.push({ kind: 'op', value: s.slice(i, j), start: i, end: j });
      i = j;
      continue;
    }
    // number
    let j = i;
    while (j < n && !isWs(s[j]) && !isDelim(s[j])) j++;
    const raw = s.slice(i, j);
    const num = parseFloat(raw);
    if (Number.isFinite(num) && /^[0-9.+-]/.test(raw)) toks.push({ kind: 'num', value: num, start: i, end: j });
    else toks.push({ kind: 'op', value: raw, start: i, end: j });
    i = j;
  }
  return toks;
}

/** Read a (…) string literal starting at s[start]==='('. */
function readStringLit(s: string, start: number): { text: string; end: number } {
  let depth = 1;
  let j = start + 1;
  let out = '';
  while (j < s.length) {
    const ch = s[j];
    if (ch === '\\') {
      const e = s[j + 1];
      if (e === 'n') { out += '\n'; j += 2; }
      else if (e === 'r') { out += '\r'; j += 2; }
      else if (e === 't') { out += '\t'; j += 2; }
      else if (e === 'b') { out += '\b'; j += 2; }
      else if (e === 'f') { out += '\f'; j += 2; }
      else if (e >= '0' && e <= '7') {
        let oct = '';
        let k = j + 1;
        while (k < s.length && oct.length < 3 && s[k] >= '0' && s[k] <= '7') { oct += s[k]; k++; }
        out += String.fromCharCode(parseInt(oct, 8) & 0xff);
        j = k;
      } else if (e === '\r') { j += 2; if (s[j] === '\n') j++; }
      else if (e === '\n') { j += 2; }
      else { out += e; j += 2; }
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) { j++; break; }
    }
    out += ch;
    j++;
  }
  return { text: out, end: j };
}

/** Read a <…> hex string starting at s[start]==='<' (not '<<'). */
function readHexLit(s: string, start: number): { bytes: Uint8Array; end: number } {
  let j = start + 1;
  let hex = '';
  while (j < s.length && s[j] !== '>') {
    const c = s[j];
    if (!/\s/.test(c)) hex += c;
    j++;
  }
  j++;
  if (hex.length % 2 === 1) hex += '0';
  const bytes = new Uint8Array(hex.length / 2);
  for (let k = 0; k < bytes.length; k++) bytes[k] = parseInt(hex.slice(k * 2, k * 2 + 2), 16);
  return { bytes, end: j };
}

/** Skip a <<…>> dictionary, returning the index after the closing >>. */
function skipDict(s: string, start: number): number {
  let depth = 1;
  let j = start + 2;
  while (j < s.length && depth > 0) {
    if (s[j] === '(') { const t = readStringLit(s, j); j = t.end; continue; }
    if (s[j] === '<' && s[j + 1] === '<') { depth++; j += 2; continue; }
    if (s[j] === '>' && s[j + 1] === '>') { depth--; j += 2; continue; }
    j++;
  }
  return j;
}

/* ------------------------------------------------------------------ */
/* Text-state tracking + show-op collection                            */
/* ------------------------------------------------------------------ */

export interface Segment {
  /** font resource name active for this segment (without slash) */
  font: string;
  /** glyph bytes exactly as they appeared in the operator operand */
  bytes: Uint8Array;
  /** text-space origin at the START of these glyphs */
  tx: number;
  ty: number;
  /** requested font size (Tf), |value| */
  size: number;
  /** byte span of the STRING OPERAND in the decoded stream */
  start: number;
  end: number;
  op: 'Tj' | 'quote' | 'dquote' | 'TJ';
}

type Mat = [number, number, number, number, number, number];
const IDENT: Mat = [1, 0, 0, 1, 0, 0];

function mul(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

interface TextState {
  font: string;
  size: number;
  tm: Mat;
  trm: Mat;
  leading: number;
}

/**
 * A `Do` (paint-XObject) invocation seen while walking a content stream.
 * `name` is the XObject resource name (without slash); `ctm` is the
 * graphics CTM at the invocation site, mapping XObject-local coordinates
 * into the caller's coordinate space.
 */
export interface DoUse {
  name: string;
  ctm: Mat;
}

/**
 * Walk tokens, maintain graphics/text state, and emit every show-text
 * segment with its user-space origin. Also returns the raw decoded source
 * for TJ sub-parsing, and every `Do` invocation with the CTM in effect at
 * that site (used by the recursive Form-XObject redaction engine).
 */
export function collectShowSegments(src: Uint8Array, toks: Tok[], initialCtm: Mat = IDENT): { segments: Segment[]; source: string; dos: DoUse[] } {
  const segments: Segment[] = [];
  const dos: DoUse[] = [];
  const s = latin1(src);
  let inText = false;
  const st: TextState = { font: '', size: 0, tm: [...IDENT] as Mat, trm: [...IDENT] as Mat, leading: 0 };
  let ctm: Mat = [...initialCtm] as Mat;
  const stack: Array<{ ctm: Mat; inText: boolean; st: TextState }> = [];
  let ops: Tok[] = [];

  for (const t of toks) {
    if (t.kind !== 'op') { ops.push(t); continue; }
    const op = String(t.value);
    switch (op) {
      case 'q':
        stack.push({ ctm, inText, st: { ...st, tm: [...st.tm] as Mat, trm: [...st.trm] as Mat } });
        ops = [];
        break;
      case 'Q': {
        const g = stack.pop();
        if (g) { ctm = g.ctm; inText = g.inText; Object.assign(st, g.st); }
        ops = [];
        break;
      }
      case 'cm': {
        const a = ops.slice(-6);
        if (a.length === 6 && a.every((x) => x.kind === 'num')) {
          ctm = mul([a[0].value as number, a[1].value as number, a[2].value as number, a[3].value as number, a[4].value as number, a[5].value as number], ctm);
        }
        ops = [];
        break;
      }
      case 'Do': {
        const nameT = ops[ops.length - 1];
        if (nameT?.kind === 'name') dos.push({ name: String(nameT.value), ctm: [...ctm] as Mat });
        ops = [];
        break;
      }
      case 'BT':
        inText = true;
        st.tm = [...IDENT] as Mat;
        st.trm = mul(st.tm, ctm);
        ops = [];
        break;
      case 'ET':
        inText = false;
        ops = [];
        break;
      case 'Tf': {
        const szT = ops[ops.length - 1];
        const nameT = ops[ops.length - 2];
        if (szT?.kind === 'num' && nameT?.kind === 'name') {
          st.font = String(nameT.value);
          st.size = Number(szT.value);
        }
        ops = [];
        break;
      }
      case 'TL':
        if (ops[ops.length - 1]?.kind === 'num') st.leading = Number(ops[ops.length - 1].value);
        ops = [];
        break;
      case 'Td': {
        const ty = ops[ops.length - 1];
        const tx = ops[ops.length - 2];
        if (tx?.kind === 'num' && ty?.kind === 'num') {
          st.tm = mul([1, 0, 0, 1, tx.value as number, ty.value as number], st.tm);
          st.trm = mul(st.tm, ctm);
        }
        ops = [];
        break;
      }
      case 'TD': {
        const ty = ops[ops.length - 1];
        const tx = ops[ops.length - 2];
        if (tx?.kind === 'num' && ty?.kind === 'num') {
          st.leading = -(ty.value as number);
          st.tm = mul([1, 0, 0, 1, tx.value as number, ty.value as number], st.tm);
          st.trm = mul(st.tm, ctm);
        }
        ops = [];
        break;
      }
      case 'T*':
        st.tm = mul([1, 0, 0, 1, 0, -st.leading], st.tm);
        st.trm = mul(st.tm, ctm);
        ops = [];
        break;
      case 'Tm': {
        const f = ops.slice(-6);
        if (f.length === 6 && f.every((x) => x.kind === 'num')) {
          st.tm = [f[0].value as number, f[1].value as number, f[2].value as number, f[3].value as number, f[4].value as number, f[5].value as number];
          st.trm = mul(st.tm, ctm);
        }
        ops = [];
        break;
      }
      case 'Tj':
      case "'":
      case '"': {
        const strT = ops[ops.length - 1];
        if (inText && strT && (strT.kind === 'str' || strT.kind === 'hex') && strT.bytes) {
          if (op === "'") { st.tm = mul([1, 0, 0, 1, 0, -st.leading], st.tm); st.trm = mul(st.tm, ctm); }
          if (op === '"') {
            const ac = ops[ops.length - 2];
            const aw = ops[ops.length - 3];
            st.tm = mul([1, 0, 0, 1, -(aw?.kind === 'num' ? aw.value as number : 0), -(ac?.kind === 'num' ? ac.value as number : 0)], st.tm);
            st.tm = mul([1, 0, 0, 1, 0, -st.leading], st.tm);
            st.trm = mul(st.tm, ctm);
          }
          segments.push({ font: st.font, bytes: strT.bytes, tx: st.trm[4], ty: st.trm[5], size: Math.abs(st.size), start: strT.start, end: strT.end, op: op === 'Tj' ? 'Tj' : op === "'" ? 'quote' : 'dquote' });
        }
        ops = [];
        break;
      }
      case 'TJ': {
        const arrT = ops[ops.length - 1];
        if (inText && arrT?.kind === 'arr') {
          // collect string elements directly from the source span
          let j = arrT.start + 1;
          while (j < arrT.end - 1) {
            const ch = s[j];
            if (ch === '(') {
              const t2 = readStringLit(s, j);
              segments.push({ font: st.font, bytes: bytesOf(t2.text), tx: st.trm[4], ty: st.trm[5], size: Math.abs(st.size), start: j, end: t2.end, op: 'TJ' });
              j = t2.end;
            } else if (ch === '<' && s[j + 1] !== '<') {
              const t2 = readHexLit(s, j);
              segments.push({ font: st.font, bytes: t2.bytes, tx: st.trm[4], ty: st.trm[5], size: Math.abs(st.size), start: j, end: t2.end, op: 'TJ' });
              j = t2.end;
            } else if (ch === '%' && s[j + 1] !== '<') {
              while (j < arrT.end && s[j] !== '\n' && s[j] !== '\r') j++;
            } else j++;
          }
        }
        ops = [];
        break;
      }
      default:
        if (ops.length > 8) ops = [];
        break;
    }
  }
  return { segments, source: s, dos };
}

/* ------------------------------------------------------------------ */
/* Font encoding inversion                                             */
/* ------------------------------------------------------------------ */

/** WinAnsi 0x80–0x9F codes that differ from Latin-1. */
const WINANSI_HIGH: Record<number, string> = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡', 0x88: 'ˆ', 0x89: '‰',
  0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž', 0x91: '\u2018', 0x92: '\u2019', 0x93: '\u201c', 0x94: '\u201d',
  0x95: '•', 0x96: '–', 0x97: '—', 0x98: '˜', 0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ',
};
const WINANSI_REV: Record<string, number> = {};
for (const [k, v] of Object.entries(WINANSI_HIGH)) WINANSI_REV[v] = Number(k);

/** Decode one byte through a simple font encoding (null = not invertible). */
function decodeSimple(b: number, diffs: (string | null)[] | null, base: 'std' | 'win'): string | null {
  if (b === 0) return null;
  if (diffs && b < diffs.length) {
    const g = diffs[b];
    if (g !== undefined) return g; // may be null → unmapped
  }
  if (b < 0x20 || b === 0x7f) return null;
  if (b < 0x7f) return String.fromCharCode(b);
  if (base === 'win') {
    const hi = WINANSI_HIGH[b];
    if (hi) return hi;
  }
  return String.fromCharCode(b); // Latin-1 tail
}

export interface FontInfo {
  /** base encoding implied by the font dict */
  base: 'std' | 'win';
  /** per-code overrides from /Differences (sparse) */
  diffs: (string | null)[] | null;
  /** glyph widths, code → width/1000 */
  widths: Map<number, number>;
  /** family guess used to pick the re-embed font */
  replacement: 'helv' | 'times' | 'courier';
  /** not-def code (usually 0) — excluded from text matching */
  ncode: number;
}

/** Inspect a font resource; null when its strings are not invertible. */
export function readFontInfo(lib: PDFDocument, fontRes: unknown): FontInfo | null {
  try {
    const dict = fontRes instanceof PDFRef ? lib.context.lookup(fontRes) : fontRes;
    if (!(dict instanceof PDFDict)) return null;
    const subT = dict.get(PDFName.of('Subtype'));
    const sub = subT instanceof PDFName ? subT.asString() : '';
    if (sub === '/Type0' || sub === '/Type3') return null;
    let base: 'std' | 'win' = 'std';
    const encObjRaw = dict.get(PDFName.of('Encoding'));
    if (encObjRaw instanceof PDFName) {
      if (encObjRaw.asString() === '/WinAnsiEncoding') base = 'win';
    }
    let diffs: (string | null)[] | null = null;
    const encObj = encObjRaw instanceof PDFRef ? lib.context.lookup(encObjRaw) : encObjRaw;
    if (encObj instanceof PDFDict) {
      const diffArr = encObj.lookupMaybe(PDFName.of('Differences'), PDFArray);
      if (diffArr) {
        diffs = [];
        let code = 0;
        for (let i = 0; i < diffArr.size(); i++) {
          const el = lib.context.lookup(diffArr.get(i));
          if (el instanceof PDFNumber) { code = el.asNumber(); continue; }
          if (el instanceof PDFName) {
            diffs[code] = glyphNameToUnicode(el.asString().replace(/^\//, ''));
            code++;
          }
        }
      }
    }
    const widths = new Map<number, number>();
    const fc = dict.lookupMaybe(PDFName.of('FirstChar'), PDFNumber);
    const wArr = dict.lookupMaybe(PDFName.of('Widths'), PDFArray);
    if (fc && wArr) {
      for (let i = 0; i < wArr.size(); i++) {
        const w = lib.context.lookupMaybe(wArr.get(i), PDFNumber);
        if (w) widths.set(fc.asNumber() + i, w.asNumber());
      }
    }
    const bf = dict.lookupMaybe(PDFName.of('BaseFont'), PDFName)?.asString().toLowerCase() ?? '';
    const replacement: FontInfo['replacement'] = bf.includes('times')
      ? 'times'
      : bf.includes('courier') || bf.includes('mono')
        ? 'courier'
        : 'helv';
    return { base, diffs, widths, replacement, ncode: 0 };
  } catch {
    return null;
  }
}

/** Minimal AGL: glyph name → unicode. */
export function glyphNameToUnicode(gn: string): string | null {
  const uni = /^u([0-9a-fA-F]{4,6})$/.exec(gn);
  if (uni) return String.fromCodePoint(parseInt(uni[1], 16));
  const table: Record<string, string> = {
    space: ' ', exclam: '!', quotedbl: '"', numbersign: '#', dollar: '$', percent: '%', ampersand: '&',
    quotesingle: "'", parenleft: '(', parenright: ')', asterisk: '*', plus: '+', comma: ',', hyphen: '-',
    period: '.', slash: '/', zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6',
    seven: '7', eight: '8', nine: '9', colon: ':', semicolon: ';', less: '<', equal: '=', greater: '>',
    question: '?', at: '@', bracketleft: '[', backslash: '\\', bracketright: ']', asciicircum: '^',
    underscore: '_', grave: '`', braceleft: '{', bar: '|', braceright: '}', asciitilde: '~',
    endash: '–', emdash: '—', quotedblleft: '\u201c', quotedblright: '\u201d', quoteleft: '\u2018',
    quoteright: '\u2019', bullet: '•', ellipsis: '…', trademark: '™', registered: '®', copyright: '©',
    degree: '°', plusminus: '±', multiply: '×', divide: '÷', Euro: '€', euro: '€', nbspace: ' ',
    fi: 'fi', fl: 'fl', germandbls: 'ß', ae: 'æ', AE: 'Æ', oe: 'œ', OE: 'Œ', softhyphen: '',
  };
  if (gn in table) return table[gn];
  if (/^[A-Za-z]$/.test(gn)) return gn;
  return null;
}

/** Encode replacement text as WinAnsi bytes (null when not representable). */
export function encodeWinAnsi(text: string): Uint8Array | null {
  const out: number[] = [];
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c < 0x20) return null;
    if (c < 0x7f) { out.push(c); continue; }
    if (c === 0xa0) { out.push(0x20); continue; }
    if (c <= 0xff) { out.push(c); continue; }
    const rev = WINANSI_REV[ch];
    if (rev !== undefined) { out.push(rev); continue; }
    return null;
  }
  return new Uint8Array(out);
}

/* ------------------------------------------------------------------ */
/* High-level: rewrite one page's text                                 */
/* ------------------------------------------------------------------ */

export interface LineOp {
  seg: Segment;
  /** decoded printable text */
  text: string;
  font: FontInfo;
  /** approximate advance width in user-space units */
  advance: number;
}

export interface DeepEditRequest {
  /** content-space hit (from TextHit: y-up, crop-box origin) */
  hit: Pick<TextHit, 'x' | 'y' | 'w' | 'h' | 'text' | 'cell' | 'gapBefore'>;
  /** replacement text; null deletes the line without replacement */
  newText: string | null;
  /** requested font size (points) for the injected text */
  size?: number;
  /** hex color for the injected text, e.g. '#17171b' */
  color?: string;
  /** standard font family for the injected text (Helvetica/Times/Courier) */
  font?: string;
}

export interface PageRewritePlan {
  /** decoded stream with the target line's operand spliced */
  bytes: Uint8Array;
  /** the matched line (decoded) */
  matched: LineOp;
  /** all recognized lines (for redaction batching) */
  lines: LineOp[];
  /** true when the WHOLE line was rewritten in the stream (the exporter can
   *  then skip drawing the annotation overlay — the replacement text is part
   *  of the page content itself) */
  lineReplace: boolean;
}

/** True when the page's resources reference image XObjects (incl. inherited). */
function pageHasImages(lib: PDFDocument, node: import('pdf-lib').PDFPageLeaf): boolean {
  try {
    let cur: import('pdf-lib').PDFPageLeaf | undefined = node;
    for (let hops = 0; cur && hops < 8; hops++) {
      const res = cur.Resources();
      if (res) {
        const xo = res.lookupMaybe(PDFName.of('XObject'), PDFDict);
        if (xo) {
          for (const [, val] of xo.entries()) {
            const obj = lib.context.lookup(val);
            if (obj instanceof PDFRawStream) {
              const sub = obj.dict.get(PDFName.of('Subtype'));
              if (sub instanceof PDFName && sub.asString() === '/Image') return true;
            } else if (obj instanceof PDFDict) {
              const sub = obj.get(PDFName.of('Subtype'));
              if (sub instanceof PDFName && sub.asString() === '/Image') return true;
            }
          }
        }
      }
      // walk up for inherited resources
      const parentRaw = node.get(PDFName.of('Parent'));
      const parent = parentRaw ? lib.context.lookup(parentRaw) : undefined;
      cur = parent as import('pdf-lib').PDFPageLeaf | undefined;
      if (!(cur && typeof (cur as { Resources?: unknown }).Resources === 'function')) break;
    }
  } catch {
    return true; // be safe: assume images when unsure
  }
  return false;
}

/** True when the page's resources reference Form XObjects (incl. inherited).
 *  Text painted inside a Form XObject lives in the XObject's own content
 *  stream, which the vector redaction engine does not parse — so a page with
 *  Form XObjects must keep the raster path (or be skipped), never the vector
 *  path, or redacted text could survive visibly covered but extractable. */
function pageHasFormXObjects(lib: PDFDocument, node: import('pdf-lib').PDFPageLeaf): boolean {
  try {
    let cur: import('pdf-lib').PDFPageLeaf | undefined = node;
    for (let hops = 0; cur && hops < 8; hops++) {
      const res = cur.Resources();
      if (res) {
        const xo = res.lookupMaybe(PDFName.of('XObject'), PDFDict);
        if (xo) {
          for (const [, val] of xo.entries()) {
            const obj = lib.context.lookup(val);
            if (obj instanceof PDFRawStream) {
              const sub = obj.dict.get(PDFName.of('Subtype'));
              if (sub instanceof PDFName && sub.asString() === '/Form') return true;
            } else if (obj instanceof PDFDict) {
              const sub = obj.get(PDFName.of('Subtype'));
              if (sub instanceof PDFName && sub.asString() === '/Form') return true;
            }
          }
        }
      }
      // walk up for inherited resources
      const parentRaw = node.get(PDFName.of('Parent'));
      const parent = parentRaw ? lib.context.lookup(parentRaw) : undefined;
      cur = parent as import('pdf-lib').PDFPageLeaf | undefined;
      if (!(cur && typeof (cur as { Resources?: unknown }).Resources === 'function')) break;
    }
  } catch {
    return true; // be safe: assume Form XObjects when unsure
  }
  return false;
}

/** True when the page's resources reference /Pattern entries (incl. inherited).
 *  Tiling patterns carry their own content streams, which can contain text
 *  the engine does not parse — a page using patterns must keep the raster
 *  path so redacted content cannot survive inside a pattern. */
function pageHasPatternResources(lib: PDFDocument, node: import('pdf-lib').PDFPageLeaf): boolean {
  try {
    let cur: import('pdf-lib').PDFPageLeaf | undefined = node;
    for (let hops = 0; cur && hops < 8; hops++) {
      const res = cur.Resources();
      if (res) {
        const pat = res.lookupMaybe(PDFName.of('Pattern'), PDFDict);
        if (pat) return true;
      }
      const parentRaw = node.get(PDFName.of('Parent'));
      const parent = parentRaw ? lib.context.lookup(parentRaw) : undefined;
      cur = parent as import('pdf-lib').PDFPageLeaf | undefined;
      if (!(cur && typeof (cur as { Resources?: unknown }).Resources === 'function')) break;
    }
  } catch {
    return true; // be safe: assume patterns when unsure
  }
  return false;
}

/** True when the token stream contains an inline image (BI…EI). Inline
 *  images are painted from raw bytes the tokenizer does not model — a page
 *  using them must keep the raster path. */
function streamHasInlineImages(toks: Tok[]): boolean {
  for (const t of toks) {
    if (t.kind === 'op' && t.value === 'BI') return true;
  }
  return false;
}

/** Decode + recognize all invertible show-text lines on a page. */
export function recognizePageText(lib: PDFDocument, pageIndex: number): {
  lines: LineOp[]; cropX: number; cropY: number; stream: PDFRawStream; decoded: Uint8Array; source: string;
  hasImages: boolean; hasFormXObjects: boolean;
  /** true when a show-text segment was skipped because its font is not
   *  invertible (missing, Type0/CID, Type3) or its bytes did not decode —
   *  such text is invisible to the engine and must force the raster path */
  hasUnrecognizedText: boolean;
  /** true when /Pattern resources are present (pattern content streams can
   *  carry text the engine does not parse) */
  hasPatterns: boolean;
  /** true when the content stream contains inline images (BI…EI) */
  hasInlineImages: boolean;
} | null {
  const page = lib.getPage(pageIndex);
  const node = page.node;
  const contents = node.get(PDFName.of('Contents'));
  // Gather every stream in Contents (single stream or array of streams).
  // We concatenate them so pages with split content streams still qualify.
  const streams: PDFRawStream[] = [];
  const collect = (obj: unknown): void => {
    const resolved = obj instanceof PDFRef ? lib.context.lookup(obj) : obj;
    if (resolved instanceof PDFRawStream) streams.push(resolved);
    else if (resolved instanceof PDFArray) {
      for (let i = 0; i < resolved.size(); i++) collect(resolved.get(i));
    }
  };
  collect(contents);
  if (streams.length === 0) return null;
  const concat = (list: PDFRawStream[]): Uint8Array => {
    const decs = list.map((st) => decodePDFRawStream(st).decode());
    let total = 0;
    for (const d of decs) total += d.length;
    const out = new Uint8Array(total);
    let off = 0;
    for (const d of decs) { out.set(d, off); off += d.length; }
    return out;
  };
  const decoded = concat(streams);
  const toks = tokenizeContent(decoded);
  // CropBox may live on the page or be inherited; MediaBox is the fallback.
  const boxArr = (node.CropBox() ?? node.MediaBox()) as PDFArray | undefined;
  let cropX = 0;
  let cropY = 0;
  if (boxArr && boxArr.size() >= 2) {
    const x = lib.context.lookupMaybe(boxArr.get(0), PDFNumber);
    const y = lib.context.lookupMaybe(boxArr.get(1), PDFNumber);
    if (x && y) { cropX = x.asNumber(); cropY = y.asNumber(); }
  }
  const resDict = node.Resources();
  const fonts = new Map<string, FontInfo>();
  if (resDict) {
    const fontDict = resDict.lookupMaybe(PDFName.of('Font'), PDFDict);
    if (fontDict) {
      for (const [key, val] of fontDict.entries()) {
        const info = readFontInfo(lib, val);
        if (info) fonts.set(key.asString(), info);
      }
    }
  }
  const { segments } = collectShowSegments(decoded, toks);
  const lines: LineOp[] = [];
  let hasUnrecognizedText = false;
  for (const seg of segments) {
    const info = fonts.get('/' + seg.font) ?? fonts.get(seg.font);
    if (!info) { hasUnrecognizedText = true; continue; }
    let text = '';
    let ok = seg.bytes.length > 0;
    let advance = 0;
    for (const byte of seg.bytes) {
      const ch = decodeSimple(byte, info.diffs, info.base);
      if (ch === null) { ok = false; break; }
      text += ch;
      advance += ((info.widths.get(byte) ?? 500) / 1000) * seg.size;
    }
    if (!ok) { hasUnrecognizedText = true; continue; }
    if (!text.trim()) continue;
    lines.push({ seg, text, font: info, advance });
  }
  return {
    lines, cropX, cropY, stream: streams[0], decoded, source: latin1(decoded),
    hasImages: pageHasImages(lib, node),
    hasFormXObjects: pageHasFormXObjects(lib, node),
    hasUnrecognizedText,
    hasPatterns: pageHasPatternResources(lib, node),
    hasInlineImages: streamHasInlineImages(toks),
  };
}

/** Score a line against a hit: text similarity + origin proximity. */
function scoreLine(ln: LineOp, hit: DeepEditRequest['hit'], cropX: number, cropY: number): number {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  const a = norm(ln.text);
  const b = norm(hit.text);
  if (!a || !b) return -1;
  let textScore: number;
  if (a === b) textScore = 1;
  else if (a.includes(b) || b.includes(a)) textScore = 0.7;
  else {
    const at = a.split(' ');
    const bt = b.split(' ');
    const inter = bt.filter((t) => at.includes(t)).length;
    textScore = 0.4 * (inter / Math.max(1, Math.min(at.length, bt.length)));
  }
  const dist = Math.hypot(ln.seg.tx - (hit.x + cropX), ln.seg.ty - (hit.y + cropY));
  const near = Math.max(0, 1 - dist / 60);
  return textScore * 2 + near;
}

/** Apply byte splices (sorted, non-overlapping) to a decoded stream. */
function applySplices(src: Uint8Array, splices: Array<{ start: number; end: number; bytes: Uint8Array }>): Uint8Array {
  const parts: Uint8Array[] = [];
  let cursor = 0;
  for (const sp of splices) {
    if (sp.start < cursor) continue;
    parts.push(src.subarray(cursor, sp.start));
    parts.push(sp.bytes);
    cursor = sp.end;
  }
  parts.push(src.subarray(cursor));
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

/** Wrap bytes as a PDF hex-string operand <...>. */
function hexOperand(bytes: Uint8Array): Uint8Array {
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return bytesOf(`<${hex}>`);
}

/** Does the target token sit inside a TJ array? Returns the array token. */
function enclosingArray(src: string, tok: Tok, toks: Tok[]): Tok | null {
  const idx = toks.indexOf(tok);
  for (let i = idx - 1; i >= 0; i--) {
    const t = toks[i];
    if (t.kind === 'arr') {
      if (t.start <= tok.start && t.end >= tok.end) return t;
      break;
    }
    if (t.kind === 'op') break;
  }
  return null;
}

/** Sum of the TJ kerning numbers (in thousandths of a text-space unit) that
 *  sit between `arr.start` and `tok.start`. */
function kernBefore(src: string, arr: Tok, tok: Tok): number {
  let sum = 0;
  let i = arr.start + 1;
  while (i < tok.start) {
    const ch = src[i];
    if (ch === '(') { const t = readStringLit(src, i); i = t.end; continue; }
    if (ch === '<' && src[i + 1] !== '<') { const t = readHexLit(src, i); i = t.end; continue; }
    if (/[0-9.+-]/.test(ch)) {
      let j = i;
      while (j < tok.start && /[0-9.+-]/.test(src[j])) j++;
      const n = parseFloat(src.slice(i, j));
      if (Number.isFinite(n)) sum += n;
      i = j;
      continue;
    }
    i++;
  }
  return sum;
}

/**
 * Build the replacement operand for a substring edit inside a TJ array:
 * `<newText> <adjust> TJ` — the adjustment (negative, in thousandths of a
 * text-space unit) restores the original cell advance so neighboring cells
 * keep their exact positions.
 */
function tjOperand(newText: string, size: number, keepWidth: number): Uint8Array | null {
  const enc = encodeWinAnsi(newText);
  if (!enc) return null;
  const glyphW = ((enc.length * 500) / 1000) * size; // Helvetica-ish average
  const adjust = keepWidth - glyphW; // points to reclaim after the new glyphs
  let s = `<${[...enc].map((b) => b.toString(16).padStart(2, '0')).join('')}>`;
  if (Math.abs(adjust) > 0.05) s += ` ${(-adjust / Math.max(0.01, size) * 1000).toFixed(1)}`;
  return bytesOf(s);
}

/**
 * Build a TJ-array operand for a SINGLE-STRING `Tj` line that contains
 * several table cells: `<left> <gap> <new> <trailing-adjust> TJ` — the gap
 * kerning reproduces the original space between cells, and the trailing
 * adjustment preserves the cell's original advance so the following cells
 * keep their exact positions.
 */
function subTjOperand(prefix: string, gapBefore: number, newText: string, size: number, segW: number, trailing: string): Uint8Array | null {
  const newBytes = encodeWinAnsi(newText);
  if (!newBytes) return null;
  const newHex = [...newBytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  const parts: string[] = [];
  const cleanPrefix = prefix.replace(/\s+$/, '');
  let prefixBytes: Uint8Array | null = null;
  if (cleanPrefix.length > 0) {
    prefixBytes = encodeWinAnsi(cleanPrefix);
    if (!prefixBytes) return null;
    parts.push(`<${[...prefixBytes].map((b) => b.toString(16).padStart(2, '0')).join('')}>`);
    const gapKern = -(gapBefore / Math.max(0.01, size)) * 1000; // 1e-3 text units
    if (Math.abs(gapKern) > 0.05) parts.push(gapKern.toFixed(1));
  }
  parts.push(`<${newHex}>`);
  const trailingBytes = encodeWinAnsi(trailing.trimStart());
  if (trailingBytes && trailingBytes.length > 0) {
    parts.push(`<${[...trailingBytes].map((b) => b.toString(16).padStart(2, '0')).join('')}>`);
  }
  // Reclaim the width difference so the row keeps its total advance: the
  // replacement must occupy the same advance as the cell it replaces, and the
  // (trimmed) gap before it is re-added as kerning.
  const prefixW = ((prefixBytes?.length ?? 0) * 500) / 1000 * size;
  const newW = ((newBytes.length * 500) / 1000) * size;
  const trailW = ((trailingBytes?.length ?? 0) * 500) / 1000 * size;
  const gapW = gapBefore;
  const adjust = segW - (prefixW + gapW + newW + trailW); // points to reclaim
  if (Math.abs(adjust) > 0.05) parts.push((-(adjust / Math.max(0.01, size)) * 1000).toFixed(1));
  return bytesOf(`[${parts.join(' ')}]`);
}

/**
 * Plan a deep edit. When the hit is a whole line, the string operand is
 * replaced outright. When it is ONE CELL of a wider row (`hit.cell`), only
 * the matched substring is replaced — a TJ adjustment restores the original
 * cell advance, so the row's other cells keep their exact positions and the
 * layout does NOT reflow. Returns null when no confident match exists
 * (caller keeps the overlay fallback) or when the edit cannot be represented.
 */
export function planDeepEdit(lib: PDFDocument, pageIndex: number, req: DeepEditRequest): PageRewritePlan | null {
  const rec = recognizePageText(lib, pageIndex);
  if (!rec || rec.lines.length === 0) return null;
  let best = -1;
  let bestScore = -Infinity;
  for (let i = 0; i < rec.lines.length; i++) {
    const sc = scoreLine(rec.lines[i], req.hit, rec.cropX, rec.cropY);
    if (sc > bestScore) { bestScore = sc; best = i; }
  }
  if (best < 0 || bestScore < 1.2) return null;
  const target = rec.lines[best];
  const seg = target.seg;

  const replacement = req.newText ?? '';
  if (replacement.length === 0) {
    // deletion: remove the matched line (or cell substring) from the stream
    // NB: emit an EMPTY STRING, not nothing — a bare `Tj` with no operand is
    // invalid PDF and breaks text extraction in strict parsers.
    const bytes = applySplices(rec.decoded, [{ start: seg.start, end: seg.end, bytes: bytesOf('()') }]);
    return { bytes, matched: target, lines: rec.lines, lineReplace: true };
  }

  const enc = encodeWinAnsi(replacement);
  if (!enc) return null; // replacement can't be represented in WinAnsi → overlay
  const size = Math.max(4, req.size ?? seg.size);

  if (!req.hit.cell) {
    // whole-line rewrite
    const operand = hexOperand(enc);
    const bytes = applySplices(rec.decoded, [{ start: seg.start, end: seg.end, bytes: operand }]);
    return { bytes, matched: target, lines: rec.lines, lineReplace: true };
  }

  // Cell edit inside a (possibly TJ) segment: match the substring within the
  // segment's decoded text and replace only its byte span.
  const segToks = tokenizeContent(rec.decoded);
  const strTok =
    segToks.find((t) => t.kind === 'str' && t.start === seg.start && t.end === seg.end) ??
    segToks.find((t) => t.kind === 'hex' && t.start === seg.start && t.end === seg.end);
  const arr = strTok ? enclosingArray(rec.source, strTok, segToks) : null;
  if (!strTok) return null;
  const txt = target.text; // decoded segment text (may include spaces)
  const want = (req.hit.text ?? '').replace(/\s+/g, ' ').trim();
  const at = txt.indexOf(want);
  if (at < 0) return null;
  if (arr) {
    // TJ: replace the string element and re-emit the leading gap as kerning
    const kern = kernBefore(rec.source, arr, strTok);
    const base = target.font.widths;
    const segW =
      (Array.from(txt).reduce((acc, ch) => acc + (base.get(ch.charCodeAt(0)) ?? 500), 0) / 1000) * seg.size;
    const keep = (kern / 1000) * seg.size + segW; // original total advance
    const op = tjOperand(replacement, size, keep);
    if (!op) return null;
    const bytes = applySplices(rec.decoded, [{ start: strTok.start, end: strTok.end, bytes: op }]);
    return { bytes, matched: target, lines: rec.lines, lineReplace: false };
  }
  // Single Tj: the segment may be ONE STRING that contains several table
  // cells ("R18027182586  BytesPak  2500.00 USD …"). When the clicked cell is
  // a substring with text before it, splice INSIDE the string operand and
  // re-emit it as a TJ array that preserves the original spacing — so the
  // row's other cells keep their exact positions. When the hit covers the
  // whole string, replace it outright.
  const prefix = txt.slice(0, at);
  const trailing = txt.slice(at + want.length);
  // The hit covers the whole string only when nothing meaningful follows it
  // (or precedes it). Otherwise this string contains MORE cells — edit the
  // substring in place and keep the rest of the row untouched.
  const cellIsWhole = prefix.trim().length === 0 && trailing.trim().length === 0;
  if (cellIsWhole) {
    const operand = hexOperand(enc);
    const bytes = applySplices(rec.decoded, [{ start: seg.start, end: seg.end, bytes: operand }]);
    return { bytes, matched: target, lines: rec.lines, lineReplace: true };
  }
  const gap = Math.max(0, req.hit.gapBefore ?? 0);
  // The output keeps the text BEFORE the clicked cell, then the replacement,
  // with the inter-cell gap reproduced as TJ kerning so the cells after the
  // edit land exactly where they did in the original row.
  const segW = (txt.length * 500) / 1000 * seg.size;
  const op = subTjOperand(prefix, gap, replacement, size, segW, trailing);
  if (!op) return null;
  // subTjOperand emits a TJ ARRAY, but this branch handles a bare `Tj`
  // string-show. Splicing `[<..>]` in place of the string while leaving the
  // `Tj` operator produces invalid PDF (Tj takes a string, not an array)
  // and silently kills the page's text — so the splice must also swap the
  // operator token to `TJ`. Only `Tj` is safe to rewrite this way; quote /
  // dquote carry line-positioning side effects, so bail on those.
  if (seg.op !== 'Tj') return null;
  const opTok = segToks.find((t) => t.kind === 'op' && t.start >= strTok.end);
  if (!opTok || opTok.value !== 'Tj') return null;
  const tj = new Uint8Array(op.length + 3);
  tj.set(op, 0);
  tj.set(bytesOf(' TJ'), op.length);
  const bytes = applySplices(rec.decoded, [{ start: seg.start, end: opTok.end, bytes: tj }]);
  return { bytes, matched: target, lines: rec.lines, lineReplace: false };
}

/* ------------------------------------------------------------------ */
/* Recursive Form-XObject redaction                                   */
/* ------------------------------------------------------------------ */

type Coverage = 'full' | 'partial' | 'none';

/**
 * Classify a text line's bbox against redact rects. `tx,ty` is the line
 * origin in the same space as the rects once `cropX/cropY` are added —
 * the page-level caller passes IDENTITY-based walker output and the rects
 * are crop-box-relative, so the crop offset is added here.
 *
 * Exported for the pre-export covered-string capture (redactVerify) and the
 * vector-graphics pass below.
 */
export function lineCoverage(
  tx: number, ty: number, advance: number, size: number,
  rects: Array<{ x: number; y: number; w: number; h: number }>,
  cropX: number, cropY: number,
): Coverage {
  const lx0 = tx;
  const ly0 = ty - size * 0.25;
  const lx1 = tx + advance;
  const ly1 = ty + size * 0.85;
  let touches = false;
  for (const r of rects) {
    const rx0 = r.x + cropX;
    const ry0 = r.y + cropY;
    const rx1 = rx0 + r.w;
    const ry1 = ry0 + r.h;
    const intersects = lx0 < rx1 && lx1 > rx0 && ly0 < ry1 && ly1 > ry0;
    if (!intersects) continue;
    if (lx0 >= rx0 - 0.5 && lx1 <= rx1 + 0.5 && ly0 >= ry0 - 0.5 && ly1 <= ry1 + 0.5) return 'full';
    touches = true;
  }
  return touches ? 'partial' : 'none';
}

/** Resolve a possibly-indirect PDFDict value. */
function resolveDict(lib: PDFDocument, obj: unknown): PDFDict | undefined {
  const r = obj instanceof PDFRef ? lib.context.lookup(obj) : obj;
  return r instanceof PDFDict ? r : undefined;
}

/** Read a /Matrix entry (6 numbers) or return identity. */
function matrixOf(dict: PDFDict, lib: PDFDocument): Mat {
  try {
    const raw = dict.get(PDFName.of('Matrix'));
    const arr = raw instanceof PDFRef ? lib.context.lookup(raw) : raw;
    if (arr instanceof PDFArray && arr.size() >= 6) {
      const v: number[] = [];
      for (let i = 0; i < 6; i++) {
        const n = lib.context.lookupMaybe(arr.get(i), PDFNumber);
        if (!n) return [...IDENT] as Mat;
        v.push(n.asNumber());
      }
      return [v[0], v[1], v[2], v[3], v[4], v[5]];
    }
  } catch {
    /* fall through to identity */
  }
  return [...IDENT] as Mat;
}

/** Build the invertible-font map for a resources dict. */
function buildFontMap(lib: PDFDocument, res: PDFDict): Map<string, FontInfo> {
  const fonts = new Map<string, FontInfo>();
  try {
    const fontDict = res.lookupMaybe(PDFName.of('Font'), PDFDict);
    if (fontDict) {
      for (const [key, val] of fontDict.entries()) {
        const info = readFontInfo(lib, val);
        if (info) fonts.set(key.asString(), info);
      }
    }
  } catch {
    /* treat as no fonts */
  }
  return fonts;
}

/**
 * Pre-scan: true when ANY image XObject is reachable from a resources dict,
 * recursing through nested Form XObjects (cycle-safe). Images can paint
 * redacted content as pixels, so the vector path is never safe for them.
 */
function formTreeHasImages(lib: PDFDocument, res: PDFDict | undefined, seen: Set<string>): boolean {
  if (!res) return false;
  try {
    const xo = res.lookupMaybe(PDFName.of('XObject'), PDFDict);
    if (!xo) return false;
    for (const [, val] of xo.entries()) {
      const obj = lib.context.lookup(val);
      if (!(obj instanceof PDFRawStream)) continue;
      const subRaw = obj.dict.get(PDFName.of('Subtype'));
      const sub = subRaw instanceof PDFName ? subRaw.asString() : '';
      if (sub === '/Image') return true;
      if (sub === '/Form') {
        const ref = val instanceof PDFRef ? val : null;
        const key = ref ? ref.toString() : '';
        if (key && seen.has(key)) continue;
        if (key) seen.add(key);
        if (formTreeHasImages(lib, resolveDict(lib, obj.dict.get(PDFName.of('Resources'))), seen)) return true;
      }
    }
  } catch {
    return true; // be safe: assume images when unsure
  }
  return false;
}

/**
 * Register a fresh XObject stream (clone-on-write installer). The caller
 * supplies the decoded bytes and a fully-prepared dict (cloned from the
 * original, with /Length refreshed at save time by pdf-lib).
 */
export function installXObjectStream(lib: PDFDocument, bytes: Uint8Array, dict: PDFDict): PDFRef {
  return lib.context.register(PDFRawStream.of(dict, bytes));
}

/** Decode one segment's bytes through a font; null when not invertible. */
function decodeSegment(seg: Segment, info: FontInfo): { advance: number } | null {
  let advance = 0;
  if (seg.bytes.length === 0) return null;
  for (const byte of seg.bytes) {
    const ch = decodeSimple(byte, info.diffs, info.base);
    if (ch === null) return null;
    advance += ((info.widths.get(byte) ?? 500) / 1000) * seg.size;
  }
  return { advance };
}

export type FormRedactOutcome =
  | { ok: true; ref: PDFRef; changed: boolean; removed: number; partial: number; covered: string[] }
  | { ok: false };

/**
 * Recursively redact vector text inside a Form XObject.
 *
 * `toPage` maps XObject-local coordinates into page/content space (the CTM
 * at the `Do` site that invoked this XObject); `rects` are crop-box-relative
 * redact rects; `fontFallback` is the page-level /Resources used when the
 * XObject has none of its own. `depth` caps nesting at 8 and `seen` guards
 * the current recursion path against cycles — either cap reports
 * `{ ok: false }` ("unverifiable"), which the caller turns into the raster
 * fallback. Any image `Do` encountered mid-recursion also aborts to raster.
 *
 * Clone-on-write: new stream objects are created ONLY when a splice happened
 * in this XObject or a nested child changed (in which case the child's new
 * ref is remapped through a CLONED /Resources /XObject dict — shared or
 * inherited dicts are never mutated). The original stream is untouched, so
 * other pages sharing the XObject are unaffected.
 */
export function planFormXObjectRedaction(
  lib: PDFDocument,
  xobjRef: PDFRef,
  toPage: Mat,
  rects: Array<{ x: number; y: number; w: number; h: number }>,
  cropX: number,
  cropY: number,
  fontFallback: PDFDict | undefined,
  depth: number,
  seen: Set<string>,
): FormRedactOutcome {
  if (depth > 8) return { ok: false };
  const key = xobjRef.toString();
  if (seen.has(key)) return { ok: false }; // recursion cycle — unverifiable
  const obj = lib.context.lookup(xobjRef);
  if (!(obj instanceof PDFRawStream)) return { ok: false };
  const subRaw = obj.dict.get(PDFName.of('Subtype'));
  const sub = subRaw instanceof PDFName ? subRaw.asString() : '';
  if (sub === '/Image') return { ok: false }; // image Do — raster path
  if (sub !== '/Form') return { ok: false };
  seen.add(key);
  try {
    const matrix = matrixOf(obj.dict, lib);
    const pageCtm = mul(matrix, toPage);
    const res = resolveDict(lib, obj.dict.get(PDFName.of('Resources'))) ?? fontFallback;
    const fonts = res ? buildFontMap(lib, res) : new Map<string, FontInfo>();
    const decoded = decodePDFRawStream(obj).decode();
    const toks = tokenizeContent(decoded);
    if (streamHasInlineImages(toks)) return { ok: false };
    const { segments, dos } = collectShowSegments(decoded, toks, pageCtm);

    const splices: Array<{ start: number; end: number; bytes: Uint8Array }> = [];
    let removed = 0;
    let partial = 0;
    const covered: string[] = [];
    for (const seg of segments) {
      const info = fonts.get('/' + seg.font) ?? fonts.get(seg.font);
      if (!info) return { ok: false }; // non-invertible font — unverifiable
      const dec = decodeSegment(seg, info);
      if (!dec) return { ok: false };
      const cov = lineCoverage(seg.tx, seg.ty, dec.advance, seg.size, rects, cropX, cropY);
      if (cov === 'full') {
        // NB: `()` not empty — a bare `Tj` with no operand is invalid PDF.
        splices.push({ start: seg.start, end: seg.end, bytes: bytesOf('()') });
        removed++;
        const txt = decodeSegmentText(seg, info);
        if (txt) covered.push(txt);
      } else if (cov === 'partial') {
        partial++;
      }
    }

    // Recurse into nested Form XObjects.
    const xoDict = res?.lookupMaybe(PDFName.of('XObject'), PDFDict)
      ?? fontFallback?.lookupMaybe(PDFName.of('XObject'), PDFDict);
    const childRemap = new Map<string, PDFRef>();
    for (const d of dos) {
      const val = xoDict?.get(PDFName.of(d.name));
      const childRef = val instanceof PDFRef ? val : undefined;
      if (!childRef) return { ok: false }; // unresolvable Do target — unverifiable
      const child = lib.context.lookup(childRef);
      if (child instanceof PDFRawStream) {
        const csub = child.dict.get(PDFName.of('Subtype'));
        if (csub instanceof PDFName && csub.asString() === '/Image') return { ok: false };
      }
      const r = planFormXObjectRedaction(lib, childRef, d.ctm, rects, cropX, cropY, fontFallback, depth + 1, seen);
      if (!r.ok) return { ok: false };
      removed += r.removed;
      partial += r.partial;
      covered.push(...r.covered);
      if (r.changed) childRemap.set(d.name, r.ref);
    }

    // Vector paint ops inside this XObject: remove fills/strokes whose
    // geometry (mapped to page space via pageCtm) intersects a rect.
    const vec = planVectorOpsRemoval(decoded, toks, rects, cropX, cropY, pageCtm);
    if (!vec) return { ok: false }; // unanalyzable vector ops — unverifiable
    splices.push(...vec.splices);
    removed += vec.removed;

    // Marked-content secret wrappers (/ActualText, /Alt, /E): neutralize
    // only when everything they describe was removed; otherwise unverifiable.
    const va = analyzeVectorPaintOps(decoded, toks, pageCtm);
    const nm = neutralizeMarkedSecrets(latin1(decoded), toks, segments, va.spans, splices);
    if (!nm.ok) return { ok: false };
    splices.push(...nm.splices);

    // Splices from the text, vector and marked-content passes interleave in
    // byte order — sort before applying (applySplices needs sorted input).
    splices.sort((a, b) => a.start - b.start);
    const newBytes = splices.length > 0 ? applySplices(decoded, splices) : null;
    if (!newBytes && childRemap.size === 0) return { ok: true, ref: xobjRef, changed: false, removed, partial, covered };

    // Clone-on-write: new dict + (when children changed) cloned resources
    // with the remapped /XObject names. The original stream/dicts are never
    // mutated, so pages sharing this XObject keep the original bytes.
    const newDict = obj.dict.clone(lib.context);
    if (childRemap.size > 0) {
      const oldXo = res?.lookupMaybe(PDFName.of('XObject'), PDFDict);
      const newRes = res ? res.clone(lib.context) : lib.context.obj({});
      const newXo = oldXo ? oldXo.clone(lib.context) : lib.context.obj({});
      for (const [name, nr] of childRemap) newXo.set(PDFName.of(name), nr);
      newRes.set(PDFName.of('XObject'), lib.context.register(newXo));
      newDict.set(PDFName.of('Resources'), lib.context.register(newRes));
    }
    const newRef = installXObjectStream(lib, newBytes ?? decoded, newDict);
    return { ok: true, ref: newRef, changed: true, removed, partial, covered };
  } catch {
    return { ok: false };
  } finally {
    seen.delete(key);
  }
}

/**
 * Vector redaction plan: delete every line FULLY COVERED by any redact box
 * (content space). Partially covered lines are left alone — the raster/
 * black-box path still visually covers them, and deleting half a ligature
 * run would corrupt rendering. Returns null when the page cannot be
 * VERIFIED (images, uninvertible text, patterns, inline images,
 * unverifiable Form XObjects, unanalyzable vector ops, surviving
 * marked-content secrets). A non-null plan with changed:false means the
 * analysis completed and nothing in the content stream needed removal.
 *
 * Truth conditions (anything unverifiable forces the raster path):
 *  - image XObjects anywhere reachable (page or nested Forms)
 *  - text the engine cannot invert (missing/Type0/Type3 fonts, undecodable bytes)
 *  - /Pattern resources, inline images (BI…EI)
 *  - Form XObjects whose text cannot be recursively verified+redacted
 *    (depth cap, cycles, images, non-invertible fonts inside)
 */
export function planVectorRedaction(lib: PDFDocument, pageIndex: number, rects: Array<{ x: number; y: number; w: number; h: number }>): { bytes: Uint8Array; removed: number; partial: number; coveredText: string[]; changed: boolean } | null {
  const rec = recognizePageText(lib, pageIndex);
  if (!rec || rects.length === 0) return null;
  if (rec.hasImages || rec.hasUnrecognizedText || rec.hasPatterns || rec.hasInlineImages) return null;

  const pageNode = lib.getPage(pageIndex).node;
  const pageRes = pageNode.Resources();
  // Pre-scan: any image XObject reachable through nested Forms → raster.
  if (pageRes && formTreeHasImages(lib, pageRes, new Set())) return null;

  // Recursively redact vector text inside Form XObjects.
  const toks = tokenizeContent(rec.decoded);
  const { segments, dos } = collectShowSegments(rec.decoded, toks, IDENT);
  const remap = new Map<string, PDFRef>();
  const seen = new Set<string>();
  const pageXo = pageRes?.lookupMaybe(PDFName.of('XObject'), PDFDict);
  let xRemoved = 0;
  let xPartial = 0;
  const coveredText: string[] = [];
  for (const d of dos) {
    const val = pageXo?.get(PDFName.of(d.name));
    const childRef = val instanceof PDFRef ? val : undefined;
    if (!childRef) {
      if (val) return null; // unresolvable Do target — unverifiable
      continue; // name not in resources: renderers ignore it
    }
    const r = planFormXObjectRedaction(lib, childRef, d.ctm, rects, rec.cropX, rec.cropY, pageRes, 0, seen);
    if (!r.ok) return null;
    xRemoved += r.removed;
    xPartial += r.partial;
    coveredText.push(...r.covered);
    if (r.changed) remap.set(d.name, r.ref);
  }
  if (remap.size > 0) {
    // Clone the page's /Resources (and its /XObject dict) into fresh dicts
    // set on the page node — never mutate an inherited/shared dict, so
    // other pages sharing resources are unaffected.
    const newRes = pageRes ? pageRes.clone(lib.context) : lib.context.obj({});
    const newXo = pageXo ? pageXo.clone(lib.context) : lib.context.obj({});
    for (const [name, nr] of remap) newXo.set(PDFName.of(name), nr);
    newRes.set(PDFName.of('XObject'), lib.context.register(newXo));
    pageNode.set(PDFName.of('Resources'), lib.context.register(newRes));
  }

  const splices: Array<{ start: number; end: number; bytes: Uint8Array }> = [];
  let removed = xRemoved;
  let partial = xPartial;
  for (const ln of rec.lines) {
    const cov = lineCoverage(ln.seg.tx, ln.seg.ty, ln.advance, ln.seg.size, rects, rec.cropX, rec.cropY);
    if (cov === 'full') {
      // NB: `()` not empty — a bare `Tj` with no operand is invalid PDF.
      splices.push({ start: ln.seg.start, end: ln.seg.end, bytes: bytesOf('()') });
      removed++;
      const txt = decodeSegmentText(ln.seg, ln.font);
      if (txt) coveredText.push(txt);
    } else if (cov === 'partial') partial++;
  }

  // Vector paint ops on this page: remove fills/strokes whose geometry
  // intersects a redact rect. Unanalyzable ops (sh/BI) force raster.
  const vec = planVectorOpsRemoval(rec.decoded, toks, rects, rec.cropX, rec.cropY, IDENT);
  if (!vec) return null;
  splices.push(...vec.splices);
  removed += vec.removed;

  // Marked-content secret wrappers (/ActualText, /Alt, /E): neutralize only
  // when everything they describe was removed above; otherwise raster.
  const va = analyzeVectorPaintOps(rec.decoded, toks, IDENT);
  const nm = neutralizeMarkedSecrets(rec.source, toks, segments, va.spans, splices);
  if (!nm.ok) return null;
  splices.push(...nm.splices);

  if (removed === 0 && nm.splices.length === 0) {
    // Nothing under the rects in the content stream — no rewrite needed,
    // but the analysis is COMPLETE (everything was verifiable), so the
    // caller must not force a rasterization for this. changed:false tells
    // the caller to skip installStream. (A redact rect can legitimately
    // cover only annotations/AcroForm widgets, which are handled by the
    // separate sanitizers.)
    return { bytes: rec.decoded, removed, partial, coveredText, changed: false };
  }
  splices.sort((a, b) => a.start - b.start);
  return { bytes: applySplices(rec.decoded, splices), removed, partial, coveredText, changed: true };
}

/** Swap a page's Contents for a fresh unfiltered stream. */
export function installStream(lib: PDFDocument, pageIndex: number, bytes: Uint8Array): void {
  const page = lib.getPage(pageIndex);
  const stream = lib.context.stream(bytes, { Length: PDFNumber.of(bytes.length) });
  page.node.set(PDFName.of('Contents'), lib.context.register(stream));
}

/** Register a standard font on the page and return its resource name. */
export function ensureStandardFont(lib: PDFDocument, pageIndex: number, which: 'helv' | 'times' | 'courier'): string {
  const std = which === 'times' ? 'Times-Roman' : which === 'courier' ? 'Courier' : 'Helvetica';
  const page = lib.getPage(pageIndex);
  // pdf-lib's embedFont works on PDFDocument and registers into Resources.
  return std;
}

/** css hex → rgb 0..1 triple (duplicate of exportPdf's helper, kept local). */
export function cssHexToRgbLocal(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/* ------------------------------------------------------------------ */
/* Phase 5: redaction-truth hardening — vector graphics, structure     */
/* tree, AcroForm, marked-content ActualText, covered-string capture    */
/* ------------------------------------------------------------------ */

/** Rotate an axis-aligned rect's corners about the page-box center; return the bbox. */
export function rotRectAboutCenter(r: { x: number; y: number; w: number; h: number }, W: number, H: number, deg: number): { x: number; y: number; w: number; h: number } {
  const rad = (deg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const cx = W / 2;
  const cy = H / 2;
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [px, py] of [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]] as Array<[number, number]>) {
    const dx = px - cx;
    const dy = py - cy;
    xs.push(cx + dx * c - dy * s);
    ys.push(cy + dx * s + dy * c);
  }
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Redact rects mapped into annotation/default-user space: the crop-box
 * origin is added, plus 90/180/270°-rotated variants (annotations live in
 * default user space; over-removal is the safe direction). Shared by the
 * annotation sanitizer, the AcroForm sanitizer and the structure-tree
 * sanitizer so all three test the same geometry.
 */
export function redactRectsInAnnotSpace(
  lib: PDFDocument,
  pageIndex: number,
  rects: Array<{ x: number; y: number; w: number; h: number }>,
): Array<{ x: number; y: number; w: number; h: number }> {
  const node = lib.getPage(pageIndex).node;
  const cropArr = node.CropBox() ?? node.MediaBox();
  let cx = 0;
  let cy = 0;
  if (cropArr && cropArr.size() >= 2) {
    const x = lib.context.lookupMaybe(cropArr.get(0), PDFNumber);
    const y = lib.context.lookupMaybe(cropArr.get(1), PDFNumber);
    if (x && y) { cx = x.asNumber(); cy = y.asNumber(); }
  }
  const mediaArr = node.MediaBox();
  let mw = 612;
  let mh = 792;
  if (mediaArr && mediaArr.size() >= 4) {
    const w = lib.context.lookupMaybe(mediaArr.get(2), PDFNumber);
    const h = lib.context.lookupMaybe(mediaArr.get(3), PDFNumber);
    if (w && h) { mw = w.asNumber(); mh = h.asNumber(); }
  }
  const base = rects.map((r) => ({ x: r.x + cx, y: r.y + cy, w: r.w, h: r.h }));
  const all = [...base];
  for (const deg of [90, 180, 270]) {
    for (const r of base) all.push(rotRectAboutCenter(r, mw, mh, deg));
  }
  return all;
}

/** True when two bboxes overlap (any touch counts — the safe direction). */
function bboxHits(ax0: number, ay0: number, ax1: number, ay1: number, q: { x: number; y: number; w: number; h: number }): boolean {
  return ax0 < q.x + q.w && ax1 > q.x && ay0 < q.y + q.h && ay1 > q.y;
}

/** Decode one segment's bytes through a font into text; null when not invertible. */
function decodeSegmentText(seg: Segment, info: FontInfo): string | null {
  let text = '';
  for (const byte of seg.bytes) {
    const ch = decodeSimple(byte, info.diffs, info.base);
    if (ch === null) return null;
    text += ch;
  }
  return text;
}

/**
 * Pre-export capture of the text sitting under redact rects, WITHOUT mutating
 * the page. Called BEFORE the deep content pass splices the stream. Returns
 * the decoded text of every FULLY covered line, plus `complete=false` when
 * the page carries text the engine cannot invert (such text can only survive
 * the raster path, which discards the whole stream — the flag lets the
 * verifier report honestly about what it checked).
 */
export function classifyCoveredText(
  lib: PDFDocument,
  pageIndex: number,
  rects: Array<{ x: number; y: number; w: number; h: number }>,
): { covered: string[]; complete: boolean } | null {
  const rec = recognizePageText(lib, pageIndex);
  if (!rec || rects.length === 0) return null;
  const covered: string[] = [];
  for (const ln of rec.lines) {
    if (lineCoverage(ln.seg.tx, ln.seg.ty, ln.advance, ln.seg.size, rects, rec.cropX, rec.cropY) === 'full') {
      covered.push(ln.text);
    }
  }
  return { covered, complete: !rec.hasUnrecognizedText };
}

/* ---------------- vector paint-op analysis ---------------- */

export interface PaintSpan {
  /** byte offset of the first path-construction operand */
  constrStart: number;
  /** byte offset just past the painting operator */
  paintEnd: number;
  /** path bbox in the walker's output space (null when no geometry) */
  bbox: { x0: number; y0: number; x1: number; y1: number } | null;
}

/**
 * Walk a content stream tracking the graphics CTM and the current path's
 * bbox, and record every fill/stroke paint op with its byte span and
 * geometry. Path construction ops: m/l/c/v/y/h/re. Painting ops:
 * f, F, f-star, B, B-star, s, S (span recorded for removal analysis); n and
 * W/W* end the path without painting (clipping only restricts subsequent
 * painting, so a paint op's own geometry is the conservative test —
 * anything painted is always a subset of the path geometry). The `w`
 * operator is tracked through q/Q, and stroke spans (S/s/B/B*) are expanded
 * by half the line width (CTM-scaled) so ink kissing a rect edge is removed.
 *
 * Returns ok:false when the stream contains operators the analysis cannot
 * model: `sh` (shadings) or inline images (BI…EI) — the caller must take the
 * raster fallback instead of trusting the vector path.
 */
export function analyzeVectorPaintOps(src: Uint8Array, toks: Tok[], initialCtm: Mat = IDENT): { spans: PaintSpan[]; ok: boolean } {
  void src; // spans carry their own byte offsets; the raw bytes are not needed here
  const spans: PaintSpan[] = [];
  let ctm: Mat = [...initialCtm] as Mat;
  let lineWidth = 1; // PDF default; tracked through q/Q like the CTM
  const stack: Array<{ ctm: Mat; w: number }> = [];
  let ops: Tok[] = [];
  let blockStart: number | null = null;
  let bb: PaintSpan['bbox'] = null;

  const xform = (x: number, y: number): [number, number] => [
    ctm[0] * x + ctm[2] * y + ctm[4],
    ctm[1] * x + ctm[3] * y + ctm[5],
  ];
  const extend = (x: number, y: number) => {
    const [px, py] = xform(x, y);
    if (!bb) bb = { x0: px, y0: py, x1: px, y1: py };
    else {
      bb.x0 = Math.min(bb.x0, px);
      bb.y0 = Math.min(bb.y0, py);
      bb.x1 = Math.max(bb.x1, px);
      bb.y1 = Math.max(bb.y1, py);
    }
  };
  const nums = (n: number): { vals: number[]; firstStart: number } | null => {
    const a = ops.slice(-n);
    if (a.length === n && a.every((t) => t.kind === 'num' && typeof t.value === 'number')) {
      return { vals: a.map((t) => t.value as number), firstStart: (a[0] as Tok).start };
    }
    return null;
  };
  const endPath = () => { blockStart = null; bb = null; };

  for (const t of toks) {
    if (t.kind !== 'op') { ops.push(t); continue; }
    const op = String(t.value);
    switch (op) {
      case 'q':
        stack.push({ ctm: [...ctm] as Mat, w: lineWidth });
        ops = [];
        break;
      case 'Q': {
        const g = stack.pop();
        if (g) { ctm = g.ctm; lineWidth = g.w; }
        ops = [];
        break;
      }
      case 'w': {
        // Line width affects how far stroked ink extends past the path.
        const a = nums(1);
        if (a && Number.isFinite(a.vals[0])) lineWidth = Math.max(0, a.vals[0]);
        ops = [];
        break;
      }
      case 'cm': {
        const a = nums(6);
        if (a) ctm = mul([a.vals[0], a.vals[1], a.vals[2], a.vals[3], a.vals[4], a.vals[5]], ctm);
        ops = [];
        break;
      }
      case 'm': {
        const a = nums(2);
        if (a) {
          if (blockStart === null) blockStart = a.firstStart;
          extend(a.vals[0], a.vals[1]);
        }
        ops = [];
        break;
      }
      case 'l': {
        const a = nums(2);
        if (a) {
          if (blockStart === null) blockStart = a.firstStart;
          extend(a.vals[0], a.vals[1]);
        }
        ops = [];
        break;
      }
      case 'c': {
        const a = nums(6);
        if (a) {
          if (blockStart === null) blockStart = a.firstStart;
          // control-point bbox: a conservative over-approximation (safe direction)
          extend(a.vals[0], a.vals[1]);
          extend(a.vals[2], a.vals[3]);
          extend(a.vals[4], a.vals[5]);
        }
        ops = [];
        break;
      }
      case 'v':
      case 'y': {
        const a = nums(4);
        if (a) {
          if (blockStart === null) blockStart = a.firstStart;
          extend(a.vals[0], a.vals[1]);
          extend(a.vals[2], a.vals[3]);
        }
        ops = [];
        break;
      }
      case 'h':
        ops = [];
        break;
      case 're': {
        const a = nums(4);
        if (a) {
          if (blockStart === null) blockStart = a.firstStart;
          extend(a.vals[0], a.vals[1]);
          extend(a.vals[0] + a.vals[2], a.vals[1] + a.vals[3]);
        }
        ops = [];
        break;
      }
      case 'W':
      case 'W*':
      case 'n':
        // clip / no-paint: end the path without recording a paint span
        endPath();
        ops = [];
        break;
      case 'f':
      case 'F':
      case 'f*':
      case 'B':
      case 'B*':
      case 's':
      case 'S': {
        type BBox = { x0: number; y0: number; x1: number; y1: number };
        const cur = bb as BBox | null;
        let box: BBox | null = cur;
        if (cur && (op === 's' || op === 'S' || op === 'B' || op === 'B*') && lineWidth > 0) {
          // Stroked ink extends half the line width beyond the path
          // geometry — expand the bbox conservatively (width is in user
          // space, scaled by the CTM) so a stroke kissing the rect edge
          // is still removed.
          const scale = Math.max(Math.abs(ctm[0]), Math.abs(ctm[1]), Math.abs(ctm[2]), Math.abs(ctm[3]));
          const e = (lineWidth / 2) * (Number.isFinite(scale) && scale > 0 ? scale : 1);
          box = { x0: cur.x0 - e, y0: cur.y0 - e, x1: cur.x1 + e, y1: cur.y1 + e };
        }
        spans.push({ constrStart: blockStart ?? t.start, paintEnd: t.end, bbox: box });
        endPath();
        ops = [];
        break;
      }
      case 'sh':
      case 'BI':
        // shadings and inline images cannot be modeled — unverifiable
        return { spans, ok: false };
      default:
        if (ops.length > 8) ops = [];
        break;
    }
  }
  return { spans, ok: true };
}

/**
 * Build removal splices for every paint span whose geometry intersects a
 * redact rect (crop offset added, mirroring lineCoverage). Returns null when
 * the stream cannot be confidently analyzed (sh/BI) — the caller must take
 * the raster fallback.
 */
export function planVectorOpsRemoval(
  src: Uint8Array,
  toks: Tok[],
  rects: Array<{ x: number; y: number; w: number; h: number }>,
  cropX: number,
  cropY: number,
  initialCtm: Mat = IDENT,
): { splices: Array<{ start: number; end: number; bytes: Uint8Array }>; removed: number } | null {
  const va = analyzeVectorPaintOps(src, toks, initialCtm);
  if (!va.ok) return null;
  const splices: Array<{ start: number; end: number; bytes: Uint8Array }> = [];
  let removed = 0;
  for (const sp of va.spans) {
    if (!sp.bbox) continue;
    let hit = false;
    for (const r of rects) {
      const rx0 = r.x + cropX;
      const ry0 = r.y + cropY;
      if (bboxHits(sp.bbox.x0, sp.bbox.y0, sp.bbox.x1, sp.bbox.y1, { x: rx0, y: ry0, w: r.w, h: r.h })) {
        hit = true;
        break;
      }
    }
    if (hit) {
      // Remove the whole path block (construction through the paint op).
      // A single space keeps token boundaries valid.
      splices.push({ start: sp.constrStart, end: sp.paintEnd, bytes: bytesOf(' ') });
      removed++;
    }
  }
  return { splices, removed };
}

/* ---------------- marked-content /ActualText handling ---------------- */

interface MarkedSection {
  propsDict: Tok | null;
  start: number;
  end: number;
}

/** Collect BDC…EMC sections (and BMC…EMC) with their property dicts. */
function collectMarkedSections(toks: Tok[]): MarkedSection[] {
  const sections: MarkedSection[] = [];
  const stack: Array<{ propsDict: Tok | null; start: number }> = [];
  let ops: Tok[] = [];
  for (const t of toks) {
    if (t.kind !== 'op') { ops.push(t); continue; }
    const op = String(t.value);
    if (op === 'BDC') {
      const props = ops[ops.length - 1] ?? null;
      stack.push({ propsDict: props?.kind === 'dict' ? props : null, start: t.end });
      ops = [];
    } else if (op === 'BMC') {
      stack.push({ propsDict: null, start: t.end });
      ops = [];
    } else if (op === 'EMC') {
      const s = stack.pop();
      if (s) sections.push({ propsDict: s.propsDict, start: s.start, end: t.start });
      ops = [];
    } else if (ops.length > 8) {
      ops = [];
    }
  }
  return sections;
}

/**
 * Byte spans of /ActualText, /Alt and /E string operands inside a BDC
 * property dict token (absolute offsets into the decoded stream).
 */
function secretOperandSpans(src: string, dictTok: Tok): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  const re = /\/(ActualText|Alt|E)\s*(\(|<)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src.slice(dictTok.start, dictTok.end))) !== null) {
    const abs = dictTok.start + m.index + m[0].length - 1;
    if (m[2] === '(') {
      const t = readStringLit(src, abs);
      spans.push({ start: abs, end: t.end });
    } else if (src[abs + 1] !== '<') {
      const t = readHexLit(src, abs);
      spans.push({ start: abs, end: t.end });
    }
  }
  return spans;
}

/**
 * Neutralize marked-content secret operands (/ActualText, /Alt, /E) whose
 * ENTIRE section content was removed by the text/vector splices — the
 * wrapper is then spliced to an empty string. When a section carries such an
 * operand but any of its text or vector content SURVIVES (or the mapping is
 * otherwise unconfident), returns ok:false: the caller must take the raster
 * fallback, because the wrapper could name redacted content.
 */
export function neutralizeMarkedSecrets(
  src: string,
  toks: Tok[],
  segments: Segment[],
  vectorSpans: PaintSpan[],
  removedSpans: Array<{ start: number; end: number }>,
): { splices: Array<{ start: number; end: number; bytes: Uint8Array }>; ok: boolean } {
  const splices: Array<{ start: number; end: number; bytes: Uint8Array }> = [];
  const sections = collectMarkedSections(toks);
  const coveredBy = (spans: Array<{ start: number; end: number }>, a0: number, a1: number) =>
    spans.some((sp) => sp.start <= a0 && sp.end >= a1);
  const overlaps = (a0: number, a1: number, sec: MarkedSection) => a0 < sec.end && a1 > sec.start;
  for (const sec of sections) {
    if (!sec.propsDict) continue;
    const secretSpans = secretOperandSpans(src, sec.propsDict);
    if (secretSpans.length === 0) continue;
    const segsInside = segments.filter((sg) => overlaps(sg.start, sg.end, sec));
    const vecInside = vectorSpans.filter((sp) => overlaps(sp.constrStart, sp.paintEnd, sec));
    const allGone =
      segsInside.every((sg) => coveredBy(removedSpans, sg.start, sg.end)) &&
      vecInside.every((sp) => coveredBy(removedSpans, sp.constrStart, sp.paintEnd));
    if (!allGone) return { splices, ok: false };
    for (const ss of secretSpans) splices.push({ start: ss.start, end: ss.end, bytes: bytesOf('()') });
  }
  return { splices, ok: true };
}

/* ---------------- AcroForm sanitizer ---------------- */

/** Best-effort decode of a /V or /DV value to text (for the covered-strings list). */
function pdfValueText(ctx: import('pdf-lib').PDFContext, v: PDFObject): string | null {
  try {
    const r = v instanceof PDFRef ? ctx.lookup(v) : v;
    // pdf-lib stores non-ASCII text (e.g. form field values) as hex
    // UTF-16BE strings — a separate PDFHexString class. decodeText() is
    // BOM-aware; without this branch cleared values would silently drop
    // out of the verification set.
    if (r instanceof PDFHexString) return r.decodeText();
    if (r instanceof PDFString) return r.asString();
    if (r instanceof PDFName) return r.asString().replace(/^\//, '');
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Delete an annotation's /AP appearance streams from the context and drop
 * the /AP entry. Appearance streams render the annotation's value (e.g. a
 * form field's text) — since pdf-lib serializes even unreferenced indirect
 * objects, a removed annotation's appearance would otherwise leak its value
 * as an orphan in the exported file. Appearance streams are referenced only
 * from their annotation's /AP, so deleting them leaves no dangling refs.
 */
export function purgeAnnotAppearances(ctx: import('pdf-lib').PDFContext, annot: PDFDict): void {
  try {
    const ap = annot.get(PDFName.of('AP'));
    const apDict = ap instanceof PDFRef ? ctx.lookup(ap) : ap;
    const refs: PDFRef[] = [];
    if (apDict instanceof PDFDict) {
      for (const k of ['N', 'R', 'D']) {
        const v = apDict.get(PDFName.of(k));
        if (v instanceof PDFRef) refs.push(v);
      }
    } else if (ap instanceof PDFRef) {
      refs.push(ap);
    }
    for (const r of refs) ctx.delete(r);
    annot.delete(PDFName.of('AP'));
  } catch {
    /* best effort — never fail the export on appearance cleanup */
  }
}

/**
 * Clear AcroForm field values (/V and /DV) on every widget annotation of the
 * page that intersects a redact rect — walking the widget → field parent
 * chain, since the value can live on either. Also purges the widget's /AP
 * appearance streams, which render the value as page content.
 *
 * IMPORTANT: must run BEFORE the source-annotation sanitizer drops
 * intersecting annots from the page's /Annots — this function reads its
 * widget list from /Annots (which also guarantees page membership).
 *
 * Returns ok:false when a widget's geometry cannot be determined — the
 * caller must then force the raster path instead of trusting the vector path.
 * `cleared` carries the decoded values that were removed (for verification).
 */
export function sanitizeAcroFormUnderRects(
  lib: PDFDocument,
  pageIndex: number,
  rects: Array<{ x: number; y: number; w: number; h: number }>,
): { ok: boolean; cleared: string[] } {
  const cleared: string[] = [];
  try {
    if (rects.length === 0) return { ok: true, cleared };
    const acro = lib.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
    if (!acro) return { ok: true, cleared };
    const node = lib.getPage(pageIndex).node;
    const annots = node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (!annots || annots.size() === 0) return { ok: true, cleared };
    const spaces = redactRectsInAnnotSpace(lib, pageIndex, rects);
    const ctx = lib.context;
    for (let i = 0; i < annots.size(); i++) {
      const a = ctx.lookup(annots.get(i));
      if (!(a instanceof PDFDict)) continue;
      const sub = a.get(PDFName.of('Subtype'));
      if (!(sub instanceof PDFName) || sub.asString() !== '/Widget') continue;
      const rArr = a.lookupMaybe(PDFName.of('Rect'), PDFArray);
      if (!rArr || rArr.size() < 4) return { ok: false, cleared };
      const nums: number[] = [];
      for (let k = 0; k < 4; k++) {
        const n = ctx.lookupMaybe(rArr.get(k), PDFNumber);
        if (!n || !Number.isFinite(n.asNumber())) return { ok: false, cleared };
        nums.push(n.asNumber());
      }
      const ax0 = Math.min(nums[0], nums[2]);
      const ay0 = Math.min(nums[1], nums[3]);
      const ax1 = Math.max(nums[0], nums[2]);
      const ay1 = Math.max(nums[1], nums[3]);
      let hit = false;
      for (const q of spaces) {
        if (bboxHits(ax0, ay0, ax1, ay1, q)) { hit = true; break; }
      }
      if (!hit) continue;
      // Rendered appearance streams would leak the value as an orphan
      // (pdf-lib serializes unreferenced objects) — purge them with it.
      purgeAnnotAppearances(ctx, a);
      // Walk the widget → field parent chain, clearing /V and /DV everywhere.
      let cur: PDFDict | undefined = a;
      const seen = new Set<string>();
      while (cur) {
        for (const key of ['V', 'DV']) {
          const v = cur.get(PDFName.of(key));
          if (v !== undefined) {
            const text = pdfValueText(ctx, v);
            if (text) cleared.push(text);
            if (v instanceof PDFRef) {
              // Indirect value: merely dropping the dict entry would orphan
              // the object, and pdf-lib serializes orphans. Neutralize it in
              // place — assign keeps the ref valid for any shared referrer.
              ctx.assign(v, PDFString.of(''));
            }
            cur.delete(PDFName.of(key));
          }
        }
        const parentRaw: PDFObject | undefined = cur.get(PDFName.of('Parent'));
        const pref = parentRaw instanceof PDFRef ? parentRaw.toString() : '';
        if (pref && seen.has(pref)) break;
        if (pref) seen.add(pref);
        const p: PDFObject | undefined = parentRaw instanceof PDFRef ? ctx.lookup(parentRaw) : parentRaw;
        cur = p instanceof PDFDict ? p : undefined;
      }
    }
    return { ok: true, cleared };
  } catch {
    return { ok: false, cleared };
  }
}

/* ---------------- structure-tree sanitizer ---------------- */

/**
 * Sanitize /Alt, /ActualText and /E entries on structure elements whose
 * bounding boxes intersect a redact rect. Structure elements that CARRY such
 * entries but have no determinable /BBox cannot be confidently mapped to a
 * rect — returns false so the caller takes the raster fallback for the page
 * (fail closed). Over-sanitization is impossible: only intersecting elements
 * are touched.
 */
export function sanitizeStructureTree(
  lib: PDFDocument,
  pageIndex: number,
  rects: Array<{ x: number; y: number; w: number; h: number }>,
): boolean {
  try {
    if (rects.length === 0) return true;
    const root = lib.catalog.lookupMaybe(PDFName.of('StructTreeRoot'), PDFDict);
    if (!root) return true;
    const spaces = redactRectsInAnnotSpace(lib, pageIndex, rects);
    const ctx = lib.context;
    const seen = new Set<string>();
    const SECRET_KEYS = [PDFName.of('Alt'), PDFName.of('ActualText'), PDFName.of('E')];
    let ok = true;
    const visit = (obj: unknown, depth: number): void => {
      if (!ok) return;
      if (depth > 64) { ok = false; return; }
      const dict = obj instanceof PDFRef ? ctx.lookup(obj) : obj;
      if (!(dict instanceof PDFDict)) return;
      if (obj instanceof PDFRef) {
        const k = obj.toString();
        if (seen.has(k)) return;
        seen.add(k);
      }
      const hasSecrets = SECRET_KEYS.some((k) => dict.get(k) !== undefined);
      if (hasSecrets) {
        const bArr = dict.lookupMaybe(PDFName.of('BBox'), PDFArray);
        let bbox: number[] | null = null;
        if (bArr && bArr.size() >= 4) {
          bbox = [];
          for (let i = 0; i < 4; i++) {
            const n = ctx.lookupMaybe(bArr.get(i), PDFNumber);
            if (!n || !Number.isFinite(n.asNumber())) { bbox = null; break; }
            bbox.push(n.asNumber());
          }
        }
        if (!bbox) { ok = false; return; } // cannot map to a rect → raster fallback
        const x0 = Math.min(bbox[0], bbox[2]);
        const y0 = Math.min(bbox[1], bbox[3]);
        const x1 = Math.max(bbox[0], bbox[2]);
        const y1 = Math.max(bbox[1], bbox[3]);
        let hit = false;
        for (const q of spaces) {
          if (bboxHits(x0, y0, x1, y1, q)) { hit = true; break; }
        }
        if (hit) {
          for (const k of SECRET_KEYS) {
            const v = dict.get(k);
            if (v !== undefined) {
              // Indirect secret: dropping the entry alone would orphan the
              // object (pdf-lib serializes orphans) — neutralize it in place.
              if (v instanceof PDFRef) ctx.assign(v, PDFString.of(''));
              dict.delete(k);
            }
          }
        }
      }
      const kids = dict.get(PDFName.of('K'));
      const kres = kids instanceof PDFRef ? ctx.lookup(kids) : kids;
      if (kres instanceof PDFDict) visit(kres, depth + 1);
      else if (kres instanceof PDFArray) {
        for (let i = 0; i < kres.size(); i++) {
          const el = kres.get(i);
          if (el instanceof PDFRef || el instanceof PDFDict) visit(el, depth + 1);
        }
      }
    };
    const rk = root.get(PDFName.of('K'));
    const rres = rk instanceof PDFRef ? ctx.lookup(rk) : rk;
    if (rres instanceof PDFDict) visit(rres, 0);
    else if (rres instanceof PDFArray) {
      for (let i = 0; i < rres.size(); i++) {
        const el = rres.get(i);
        if (el instanceof PDFRef || el instanceof PDFDict) visit(el, 0);
      }
    }
    return ok;
  } catch {
    return false;
  }
}
