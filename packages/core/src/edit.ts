/**
 * True in-place text editing and burned-in vector redaction for Node.
 *
 * Reuses the app's content-stream engine (src/lib/textRewrite.ts):
 * - planDeepEdit: rewrites the page's content stream so the original text
 *   operators are DELETED and the replacement is written as real vector text.
 * - planVectorRedaction: deletes every text line fully covered by a rect,
 *   recursively through Form XObjects (nested and shared, clone-on-write),
 *   so redacted text is unrecoverable even from a hex editor.
 * - planFormXObjectRedaction: the recursive Form engine, reused directly
 *   by the image-path driver below.
 *
 * What this module adds: the find/replace driver, the per-page redaction
 * driver (refusal cascade, pixel redaction for image XObjects, annotation
 * hygiene), the metadata/attachment/JS scrub, and post-redaction
 * verification (byte-scan + extraction).
 *
 * Refusal policy: any page where removal cannot be PROVEN (Type0/Type3
 * fonts, inline images, patterns, undecodable text, Form-nested images,
 * un-pixel-redactable images, Form recursion limits) is reported with
 * unprovable=true — callers must refuse the whole redaction (non-zero exit,
 * no output written), never silently downgrade to a visual cover.
 */
import { PDFDocument, PDFDict, PDFName, PDFRef, PDFRawStream } from 'pdf-lib';
import {
  recognizePageText,
  planDeepEdit,
  planVectorRedaction,
  planFormXObjectRedaction,
  tokenizeContent,
  collectShowSegments,
  installStream,
} from '../../../src/lib/textRewrite.js';
import { parseRanges } from '../../../src/lib/ranges.js';
import { loadPdf } from './pdf.js';
import {
  REFUSE_TYPE0_TYPE3,
  REFUSE_INLINE_IMAGES,
  REFUSE_PATTERNS,
  REFUSE_UNRECOGNIZED_TEXT,
  REFUSE_IMAGE_NESTED_FORM,
  REFUSE_IMAGE_PIXEL,
  REFUSE_FORM_RECURSION,
  REFUSE_NO_COVERAGE,
  findType0Type3Fonts,
  formTreeHasImages,
  pageHasDirectImages,
  pixelRedactPageImages,
  sanitizeAnnots,
  scrubRedactedDocument,
  SCRUBBED_ENTRIES,
} from './redactImages.js';
import { verifyRedaction, type RedactVerification } from './redactVerify.js';

export interface Replacement {
  page: number; // 1-based
  before: string;
  after: string;
}

export interface Skip {
  page: number;
  reason: string;
  /** true when the skip is refusal-class: removal could not be proven, so
   *  the whole redaction is unprovable (non-zero exit, no output written). */
  unprovable?: boolean;
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
  annotationsRemoved: number;
  imagesPixelRedacted: number;
  skipped: Skip[];
  /** 1-based pages that were in the redaction scope */
  pages: number[];
  /** redact regions in media-box space (explicit rects, or matched-line boxes for --find) */
  regions: RedactRect[];
  /** pre-redaction texts of the fully-covered (deleted) page-level lines */
  covered: string[];
  /** true when any skip is refusal-class (removal unprovable) */
  unprovable: boolean;
  verification: RedactVerification;
  /** scrub entries applied to the output (see SCRUBBED_ENTRIES) */
  scrubbed: string[];
}

/* ------------------------------------------------------------------ */
/* Page redaction driver                                               */
/* ------------------------------------------------------------------ */

interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Coverage = 'full' | 'partial' | 'none';

/**
 * MUST stay identical to lineCoverage() in src/lib/textRewrite.ts: the
 * driver classifies lines with this copy to capture covered strings, while
 * the no-image path deletes them with the engine's own copy. Any drift
 * between the two breaks the verification contract.
 */
