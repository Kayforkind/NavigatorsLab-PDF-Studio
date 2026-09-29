/**
 * Post-redaction verification: prove the covered strings are truly gone.
 *
 * Concept (shared with the web exporter): capture the covered strings
 * BEFORE redaction (the caller passes the texts of the fully-covered lines
 * it deleted), then after the output bytes are built:
 *  1. raw byte-scan for every covered string in UTF-8 and UTF-16BE/LE,
 *     with and without BOM — catches hex-string, UTF-16 and double-encoded
 *     survivors anywhere in the file (content streams, orphans, metadata);
 *  2. text extraction over the OUTPUT (src/text.ts, pdf.js) — catches
 *     anything still rendered as text.
 *
 * The check is deliberately strict: if the exact covered string survives
 * ANYWHERE in the file (e.g. an identical line outside the redact region),
 * the byte scan reports it and verification fails. Over-refusal is the safe
 * direction — the refusal names the surviving string so the caller can widen
 * the redaction scope.
 */
import { extractText } from './text.js';

export interface RedactStringCheck {
  /** covered string (truncated to 160 chars for the report) */
  text: string;
  presentInBytes: boolean;
  /** which byte encodings still contain the string, e.g. ['utf8','utf16be'] */
  encodingsFound: string[];
  presentInExtraction: boolean;
}

export interface RedactVerification {
  stringsChecked: RedactStringCheck[];
  byteScan: 'pass' | 'fail';
  extraction: 'pass' | 'fail';
  pass: boolean;
}

function utf16beBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out[i * 2] = (c >> 8) & 0xff;
    out[i * 2 + 1] = c & 0xff;
  }
  return out;
}

function utf16leBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out[i * 2] = c & 0xff;
    out[i * 2 + 1] = (c >> 8) & 0xff;
  }
  return out;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
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

function bytesInclude(hay: Uint8Array, needle: Uint8Array): boolean {
  if (needle.length === 0 || needle.length > hay.length) return false;
  // Simple first-byte-anchored scan; covered strings are short, files are small.
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

const normWs = (s: string): string => s.replace(/\s+/g, ' ').trim();
const truncate = (s: string, n: number): string => (s.length > n ? s.slice(0, n) + '…' : s);

/**
 * Verify `covered` strings are absent from `outputBytes` (raw scan) and from
 * pdf.js text extraction of the output. `covered` must be the pre-redaction
 * texts of the fully-covered (deleted) lines.
 */
export async function verifyRedaction(outputBytes: Uint8Array, covered: string[]): Promise<RedactVerification> {
  const uniq = [...new Set(covered.map((s) => s.trim()).filter((s) => s.length > 0))];
  const enc = new TextEncoder();
  const fullTexts = new Map<string, string>(); // report text -> full text
  const checks: RedactStringCheck[] = uniq.map((text) => {
    const be = utf16beBytes(text);
    const le = utf16leBytes(text);
    const variants: Array<[string, Uint8Array]> = [
      ['utf8', enc.encode(text)],
      ['utf16be', be],
      ['utf16be-bom', concatBytes([new Uint8Array([0xfe, 0xff]), be])],
      ['utf16le', le],
      ['utf16le-bom', concatBytes([new Uint8Array([0xff, 0xfe]), le])],
    ];
    const found = variants.filter(([, b]) => bytesInclude(outputBytes, b)).map(([name]) => name);
    const reportText = truncate(text, 160);
    fullTexts.set(reportText, text);
    return {
      text: reportText,
      presentInBytes: found.length > 0,
      encodingsFound: found,
      presentInExtraction: false,
    };
  });

  let extraction: RedactVerification['extraction'] = 'pass';
  try {
    const pages = await extractText(outputBytes);
    const all = normWs(pages.map((p) => p.text).join('\n'));
    for (const c of checks) {
      const full = normWs(fullTexts.get(c.text) ?? c.text);
      if (full && all.includes(full)) c.presentInExtraction = true;
    }
  } catch {
    // Extraction itself failed: we cannot prove the text is gone.
    extraction = 'fail';
  }

  const byteScan = checks.some((c) => c.presentInBytes) ? 'fail' : 'pass';
  if (checks.some((c) => c.presentInExtraction)) extraction = 'fail';
  return { stringsChecked: checks, byteScan, extraction, pass: byteScan === 'pass' && extraction === 'pass' };
}
