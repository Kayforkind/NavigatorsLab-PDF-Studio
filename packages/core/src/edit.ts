/**
 * True in-place text editing and burned-in vector redaction for Node.
 *
 * Reuses the app's content-stream engine (src/lib/textRewrite.ts):
 * - planDeepEdit: rewrites the page's content stream so the original text
 *   operators are DELETED and the replacement is written as real vector text.
 * - planVectorRedaction: deletes every text line fully covered by a rect,
 *   so redacted text is unrecoverable even from a hex editor.
 *
 * What this module adds: the find/replace driver. The app drives planDeepEdit
 * with click coordinates from its hit-testing UI; here we synthesize the
 * "hit" from recognizePageText's own line geometry, so find/replace works
 * headlessly with identical engine semantics.
 */
import { PDFDocument } from 'pdf-lib';
import {
  recognizePageText,
  planDeepEdit,
  planVectorRedaction,
  installStream,
} from '../../../src/lib/textRewrite.js';
import { parseRanges } from '../../../src/lib/ranges.js';
import { loadPdf } from './pdf.js';

export interface Replacement {
  page: number; // 1-based
  before: string;
  after: string;
}

export interface Skip {
  page: number;
  reason: string;
}

export interface EditOptions {
  find: string;
  /** Empty string deletes the matched text. */
  replace: string;
  /** 1-based range spec like "1-3,5"; omitted = all pages. */
  pages?: string;
  /** Replace every occurrence; default replaces the first match per page... */
  all?: boolean;
  caseSensitive?: boolean;
}

export interface EditReport {
  bytes: Uint8Array;
  replacements: Replacement[];
  skipped: Skip[];
}

const norm = (s: string, caseSensitive?: boolean) =>
  caseSensitive ? s : s.toLowerCase();

/**
 * Find/replace real text in content streams. Reports every replacement;
 * lines the engine cannot rewrite (non-WinAnsi encodings, CID fonts) are
 * reported in `skipped`, never silently faked with overlays.
 */
export async function editText(bytes: Uint8Array, opts: EditOptions): Promise<EditReport> {
  if (!opts.find) throw new Error('edit-text: --find must not be empty');
  const lib = await loadPdf(bytes);
  const n = lib.getPageCount();
  const idxs = opts.pages?.trim() ? parseRanges(opts.pages, n) : Array.from({ length: n }, (_, i) => i);
  if (idxs.length === 0) throw new Error('edit-text: page selection is empty');

  const findN = norm(opts.find, opts.caseSensitive);
  const replacements: Replacement[] = [];
  const skipped: Skip[] = [];

  for (const pi of idxs) {
    let guard = 0;
    for (;;) {
      if (guard++ > 500) {
        skipped.push({ page: pi + 1, reason: 'match-iteration cap hit (500)' });
        break;
      }
      const rec = recognizePageText(lib, pi);
      if (!rec || rec.lines.length === 0) {
        if (rec === null) skipped.push({ page: pi + 1, reason: 'no invertible text on page' });
        break;
      }
      // Locate the first matching line, keeping the real-cased substring so
      // the engine's case-sensitive in-string splice still lands.
      let target: { text: string; seg: (typeof rec.lines)[number]['seg']; advance: number } | null = null;
      let actual = '';
      for (const ln of rec.lines) {
        const at = norm(ln.text, opts.caseSensitive).indexOf(findN);
        if (at >= 0) {
          target = ln;
          actual = ln.text.slice(at, at + opts.find.length);
          break;
        }
      }
      if (!target) break;
      const wholeLine = norm(target.text, opts.caseSensitive).trim() === findN.trim();
      const hit = {
        x: target.seg.tx - rec.cropX,
        y: target.seg.ty - rec.cropY,
        w: target.advance,
        h: target.seg.size,
        text: wholeLine ? target.text : actual,
        cell: !wholeLine,
        gapBefore: 0,
      };
      const plan = planDeepEdit(lib, pi, { hit, newText: opts.replace });
      if (!plan) {
        skipped.push({
          page: pi + 1,
          reason: `cannot rewrite line "${target.text.slice(0, 60)}" (font encoding not invertible or replacement has non-WinAnsi chars)`,
        });
        break;
      }
      installStream(lib, pi, plan.bytes);
      replacements.push({ page: pi + 1, before: plan.matched.text, after: opts.replace });
      if (!opts.all) break;
    }
    if (!opts.all && replacements.length > 0) break; // first match in document wins
  }
  return { bytes: await rebuildClean(lib), skipped, replacements };
}