function lineCoverageLocal(
  tx: number,
  ty: number,
  advance: number,
  size: number,
  rects: CropRect[],
  cropX: number,
  cropY: number,
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

/** MUST stay identical to applySplices() in src/lib/textRewrite.ts. */
function applySplicesLocal(
  src: Uint8Array,
  splices: Array<{ start: number; end: number; bytes: Uint8Array }>,
): Uint8Array {
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
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

const EMPTY_STRING_OP = new TextEncoder().encode('()');

interface PageOutcome {
  removed: number;
  partial: number;
  imagesPixelRedacted: number;
  annotationsRemoved: number;
  covered: string[];
}

/**
 * Redact one page. `rects` are crop-box-relative (the engine's convention).
 * Returns either the outcome or a skip. Refusal-class skips (unprovable)
 * name the exact reason — the caller must then refuse the whole redaction.
 *
 * Refusal cascade (first hit wins):
 *  1. Type0/Type3 fonts anywhere in the page/Form resources → refuse.
 *  2. inline images (BI…EI) → refuse.
 *  3. /Pattern resources → refuse.
 *  4. text the engine cannot decode → refuse.
 *  5. image XObject nested inside a Form XObject → refuse.
 *  6. page-level image XObjects → pixel-redact; failure → refuse.
 *  7. vector deletion: no-image pages use planVectorRedaction directly
 *     (recursive Form engine included); image pages use the core-side driver
 *     below (page-level splice + exported planFormXObjectRedaction per Form).
 */
async function redactPage(
  lib: PDFDocument,
  pi: number,
  rects: CropRect[],
): Promise<{ ok: PageOutcome } | { skip: Skip; annotationsRemoved: number }> {
  const pageNode = lib.getPage(pi).node;
  let rec = recognizePageText(lib, pi);

  // Annotation hygiene runs on every in-scope page, INDEPENDENT of text
  // recognition: a page with no recognizable text (or no content stream at
  // all) can still carry the secret in /Annots /Contents under a redact
  // rect. Crop offsets come from this pass's own recognition (0 when the
  // page had no content stream) — exactly the convention the callers used
  // when they built the crop-relative rects.
  const annotPass = (): number => sanitizeAnnots(lib, pi, rects, rec?.cropX ?? 0, rec?.cropY ?? 0);

  if (!rec) {
    return {
      skip: { page: pi + 1, reason: 'no content streams on page', unprovable: false },
      annotationsRemoved: annotPass(),
    };
  }

  // Ghost tolerance: strip our own earlier `()` splices (see stripGhostShows)
  // so a PDF can be redacted more than once. Genuine undecodable text still
  // refuses below.
  if (rec.hasUnrecognizedText) {
    const stripped = stripGhostShows(rec.decoded, new Set(rec.lines.map((ln) => ln.seg.start)));
    if (stripped) {
      installStream(lib, pi, stripped);
      const re = recognizePageText(lib, pi);
      if (re) rec = re;
    }
  }

  const refuse = (reason: string): { skip: Skip; annotationsRemoved: number } => ({
    skip: { page: pi + 1, reason, unprovable: true },
    annotationsRemoved: annotPass(),
  });

  const badFonts = findType0Type3Fonts(lib, pi);
  if (badFonts.length > 0) return refuse(REFUSE_TYPE0_TYPE3(badFonts.join(', ')));
  if (rec.hasInlineImages) return refuse(REFUSE_INLINE_IMAGES);
  if (rec.hasPatterns) return refuse(REFUSE_PATTERNS);
  if (rec.hasUnrecognizedText) return refuse(REFUSE_UNRECOGNIZED_TEXT);

  let pageRes: PDFDict | undefined;
  try {
    pageRes = pageNode.Resources() ?? undefined;
  } catch {
    return refuse(REFUSE_IMAGE_PIXEL('page resources unreadable'));
  }
  if (formTreeHasImages(lib, pageRes)) return refuse(REFUSE_IMAGE_NESTED_FORM);

  // Covered strings: pre-redaction texts of the fully-covered lines —
  // page-level lines (classified with the mirrored rule) PLUS the strings
  // the recursive engine deleted from inside Form XObjects (its coveredText
  // / covered outputs, wired in below). verifyRedaction dedupes.
  const covered: string[] = [];
  let partial = 0;
  for (const ln of rec.lines) {
    const cov = lineCoverageLocal(ln.seg.tx, ln.seg.ty, ln.advance, ln.seg.size, rects, rec.cropX, rec.cropY);
    if (cov === 'full') covered.push(ln.text);
    else if (cov === 'partial') partial++;
  }

  let removed = 0;
  let imagesPixelRedacted = 0;

  if (pageHasDirectImages(lib, pi)) {
    // ---- image path: pixel-redact, then core-side vector driver ----
    const pix = pixelRedactPageImages(lib, pi, rects, rec.cropX, rec.cropY, rec.decoded);
    if ('refusal' in pix) return refuse(pix.refusal);
    imagesPixelRedacted = pix.redacted;

    // Re-read resources: the pixel pass may have installed a cloned dict.
    try {
      pageRes = pageNode.Resources() ?? undefined;
    } catch {
      return refuse(REFUSE_IMAGE_PIXEL('page resources unreadable after pixel pass'));
    }
    const toks = tokenizeContent(rec.decoded);
    const { dos } = collectShowSegments(rec.decoded, toks);
    const remap = new Map<string, PDFRef>();
    const seen = new Set<string>();
    const pageXo = pageRes?.lookupMaybe(PDFName.of('XObject'), PDFDict);
    let xRemoved = 0;
    let xPartial = 0;
    for (const d of dos) {
      const val = pageXo?.get(PDFName.of(d.name));
      const childRef = val instanceof PDFRef ? val : undefined;
      if (!childRef) {
        if (val) return refuse(REFUSE_FORM_RECURSION + ' (unresolvable Do target)');
        continue; // name not in resources: renderers ignore it
      }
      const child = lib.context.lookup(childRef);
      if (child instanceof PDFRawStream) {
        const sub = child.dict.get(PDFName.of('Subtype'));
        if (sub instanceof PDFName && sub.asString().replace(/^\//, '') === 'Image') {
          continue; // page-level image Do: pixel-handled above
        }
      }
      const r = planFormXObjectRedaction(lib, childRef, d.ctm, rects, rec.cropX, rec.cropY, pageRes, 0, seen);
      if (!r.ok) return refuse(REFUSE_FORM_RECURSION);
      xRemoved += r.removed;
      xPartial += r.partial;
      covered.push(...r.covered);
      if (r.changed) remap.set(d.name, r.ref);
    }
    if (remap.size > 0) {
      const newRes = pageRes ? pageRes.clone(lib.context) : lib.context.obj({});
      const newXo = pageXo ? pageXo.clone(lib.context) : lib.context.obj({});
      for (const [name, nr] of remap) newXo.set(PDFName.of(name), nr);
      newRes.set(PDFName.of('XObject'), lib.context.register(newXo));
      pageNode.set(PDFName.of('Resources'), lib.context.register(newRes));
    }
    const splices: Array<{ start: number; end: number; bytes: Uint8Array }> = [];
    removed = xRemoved;
    partial += xPartial;
    for (const ln of rec.lines) {
      if (lineCoverageLocal(ln.seg.tx, ln.seg.ty, ln.advance, ln.seg.size, rects, rec.cropX, rec.cropY) === 'full') {
        splices.push({ start: ln.seg.start, end: ln.seg.end, bytes: EMPTY_STRING_OP });
        removed++;
      }
    }
    installStream(lib, pi, applySplicesLocal(rec.decoded, splices));
  } else {
    // ---- fast path: the engine owns vector deletion incl. nested Forms ----
    const plan = planVectorRedaction(lib, pi, rects);
    if (!plan) {
      const toks = tokenizeContent(rec.decoded);
      const { dos } = collectShowSegments(rec.decoded, toks);
      if (dos.length > 0) return refuse(REFUSE_FORM_RECURSION);
      return {
        skip: { page: pi + 1, reason: REFUSE_NO_COVERAGE, unprovable: false },
        annotationsRemoved: annotPass(),
      };
    }
    installStream(lib, pi, plan.bytes);
    removed = plan.removed;
    partial += plan.partial;
    covered.push(...plan.coveredText); // nested-Form strings land in stringsChecked
  }

  const annotationsRemoved = annotPass();
  return { ok: { removed, partial, imagesPixelRedacted, annotationsRemoved, covered } };
}

/**
 * Compute redact rects (media-box space) for every line containing `find`,
 * without mutating anything. Lets callers union --find matches with explicit
 * --rect regions into a SINGLE redaction pass: sequential passes would
 * re-trip the engine's conservative undecodable-text flag on our own `()`
 * splice ghosts (see stripGhostShows).
 */
export async function findTextRects(
  bytes: Uint8Array,
  opts: { find: string; pages?: string; caseSensitive?: boolean },
): Promise<RedactRect[]> {
  if (!opts.find) throw new Error('redact: --find must not be empty');
  const lib = await loadPdf(bytes);
  const n = lib.getPageCount();
  const idxs = opts.pages?.trim() ? parseRanges(opts.pages, n) : Array.from({ length: n }, (_, i) => i);
  const findN = norm(opts.find, opts.caseSensitive);
  const out: RedactRect[] = [];
  for (const pi of idxs) {
    const rec = recognizePageText(lib, pi);
    if (!rec) continue;
    for (const ln of rec.lines) {
      if (norm(ln.text, opts.caseSensitive).includes(findN)) {
        out.push({
          page: pi + 1,
          x: ln.seg.tx,
          y: ln.seg.ty - ln.seg.size * 0.3,
          w: ln.advance,
          h: ln.seg.size * 1.2,
        });
      }
    }
  }
  return out;
}

/**
 * Our own redaction splices (`()` empty-string ops — the engine's own
 * convention, see textRewrite.ts) re-trip the engine's conservative
 * hasUnrecognizedText flag on a LATER pass (`ok = seg.bytes.length > 0` in
 * recognizePageText). An empty show op paints no glyphs, so when EVERY
 * undecodable segment is empty we strip those ghosts and re-recognize
 * instead of refusing — otherwise no PDF could ever be redacted twice.
 * Returns the stripped stream, or null when a NON-empty undecodable
 * segment exists (genuine refusal case).
 */
function stripGhostShows(decoded: Uint8Array, recognized: Set<number>): Uint8Array | null {
  const toks = tokenizeContent(decoded);
  const { segments } = collectShowSegments(decoded, toks);
  const splices: Array<{ start: number; end: number; bytes: Uint8Array }> = [];
  for (const seg of segments) {
    if (recognized.has(seg.start)) continue;
    if (seg.bytes.length > 0) return null; // real undecodable text — not a ghost
    splices.push({ start: seg.start, end: seg.end, bytes: new Uint8Array(0) });
  }
  if (splices.length === 0) return null;
  return applySplicesLocal(decoded, splices);
}

/**
 * Burned-in redaction: covered text operators are deleted from the content
 * stream (vector path, recursive through Form XObjects); page-level image
 * XObjects intersecting the rects are pixel-blackened; intersecting
 * annotations are removed; the output is scrubbed (Info/XMP/attachments/
 * JavaScript/thumbnails) and verified (byte-scan + extraction).
 *
 * Pages where removal cannot be proven (Type0/Type3 fonts, inline images,
 * patterns, undecodable text, Form-nested images, un-pixel-redactable
 * images, Form recursion limits) are reported in `skipped` with
 * unprovable=true — the caller must refuse the whole redaction (non-zero
 * exit, no output written), never silently downgrade to a visual cover.
 */
export async function redactRects(rects: RedactRect[], bytes: Uint8Array): Promise<RedactReport> {
  const lib = await loadPdf(bytes);
  const n = lib.getPageCount();
  let removed = 0;
  let partial = 0;
  let annotationsRemoved = 0;
  let imagesPixelRedacted = 0;
  const covered: string[] = [];
  const pages: number[] = [];
  const skipped: Skip[] = [];

  const byPage = new Map<number, RedactRect[]>();
  const regions: RedactRect[] = [];
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
    regions.push({ page: r.page, x: r.x, y: r.y, w: r.w, h: r.h });
  }

  for (const [page1, list] of byPage) {
    const pi = page1 - 1;
    pages.push(page1);
    const rec = recognizePageText(lib, pi);
    // planVectorRedaction takes crop-box-relative coords (it re-adds cropX/Y).
    const rel = list.map((r) => ({
      x: r.x - (rec?.cropX ?? 0),
      y: r.y - (rec?.cropY ?? 0),
      w: r.w,
      h: r.h,
    }));
    const outcome = await redactPage(lib, pi, rel);
    if ('skip' in outcome) {
      skipped.push(outcome.skip);
      annotationsRemoved += outcome.annotationsRemoved;
      continue;
    }
    removed += outcome.ok.removed;
    partial += outcome.ok.partial;
    annotationsRemoved += outcome.ok.annotationsRemoved;
    imagesPixelRedacted += outcome.ok.imagesPixelRedacted;
    covered.push(...outcome.ok.covered);
  }

  const outBytes = await rebuildClean(lib, { scrub: true });
  const verification = await verifyRedaction(outBytes, covered);
  return {
    bytes: outBytes,
    removed,
    partial,
    annotationsRemoved,
    imagesPixelRedacted,
    skipped,
    pages: [...new Set(pages)].sort((a, b) => a - b),
    regions,
    covered,
    unprovable: skipped.some((s) => s.unprovable),
    verification,
    scrubbed: [...SCRUBBED_ENTRIES],
  };
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
  let annotationsRemoved = 0;
  let imagesPixelRedacted = 0;
  const covered: string[] = [];
  const pages: number[] = [];
  const regions: RedactRect[] = [];
  const skipped: Skip[] = [];
  for (const pi of idxs) {
    pages.push(pi + 1);
    const rec = recognizePageText(lib, pi);
    if (!rec || rec.lines.length === 0) {
      skipped.push({ page: pi + 1, reason: 'no invertible text on page', unprovable: false });
      continue;
    }
    const matched = rec.lines.filter((ln) => norm(ln.text, opts.caseSensitive).includes(findN));
    if (matched.length === 0) continue;
    const rects = matched.map((ln) => ({
      page: pi + 1,
      x: ln.seg.tx,
      y: ln.seg.ty - ln.seg.size * 0.3,
      w: ln.advance,
      h: ln.seg.size * 1.2,
    }));
    regions.push(...rects);
    const outcome = await redactPage(
      lib,
      pi,
      rects.map((r) => ({ x: r.x - rec.cropX, y: r.y - rec.cropY, w: r.w, h: r.h })),
    );
    if ('skip' in outcome) {
      skipped.push(outcome.skip);
      continue;
    }
    removed += outcome.ok.removed;
    partial += outcome.ok.partial;
    annotationsRemoved += outcome.ok.annotationsRemoved;
    imagesPixelRedacted += outcome.ok.imagesPixelRedacted;
    covered.push(...outcome.ok.covered);
  }
  const outBytes = await rebuildClean(lib, { scrub: true });
  const verification = await verifyRedaction(outBytes, covered);
  return {
    bytes: outBytes,
    removed,
    partial,
    annotationsRemoved,
    imagesPixelRedacted,
    skipped,
    pages: [...new Set(pages)].sort((a, b) => a - b),
    regions,
    covered,
    unprovable: skipped.some((s) => s.unprovable),
    verification,
    scrubbed: [...SCRUBBED_ENTRIES],
  };
}

/** Keep the PDFDocument type available without importing pdf-lib elsewhere. */
export type { PDFDocument };

/**
 * Machine-readable verification report for a redaction run.
 * Shared by the CLI (`pdfstudio redact` prints it / writes it via --report)
 * and the MCP server (surfaced in the tool response).
 */
export interface RedactCliReport {
  schema: 'pdfstudio.redact-report/v1';
  /** overall verdict: every covered string proven gone AND no unprovable skips */
  pass: boolean;
  /** 0 = pass, 2 = nothing changed, 3 = verification failed or unprovable */
  exitCode: 0 | 2 | 3;
  /** 1-based pages in the redaction scope */
  pages: number[];
  /** redact regions as given (media-box space), empty for --find runs */
  regions: Array<{ page: number; x: number; y: number; w: number; h: number }>;
  find: string | null;
  removed: number;
  partial: number;
  annotationsRemoved: number;
  imagesPixelRedacted: number;
  skipped: Array<{ page: number; reason: string; unprovable: boolean }>;
  verification: RedactVerification;
  scrubbed: string[];
  /** human-readable refusal, set when exitCode === 3 */
  refusal: string | null;
}

export function buildRedactReport(find: string | undefined, r: RedactReport): RedactCliReport {
  const survivors = r.verification.stringsChecked.filter((s) => s.presentInBytes || s.presentInExtraction);
  const unprov = r.skipped.filter((s) => s.unprovable);
  const pass = r.verification.pass && unprov.length === 0;
  let exitCode: 0 | 2 | 3 = 0;
  let refusal: string | null = null;
  if (!pass) {
    exitCode = 3;
    const parts: string[] = [];
    for (const s of unprov) parts.push(`p${s.page}: ${s.reason}`);
    for (const t of survivors) {
      parts.push(
        `covered string still present in output: "${t.text}"` +
          (t.encodingsFound.length ? ` (byte encodings: ${t.encodingsFound.join(', ')})` : '') +
          (t.presentInExtraction ? ' [in text extraction]' : ''),
      );
    }
    refusal =
      'redaction refused: removal could not be proven; no output was written. ' + parts.join('; ');
  } else if (r.removed === 0 && r.imagesPixelRedacted === 0 && r.annotationsRemoved === 0) {
    exitCode = 2;
  }
  return {
    schema: 'pdfstudio.redact-report/v1',
    pass,
    exitCode,
    pages: r.pages,
    regions: r.regions.map((x) => ({ page: x.page, x: x.x, y: x.y, w: x.w, h: x.h })),
    find: find ?? null,
    removed: r.removed,
    partial: r.partial,
    annotationsRemoved: r.annotationsRemoved,
    imagesPixelRedacted: r.imagesPixelRedacted,
    skipped: r.skipped.map((s) => ({ page: s.page, reason: s.reason, unprovable: !!s.unprovable })),
    verification: r.verification,
    scrubbed: r.scrubbed,
    refusal,
  };
}

/**
 * Rebuild the document through copyPages into a fresh PDFDocument.
 *
 * installStream orphans the previous content stream (it stays in the object
 * store as an unreferenced object, which pdf-lib's save() still serializes).
 * Rebuilding drops every orphan, so edited-out / redacted bytes are truly
 * gone from the output file — not just unreferenced. This mirrors the app's
 * own exporter, which always copies pages into a fresh document.
 *
 * With `scrub: true` (redaction outputs only): source metadata is NOT
 * copied, and the scrub pass strips the Info dict, XMP, embedded files,
 * JavaScript/OpenAction/AA entries and thumbnails.
 */
async function rebuildClean(lib: PDFDocument, opts?: { scrub?: boolean }): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  if (!opts?.scrub) {
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
  }
  const pages = await out.copyPages(lib, lib.getPageIndices());
  for (const p of pages) out.addPage(p);
  if (opts?.scrub) scrubRedactedDocument(out);
  return out.save();
}
