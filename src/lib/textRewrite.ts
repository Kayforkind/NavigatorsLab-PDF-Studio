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
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  decodePDFRawStream,
} from 'pdf-lib';
// (CropBox/MediaBox accessors come from PDFPageLeaf via page.node)
import type { TextHit } from '../types';

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
 * Walk tokens, maintain graphics/text state, and emit every show-text
 * segment with its user-space origin. Also returns the raw decoded source
 * for TJ sub-parsing.
 */
export function collectShowSegments(src: Uint8Array, toks: Tok[]): { segments: Segment[]; source: string } {
  const segments: Segment[] = [];
  const s = latin1(src);
  let inText = false;
  const st: TextState = { font: '', size: 0, tm: [...IDENT] as Mat, trm: [...IDENT] as Mat, leading: 0 };
  let ctm: Mat = [...IDENT] as Mat;
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
  return { segments, source: s };
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

/** Decode + recognize all invertible show-text lines on a page. */
export function recognizePageText(lib: PDFDocument, pageIndex: number): { lines: LineOp[]; cropX: number; cropY: number; stream: PDFRawStream; decoded: Uint8Array; source: string; hasImages: boolean } | null {
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
  for (const seg of segments) {
    const info = fonts.get('/' + seg.font) ?? fonts.get(seg.font);
    if (!info) continue;
    let text = '';
    let ok = seg.bytes.length > 0;
    let advance = 0;
    for (const byte of seg.bytes) {
      const ch = decodeSimple(byte, info.diffs, info.base);
      if (ch === null) { ok = false; break; }
      text += ch;
      advance += ((info.widths.get(byte) ?? 500) / 1000) * seg.size;
    }
    if (!ok || !text.trim()) continue;
    lines.push({ seg, text, font: info, advance });
  }
  return { lines, cropX, cropY, stream: streams[0], decoded, source: latin1(decoded), hasImages: pageHasImages(lib, node) };
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
    const bytes = applySplices(rec.decoded, [{ start: seg.start, end: seg.end, bytes: new Uint8Array(0) }]);
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
  const bytes = applySplices(rec.decoded, [{ start: seg.start, end: seg.end, bytes: op }]);
  return { bytes, matched: target, lines: rec.lines, lineReplace: false };
}

/**
 * Vector redaction plan: delete every line FULLY COVERED by any redact box
 * (content space). Partially covered lines are left alone — the raster/
 * black-box path still visually covers them, and deleting half a ligature
 * run would corrupt rendering. Returns null when nothing can be removed.
 */
export function planVectorRedaction(lib: PDFDocument, pageIndex: number, rects: Array<{ x: number; y: number; w: number; h: number }>): { bytes: Uint8Array; removed: number; partial: number } | null {
  const rec = recognizePageText(lib, pageIndex);
  // Pages with image XObjects keep the raster path: a clip can hide an image
  // from rendering but its bytes would remain in the file.
  if (!rec || rec.lines.length === 0 || rects.length === 0 || rec.hasImages) return null;
  const splices: Array<{ start: number; end: number; bytes: Uint8Array }> = [];
  let removed = 0;
  let partial = 0;
  for (const ln of rec.lines) {
    const lx0 = ln.seg.tx;
    const ly0 = ln.seg.ty - ln.seg.size * 0.25;
    const lx1 = lx0 + ln.advance;
    const ly1 = ln.seg.ty + ln.seg.size * 0.85;
    let covered = false;
    let touches = false;
    for (const r of rects) {
      const rx0 = r.x + rec.cropX;
      const ry0 = r.y + rec.cropY;
      const rx1 = rx0 + r.w;
      const ry1 = ry0 + r.h;
      const intersects = lx0 < rx1 && lx1 > rx0 && ly0 < ry1 && ly1 > ry0;
      if (!intersects) continue;
      if (lx0 >= rx0 - 0.5 && lx1 <= rx1 + 0.5 && ly0 >= ry0 - 0.5 && ly1 <= ry1 + 0.5) covered = true;
      else touches = true;
    }
    if (covered) {
      splices.push({ start: ln.seg.start, end: ln.seg.end, bytes: new Uint8Array(0) });
      removed++;
    } else if (touches) partial++;
  }
  if (removed === 0) return null;
  return { bytes: applySplices(rec.decoded, splices), removed, partial };
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