export interface RedactRect {
  /** 1-based page number */
  page: number;
  /** PDF user-space points, origin bottom-left of the page's media box */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RedactReport {
  bytes: Uint8Array;
  removed: number;
  partial: number;
  skipped: Skip[];
}

/**
 * Burned-in redaction: covered text operators are deleted from the content
 * stream (vector path). Pages where the engine cannot prove removal
 * (image XObjects present, non-invertible fonts) are SKIPPED with a reason —
 * never silently downgraded to a visual cover, which would leave bytes behind.
 */
export async function redactRects(rects: RedactRect[], bytes: Uint8Array): Promise<RedactReport> {
  const lib = await loadPdf(bytes);
  const n = lib.getPageCount();
  let removed = 0;
  let partial = 0;
  const skipped: Skip[] = [];

  const byPage = new Map<number, RedactRect[]>();
  for (const r of rects) {
    if (!Number.isInteger(r.page) || r.page < 1 || r.page > n) {
      throw new Error(`redact: rect page ${r.page} out of range (1-${n})`);
    }
    for (const k of ['x', 'y', 'w', 'h'] as const) {
      if (!Number.isFinite(r[k])) throw new Error(`redact: rect ${k} must be finite`);
    }
    if (r.w <= 0 || r.h <= 0) throw new Error('redact: rect w/h must be positive');
    const list = byPage.get(r.page) ?? [];
    list.push(r);
    byPage.set(r.page, list);
  }

  for (const [page1, list] of byPage) {
    const pi = page1 - 1;
    const rec = recognizePageText(lib, pi);
    if (!rec) {
      skipped.push({ page: page1, reason: 'no invertible text on page (images or unsupported fonts)' });
      continue;
    }
    // planVectorRedaction takes crop-box-relative coords (it re-adds cropX/Y).
    const rel = list.map((r) => ({
      x: r.x - rec.cropX,
      y: r.y - rec.cropY,
      w: r.w,
      h: r.h,
    }));
    const plan = planVectorRedaction(lib, pi, rel);
    if (!plan) {
      skipped.push({
        page: page1,
        reason: 'no fully-covered invertible text lines (partially covered lines are left intact by design)',
      });
      continue;
    }
    installStream(lib, pi, plan.bytes);
    removed += plan.removed;
    partial += plan.partial;
  }
  return { bytes: await rebuildClean(lib), removed, partial, skipped };
}

/**
 * Redact by text: every line containing `find` is fully covered, then
 * deleted via the vector path. Whole lines are removed (safer than
 * substrings for redaction).
 */
export async function redactText(
  bytes: Uint8Array,
  opts: { find: string; pages?: string; caseSensitive?: boolean },
): Promise<RedactReport> {
  if (!opts.find) throw new Error('redact: --find must not be empty');
  const lib = await loadPdf(bytes);
  const n = lib.getPageCount();
  const idxs = opts.pages?.trim() ? parseRanges(opts.pages, n) : Array.from({ length: n }, (_, i) => i);
  if (idxs.length === 0) throw new Error('redact: page selection is empty');
  const findN = norm(opts.find, opts.caseSensitive);

  let removed = 0;
  let partial = 0;
  const skipped: Skip[] = [];
  for (const pi of idxs) {
    const rec = recognizePageText(lib, pi);
    if (!rec || rec.lines.length === 0) {
      skipped.push({ page: pi + 1, reason: 'no invertible text on page' });
      continue;
    }
    const rects = rec.lines
      .filter((ln) => norm(ln.text, opts.caseSensitive).includes(findN))
      .map((ln) => ({
        x: ln.seg.tx - rec.cropX,
        y: ln.seg.ty - rec.cropY - ln.seg.size * 0.3,
        w: ln.advance,
        h: ln.seg.size * 1.2,
      }));
    if (rects.length === 0) continue;
    const plan = planVectorRedaction(lib, pi, rects);
    if (!plan) {
      skipped.push({ page: pi + 1, reason: 'matched lines not fully removable (images or font encoding)' });
      continue;
    }
    installStream(lib, pi, plan.bytes);
    removed += plan.removed;
    partial += plan.partial;
  }
  return { bytes: await rebuildClean(lib), removed, partial, skipped };
}

/** Keep the PDFDocument type available without importing pdf-lib elsewhere. */
export type { PDFDocument };

/**
 * Rebuild the document through copyPages into a fresh PDFDocument.
 *
 * installStream orphans the previous content stream (it stays in the object
 * store as an unreferenced object, which pdf-lib's save() still serializes).
 * Rebuilding drops every orphan, so edited-out / redacted bytes are truly
 * gone from the output file — not just unreferenced. This mirrors the app's
 * own exporter, which always copies pages into a fresh document.
 */
async function rebuildClean(lib: PDFDocument): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  const copyMeta = (get: () => string | undefined, set: (v: string) => void) => {
    try {
      const v = get();
      if (v) set(v);
    } catch {
      /* ignore unreadable metadata */
    }
  };
  copyMeta(() => lib.getTitle(), (v) => out.setTitle(v));
  copyMeta(() => lib.getAuthor(), (v) => out.setAuthor(v));
  copyMeta(() => lib.getSubject(), (v) => out.setSubject(v));
  copyMeta(() => lib.getKeywords(), (v) => out.setKeywords(v.split(/\s+/)));
  copyMeta(() => lib.getCreator(), (v) => out.setCreator(v));
  copyMeta(() => lib.getProducer(), (v) => out.setProducer(v));
  const pages = await out.copyPages(lib, lib.getPageIndices());
  for (const p of pages) out.addPage(p);
  return out.save();
}
