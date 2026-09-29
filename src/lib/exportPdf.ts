import {
  LineCapStyle,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFFont,
  PDFImage,
  PDFName,
  PDFNumber,
  PDFObject,
  PDFPage,
  PDFOperator,
  PDFOperatorNames,
  PDFRawStream,
  PDFRef,
  StandardFonts,
  degrees,
  rgb,
} from 'pdf-lib';
import type { Annotation, DocState, FormFieldAnn, PageRec, Source } from '../types';
import { parseRanges } from './ranges';
import { applyFieldValues } from './forms';
import { rasterizePage, transformAnnsToDisplaySpace, type RasterResult } from './rasterize';
import {
  planDeepEdit,
  planVectorRedaction,
  installStream,
  classifyCoveredText,
  sanitizeAcroFormUnderRects,
  sanitizeStructureTree,
  purgeAnnotAppearances,
  redactRectsInAnnotSpace,
} from './textRewrite';
import { gateRedactedExport, type RedactionReport } from './redactVerify';
import type { PDFDocumentProxy } from 'pdfjs-dist';

export interface DocMeta {
  title: string;
  author: string;
  subject: string;
  keywords: string;
}

export interface StampOptions {
  pageNumbers: boolean;
  pnPosition: 'bottom-center' | 'bottom-right' | 'bottom-left';
  pnFormat: string; // tokens: {page} {pages}
  pnStart: number;
  pnSkipFirst: boolean;
  watermark: string;
  wmSize: number;
  wmOpacity: number;
  wmColor: string;
  headerLeft: string;
  headerRight: string;
  footerLeft: string;
  footerRight: string; // tokens: {page} {pages} {date} {title}
}

export const defaultStamps: StampOptions = {
  pageNumbers: false,
  pnPosition: 'bottom-center',
  pnFormat: '{page} / {pages}',
  pnStart: 1,
  pnSkipFirst: false,
  watermark: '',
  wmSize: 56,
  wmOpacity: 0.12,
  wmColor: '#880000',
  headerLeft: '',
  headerRight: '',
  footerLeft: '',
  footerRight: '',
};

export const hasStamps = (s: StampOptions): boolean =>
  s.pageNumbers || s.watermark.trim().length > 0 || [s.headerLeft, s.headerRight, s.footerLeft, s.footerRight].some((v) => v.trim().length > 0);

export function expandTokens(tpl: string, pageNum: number, pageCount: number, title: string): string {
  return tpl
    .replace(/\{page\}/g, String(pageNum))
    .replace(/\{pages\}/g, String(pageCount))
    .replace(/\{date\}/g, new Date().toLocaleDateString())
    .replace(/\{title\}/g, title);
}

/** Draw page numbers, watermark and header/footer onto one out page. */
function drawStamps(page: PDFPage, font: PDFFont, opts: StampOptions, pageNum: number, pageCount: number, title: string): void {
  const { width, height } = page.getSize();
  const ink = (hex: string, opacity: number) => {
    const c = cssHexToRgb(hex);
    return { color: rgb(c.r, c.g, c.b), opacity };
  };
  if (opts.watermark.trim()) {
    const text = expandTokens(opts.watermark, pageNum, pageCount, title);
    const size = Math.max(8, opts.wmSize);
    const tw = font.widthOfTextAtSize(text, size);
    const { color, opacity } = ink(opts.wmColor, opts.wmOpacity);
    page.drawText(text, {
      x: width / 2 - (tw / 2) * Math.SQRT1_2,
      y: height / 2 - (tw / 2) * Math.SQRT1_2,
      size,
      font,
      rotate: degrees(45),
      ...ink(opts.wmColor, opts.wmOpacity),
      color,
      opacity,
    });
  }
  const small = 9;
  const margin = 24;
  if (opts.pageNumbers && !(opts.pnSkipFirst && pageNum === 1)) {
    const label = expandTokens(opts.pnFormat || '{page}', opts.pnStart + pageNum - 1, pageCount, title);
    const { color, opacity } = ink('#444444', 1);
    const tw = font.widthOfTextAtSize(label, small);
    const x = opts.pnPosition === 'bottom-left' ? margin : opts.pnPosition === 'bottom-right' ? width - margin - tw : width / 2 - tw / 2;
    page.drawText(label, { x, y: margin - small * 0.3, size: small, font, ...{ color, opacity } });
  }
  const rows: Array<[string, number, number]> = [];
  if (opts.headerLeft.trim() || opts.headerRight.trim()) {
    const y = height - margin - small * 0.3;
    if (opts.headerLeft.trim()) rows.push([expandTokens(opts.headerLeft, pageNum, pageCount, title), margin, y]);
    if (opts.headerRight.trim()) {
      const t2 = expandTokens(opts.headerRight, pageNum, pageCount, title);
      rows.push([t2, width - margin - font.widthOfTextAtSize(t2, small), y]);
    }
  }
  if (opts.footerLeft.trim() || opts.footerRight.trim()) {
    const y = margin - small * 0.3;
    if (opts.footerLeft.trim()) rows.push([expandTokens(opts.footerLeft, pageNum, pageCount, title), margin, y]);
    if (opts.footerRight.trim()) {
      const t2 = expandTokens(opts.footerRight, pageNum, pageCount, title);
      rows.push([t2, width - margin - font.widthOfTextAtSize(t2, small), y]);
    }
  }
  for (const [text, x, y] of rows) {
    page.drawText(text, { x, y, size: small, font, ...ink('#555555', 1) });
  }
}

/** The pdf-lib standard families the font picker offers (css name → key). */
export const FONT_FAMILIES = ['Helvetica', 'Times', 'Courier'] as const;

/** Pick the matching standard font pair for a css font-family name. */
export function fontPairFor(family: string | undefined): { normal: StandardFonts; bold: StandardFonts } {
  const f = (family ?? '').toLowerCase();
  if (f.includes('times')) return { normal: StandardFonts.TimesRoman, bold: StandardFonts.TimesRomanBold };
  if (f.includes('courier') || f.includes('mono')) return { normal: StandardFonts.Courier, bold: StandardFonts.CourierBold };
  return { normal: StandardFonts.Helvetica, bold: StandardFonts.HelveticaBold };
}

export function cssHexToRgb(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return { r: 0, g: 0, b: 0 };
  const n = parseInt(m[1], 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

async function fontFor(pdfDoc: PDFDocument, weight: 'bold' | 'normal', family?: string): Promise<PDFFont> {
  const pair = fontPairFor(family);
  return pdfDoc.embedFont(weight === 'bold' ? pair.bold : pair.normal);
}

/**
 * Emits real redaction: pages with redact boxes are RASTERIZED (see
 * rasterize.ts) so the original content stream is discarded entirely — what
 * is gone from the pixels is gone from the file, not hidden behind a box.
 */
function burnRedactions(page: PDFPage, rects: Array<{ x: number; y: number; w: number; h: number }>): void {
  if (rects.length === 0) return;
  const ops: PDFOperator[] = [PDFOperator.of(PDFOperatorNames.PushGraphicsState)];
  for (const r of rects) {
    if (!(r.w > 0 && r.h > 0)) continue;
    ops.push(
      PDFOperator.of(PDFOperatorNames.AppendRectangle, [PDFNumber.of(r.x), PDFNumber.of(r.y), PDFNumber.of(r.x + r.w), PDFNumber.of(r.y + r.h)]),
    );
  }
  // Even-odd fill rule + no-paint closes the clip: every region inside an odd
  // number of redact rects is excluded from ALL subsequent painting.
  ops.push(PDFOperator.of(PDFOperatorNames.ClipEvenOdd), PDFOperator.of(PDFOperatorNames.EndPath), PDFOperator.of(PDFOperatorNames.PopGraphicsState));
  page.pushOperators(...ops);
}

/** Redact annotations of one page, in content-space coordinates. */
function redactRectsFor(anns: Annotation[] | undefined): Array<{ x: number; y: number; w: number; h: number }> {
  return (anns ?? []).filter((a): a is Extract<Annotation, { type: 'redact' }> => a.type === 'redact');
}

/**
 * Remove source-document annotations (/Annots) that intersect any redact
 * rect — an annotation sitting under a redact box would otherwise survive
 * in the exported file with its text intact. Runs on the source lib BEFORE
 * copyPages.
 *
 * The redact rects are crop-box-relative (y-up); source /Annots /Rect is in
 * default user space, so the crop origin is added. Intersection is tested
 * conservatively in both unrotated space and 90/180/270°-rotated variants
 * of the rects (annotations live in default user space; over-removal is the
 * safe direction).
 *
 * Returns false when an annotation's geometry cannot be determined — the
 * caller must then force the raster path instead of trusting the vector
 * path.
 */
function sanitizeSourceAnnots(lib: PDFDocument, pageIndex: number, rects: Array<{ x: number; y: number; w: number; h: number }>): boolean {
  try {
    const node = lib.getPage(pageIndex).node;
    const annots = node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (!annots || annots.size() === 0 || rects.length === 0) return true;
    const allRects = redactRectsInAnnotSpace(lib, pageIndex, rects);
    const keep: PDFObject[] = [];
    for (let i = 0; i < annots.size(); i++) {
      const raw = annots.get(i);
      const a = lib.context.lookup(raw);
      const rArr = a instanceof PDFDict ? a.lookupMaybe(PDFName.of('Rect'), PDFArray) : undefined;
      if (!rArr || rArr.size() < 4) return false; // undeterminable → force raster
      const nums: number[] = [];
      for (let k = 0; k < 4; k++) {
        const n = lib.context.lookupMaybe(rArr.get(k), PDFNumber);
        if (!n || !Number.isFinite(n.asNumber())) return false; // undeterminable → force raster
        nums.push(n.asNumber());
      }
      const ax0 = Math.min(nums[0], nums[2]);
      const ay0 = Math.min(nums[1], nums[3]);
      const ax1 = Math.max(nums[0], nums[2]);
      const ay1 = Math.max(nums[1], nums[3]);
      let hit = false;
      for (const q of allRects) {
        if (ax0 < q.x + q.w && ax1 > q.x && ay0 < q.y + q.h && ay1 > q.y) { hit = true; break; }
      }
      if (hit) {
        // Purge the appearance stream too: it renders the annotation's
        // content, and pdf-lib serializes even unreferenced objects, so a
        // merely-dropped annotation would leak its text as an orphan.
        if (a instanceof PDFDict) purgeAnnotAppearances(lib.context, a);
      } else {
        keep.push(raw);
      }
    }
    if (keep.length === 0) node.delete(PDFName.of('Annots'));
    else {
      const fresh = PDFArray.withContext(lib.context);
      for (const k of keep) fresh.push(k);
      node.set(PDFName.of('Annots'), lib.context.register(fresh));
    }
    return true;
  } catch {
    return false; // undeterminable → force raster
  }
}

/* ------------------------------------------------------------------ */
/* Redacted-export scrub: metadata, attachments, JavaScript, thumbnails  */
/* ------------------------------------------------------------------ */

/**
 * Recursively delete an indirect object and everything it references.
 * pdf-lib's save() serializes ALL indirect objects in the context — even
 * ones no longer referenced — so merely dropping the reference is NOT
 * enough: the bytes would survive in the file. Cycle-safe via `seen`.
 */
function purgeTree(ctx: import('pdf-lib').PDFContext, obj: PDFObject, seen: Set<string>): void {
  if (obj instanceof PDFRef) {
    const key = obj.toString();
    if (seen.has(key)) return;
    seen.add(key);
    const target = ctx.lookup(obj);
    if (target) purgeTreeValue(ctx, target, seen);
    ctx.delete(obj);
    return;
  }
  purgeTreeValue(ctx, obj, seen);
}

function purgeTreeValue(ctx: import('pdf-lib').PDFContext, target: PDFObject, seen: Set<string>): void {
  if (target instanceof PDFDict) {
    for (const [, v] of target.entries()) purgeTree(ctx, v, seen);
  } else if (target instanceof PDFArray) {
    for (let i = 0; i < target.size(); i++) purgeTree(ctx, target.get(i), seen);
  } else if (target instanceof PDFRawStream) {
    for (const [, v] of target.dict.entries()) purgeTree(ctx, v, seen);
  }
}

/** True when the object is a /JavaScript action (the only kind we purge). */
function isJavaScriptAction(ctx: import('pdf-lib').PDFContext, obj: PDFObject): boolean {
  const t = obj instanceof PDFRef ? ctx.lookup(obj) : obj;
  if (!(t instanceof PDFDict)) return false;
  const s = t.get(PDFName.of('S'));
  return s instanceof PDFName && s.asString() === '/JavaScript';
}

/**
 * Strip everything a redacted export must not carry: the whole document Info
 * dict (Author/Creator/Producer/Title/Subject/Keywords), the XMP metadata
 * stream, embedded files (/EmbeddedFiles name tree), document JavaScript
 * (/OpenAction, /AA, /Names/JavaScript), and page thumbnails (/Thumb).
 * Runs on the OUTPUT document, before save. Never throws — a scrub failure
 * is logged, and the verification gate still guards delivery.
 */
export function scrubRedactionArtifacts(out: PDFDocument): void {
  try {
    const ctx = out.context;
    const catalog = out.catalog;
    const seen = new Set<string>();

    // 1. Document Info dict — referenced from the TRAILER, not the catalog
    // (catalog.get('Info') is always undefined in pdf-lib and a no-op).
    const infoRaw = ctx.trailerInfo.Info;
    if (infoRaw !== undefined) {
      delete ctx.trailerInfo.Info;
      purgeTree(ctx, infoRaw, seen);
    }
    // 2. XMP metadata stream.
    const metaRaw = catalog.get(PDFName.of('Metadata'));
    if (metaRaw !== undefined) {
      catalog.delete(PDFName.of('Metadata'));
      purgeTree(ctx, metaRaw, seen);
    }
    // 3. Embedded files + document-level JavaScript name trees.
    const names = catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
    if (names) {
      for (const key of ['EmbeddedFiles', 'JavaScript']) {
        const raw = names.get(PDFName.of(key));
        if (raw !== undefined) {
          names.delete(PDFName.of(key));
          purgeTree(ctx, raw, seen);
        }
      }
      if (names.keys().length === 0) catalog.delete(PDFName.of('Names'));
    }
    // 4. Document JavaScript: /OpenAction and the catalog /AA dict. Only
    // purge when the target is actually a JS action — a bare [page /Fit]
    // OpenAction references the page itself and must not be deep-deleted.
    const oaRaw = catalog.get(PDFName.of('OpenAction'));
    if (oaRaw !== undefined) {
      catalog.delete(PDFName.of('OpenAction'));
      if (isJavaScriptAction(ctx, oaRaw)) purgeTree(ctx, oaRaw, seen);
    }
    const aaRaw = catalog.get(PDFName.of('AA'));
    if (aaRaw !== undefined) {
      catalog.delete(PDFName.of('AA'));
      const aa = aaRaw instanceof PDFRef ? ctx.lookup(aaRaw) : aaRaw;
      if (aa instanceof PDFDict) {
        for (const [, v] of aa.entries()) {
          if (isJavaScriptAction(ctx, v)) purgeTree(ctx, v, seen);
        }
      }
      if (aaRaw instanceof PDFRef) ctx.delete(aaRaw);
    }
    // 5. Page level: additional actions and thumbnails.
    for (const page of out.getPages()) {
      const node = page.node;
      const paaRaw = node.get(PDFName.of('AA'));
      if (paaRaw !== undefined) {
        node.delete(PDFName.of('AA'));
        const paa = paaRaw instanceof PDFRef ? ctx.lookup(paaRaw) : paaRaw;
        if (paa instanceof PDFDict) {
          for (const [, v] of paa.entries()) {
            if (isJavaScriptAction(ctx, v)) purgeTree(ctx, v, seen);
          }
        }
        if (paaRaw instanceof PDFRef) ctx.delete(paaRaw);
      }
      const thumbRaw = node.get(PDFName.of('Thumb'));
      if (thumbRaw !== undefined) {
        node.delete(PDFName.of('Thumb'));
        purgeTree(ctx, thumbRaw, seen);
      }
    }
  } catch (e) {
    console.warn('redaction scrub incomplete:', e);
  }
}

/** Bounds of an app annotation in its own coordinate space. */
function annBounds(a: Annotation): { x: number; y: number; w: number; h: number } | null {
  switch (a.type) {
    case 'text':
      return { x: a.x, y: a.y, w: 0.01, h: 0.01 }; // point-in-rect test
    case 'ink': {
      if (a.pts.length === 0) return null;
      const xs = a.pts.map((p) => p.x);
      const ys = a.pts.map((p) => p.y);
      const x0 = Math.min(...xs);
      const x1 = Math.max(...xs);
      const y0 = Math.min(...ys);
      const y1 = Math.max(...ys);
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    case 'note': {
      const s = Math.max(8, a.w ?? 16);
      return { x: a.x, y: a.y, w: s, h: a.h ?? s };
    }
    case 'arrow': {
      const x0 = Math.min(a.x1, a.x2);
      const x1 = Math.max(a.x1, a.x2);
      const y0 = Math.min(a.y1, a.y2);
      const y1 = Math.max(a.y1, a.y2);
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    case 'highlight':
    case 'underline':
    case 'strike':
    case 'redact':
    case 'whiteout':
    case 'rect':
    case 'ellipse':
    case 'image':
    case 'edit':
    case 'formfield':
      return { x: a.x, y: a.y, w: a.w, h: a.h };
    default:
      return null;
  }
}

/**
 * True when an app annotation's bounds intersect any redact rect (same
 * coordinate space for both). Unknown geometry counts as intersecting —
 * the safe direction is to skip drawing it.
 */
function annIntersectsRedact(a: Annotation, rects: Array<{ x: number; y: number; w: number; h: number }>): boolean {
  const b = annBounds(a);
  if (!b) return true;
  for (const r of rects) {
    if (b.x < r.x + r.w && b.x + b.w > r.x && b.y < r.y + r.h && b.y + b.h > r.y) return true;
  }
  return false;
}

/**
 * Renders the page with pdf.js, burns the redact boxes into the pixels and
 * returns the raster — the ONLY path in which redacted content is truly
 * removed from the file (the original content stream is discarded). Returns
 * null when there is nothing to redact or rendering is unavailable.
 */
async function maybeRasterForRedaction(
  p: PageRec,
  pageAnns: Annotation[] | undefined,
  proxies: ReadonlyMap<string, PDFDocumentProxy> | undefined,
  totalRotation: number,
): Promise<RasterResult | null> {
  const rects = redactRectsFor(pageAnns);
  if (rects.length === 0 || !proxies || p.src === null) return null;
  const proxy = proxies.get(p.src);
  if (!proxy || p.page === null) return null;
  return rasterizePage(
    proxy,
    p,
    p.page,
    totalRotation,
    rects,
  );
}

/**
 * Deep content-stream pass for one source page, applied to `lib` BEFORE the
 * page is copied into the output:
 *  1. Vector redaction — show-text operators FULLY covered by a redact box
 *     are deleted from the content stream (unrecoverable), while the rest of
 *     the page stays vector. When every intersecting line was removed this
 *     way, pixel rasterization is skipped entirely.
 *  2. True text edits — an edit annotation carrying `origText` removes the
 *     original glyphs from the stream; the styled replacement is then drawn
 *     by the normal overlay painter as REAL new text. Old bytes: gone.
 *
 * Returns true when vector redaction fully handled the page (no raster
 * fallback needed). Never throws — failures fall back to the overlay/raster
 * paths, which remain correct.
 */
async function applyDeepContentPass(
  lib: import('pdf-lib').PDFDocument,
  p: PageRec,
  pageAnns: Annotation[],
): Promise<{ vectorDone: boolean; clearedFieldValues: string[]; coveredText: string[] }> {
  const none = { vectorDone: false, clearedFieldValues: [] as string[], coveredText: [] as string[] };
  try {
    if (p.page === null) return none;
    const rects = redactRectsFor(pageAnns);
    let vectorDone = false;
    const clearedFieldValues: string[] = [];
    const coveredText: string[] = [];
    if (rects.length > 0) {
      // Clear AcroForm field values under the rects FIRST: this reads its
      // widget list from the page's /Annots, which the annotation sanitizer
      // below then drops. (Value can survive via the catalog-level /Fields
      // dict even when the widget annot is removed.)
      const formRes = sanitizeAcroFormUnderRects(lib, p.page, rects);
      clearedFieldValues.push(...formRes.cleared);
      // Strip source-document annotations under the redact boxes: an
      // annotation there would otherwise survive with its text intact.
      // Undeterminable annotation geometry forces the raster path.
      const annotsOk = sanitizeSourceAnnots(lib, p.page, rects);
      // Sanitize structure-tree /Alt, /ActualText, /E under the rects.
      const structOk = sanitizeStructureTree(lib, p.page, rects);
      const vr = annotsOk && formRes.ok && structOk ? planVectorRedaction(lib, p.page, rects) : null;
      if (vr && vr.partial === 0) {
        // Vector analysis complete: everything under the rects was removed
        // (or there was nothing in the content stream — e.g. a widget-only
        // rect handled by the annot/AcroForm sanitizers above).
        if (vr.changed) installStream(lib, p.page, vr.bytes);
        coveredText.push(...vr.coveredText);
        vectorDone = true;
      }
    }
    // True text edits (skip when the page will be rasterized — the raster
    // renders the ORIGINAL stream from the pdf.js proxy, so stream edits
    // would be invisible there and the overlay must stay).
    if (rects.length === 0 || vectorDone) {
      for (const ea of pageAnns) {
        if (ea.type !== 'edit') continue;
        const orig = (ea as { origText?: string }).origText;
        if (!orig) continue;
        const plan = planDeepEdit(lib, p.page, {
          hit: {
            x: ea.x,
            y: ea.y,
            w: ea.w,
            h: ea.h,
            text: orig,
            cell: (ea as { cell?: boolean }).cell,
            gapBefore: (ea as { gapBefore?: number }).gapBefore,
          },
          newText: ea.text,
          size: ea.size,
          color: ea.color,
          font: ea.font,
        });
        if (plan) {
          installStream(lib, p.page, plan.bytes);
          // whole-line rewrite → the replacement is IN the page content now;
          // drop the overlay annotation so it is not double-drawn.
          if (plan.lineReplace) {
            const i = pageAnns.indexOf(ea);
            if (i >= 0) pageAnns.splice(i, 1);
          }
        }
      }
    }
    return { vectorDone, clearedFieldValues, coveredText };
  } catch (e) {
    console.warn('deep content pass skipped:', e);
    return { vectorDone: false, clearedFieldValues: [], coveredText: [] };
  }
}

async function drawAnn(
  page: PDFPage,
  ann: Annotation,
  fonts: { normal: PDFFont; bold: PDFFont },
  embedCache: Map<string, Promise<PDFImage>>,
  pdfDoc: PDFDocument,
  skipEditOverlay = false,
): Promise<void> {
  const normal = fonts.normal;
  const bold = fonts.bold;
  switch (ann.type) {
    case 'highlight': {
      const c = cssHexToRgb(ann.color);
      page.drawRectangle({ x: ann.x, y: ann.y, width: ann.w, height: ann.h, color: rgb(c.r, c.g, c.b), opacity: ann.opacity });
      break;
    }
    case 'underline':
    case 'strike': {
      const c = cssHexToRgb(ann.color);
      const thick = Math.max(1, ann.h * 0.16);
      const yOff = ann.type === 'underline' ? ann.y + ann.h * 0.06 : ann.y + ann.h * 0.45;
      page.drawRectangle({
        x: ann.x,
        y: yOff,
        width: ann.w,
        height: thick,
        color: rgb(c.r, c.g, c.b),
        opacity: ann.opacity,
      });
      break;
    }
    case 'redact': {
      // visual marker only — the actual content removal is burnRedactions()
      const c = cssHexToRgb(ann.color || '#101014');
      page.drawRectangle({ x: ann.x, y: ann.y, width: ann.w, height: ann.h, color: rgb(c.r, c.g, c.b), opacity: 1 });
      break;
    }
    case 'arrow': {
      const c = cssHexToRgb(ann.color);
      const col = rgb(c.r, c.g, c.b);
      page.drawLine({
        start: { x: ann.x1, y: ann.y1 },
        end: { x: ann.x2, y: ann.y2 },
        thickness: ann.width,
        color: col,
        opacity: ann.opacity,
        lineCap: LineCapStyle.Round,
      });
      // open V arrowhead at (x2,y2), oriented along the shaft
      const ang = Math.atan2(ann.y2 - ann.y1, ann.x2 - ann.x1);
      const head = Math.max(8, ann.width * 4);
      const spread = Math.PI / 7; // ~26°
      for (const s of [-1, 1]) {
        const a2 = ang + Math.PI + s * spread;
        page.drawLine({
          start: { x: ann.x2, y: ann.y2 },
          end: { x: ann.x2 + head * Math.cos(a2), y: ann.y2 + head * Math.sin(a2) },
          thickness: ann.width,
          color: col,
          opacity: ann.opacity,
          lineCap: LineCapStyle.Round,
        });
      }
      break;
    }
    case 'rect': {
      const c = cssHexToRgb(ann.color);
      const f = ann.fill ? cssHexToRgb(ann.fill) : null;
      page.drawRectangle({
        x: ann.x,
        y: ann.y,
        width: ann.w,
        height: ann.h,
        borderColor: rgb(c.r, c.g, c.b),
        borderWidth: ann.width,
        borderOpacity: ann.opacity,
        color: f ? rgb(f.r, f.g, f.b) : undefined,
        opacity: f ? ann.opacity * 0.35 : 0,
      });
      break;
    }
    case 'ellipse': {
      const c = cssHexToRgb(ann.color);
      const f = ann.fill ? cssHexToRgb(ann.fill) : null;
      page.drawEllipse({
        x: ann.x + ann.w / 2,
        y: ann.y + ann.h / 2,
        xScale: Math.max(1, ann.w / 2),
        yScale: Math.max(1, ann.h / 2),
        borderColor: rgb(c.r, c.g, c.b),
        borderWidth: ann.width,
        borderOpacity: ann.opacity,
        color: f ? rgb(f.r, f.g, f.b) : undefined,
        opacity: f ? ann.opacity * 0.35 : 0,
      });
      break;
    }
    case 'whiteout': {
      const c = cssHexToRgb(ann.color);
      page.drawRectangle({ x: ann.x, y: ann.y, width: ann.w, height: ann.h, color: rgb(c.r, c.g, c.b), opacity: 1 });
      break;
    }
    case 'ink': {
      const c = cssHexToRgb(ann.color);
      for (let i = 1; i < ann.pts.length; i++) {
        const a = ann.pts[i - 1];
        const b = ann.pts[i];
        page.drawLine({
          start: { x: a.x, y: a.y },
          end: { x: b.x, y: b.y },
          thickness: ann.width,
          color: rgb(c.r, c.g, c.b),
          opacity: ann.opacity,
          lineCap: LineCapStyle.Round,
        });
      }
      break;
    }
    case 'text': {
      const c = cssHexToRgb(ann.color);
      const size = Math.max(4, ann.size);
      const text = ann.text.replace(/\s+/g, ' ').trim();
      const font = ann.font ? await fontFor(pdfDoc, 'normal', ann.font) : normal;
      if (text) page.drawText(text, { x: ann.x, y: ann.y, size, font, color: rgb(c.r, c.g, c.b) });
      break;
    }
    case 'edit': {
      // When the deep content pass rewrote the WHOLE line into the stream, the
      // replacement is already part of the page content — the annotation is
      // removed from pageAnns by the deep pass, so this is normally not hit.
      if (skipEditOverlay) break;
      const bg = cssHexToRgb(ann.bg || '#ffffff');
      const c = cssHexToRgb(ann.color);
      page.drawRectangle({ x: ann.x, y: ann.y, width: ann.w, height: ann.h, color: rgb(bg.r, bg.g, bg.b), opacity: 1 });
      const size = Math.max(4, ann.size);
      const text = ann.text.replace(/\s+/g, ' ').trim();
      const font = ann.font ? await fontFor(pdfDoc, 'normal', ann.font) : normal;
      if (text) page.drawText(text, { x: ann.x, y: ann.y + ann.h * 0.18, size, font, color: rgb(c.r, c.g, c.b) });
      break;
    }
    case 'note': {
      const sz = Math.max(8, ann.w ?? 16);
      const c = cssHexToRgb(ann.color);
      page.drawRectangle({ x: ann.x, y: ann.y, width: sz, height: ann.h ?? sz, color: rgb(c.r, c.g, c.b), opacity: 1 });
      // folded corner
      const fold = sz * 0.34;
      page.drawRectangle({
        x: ann.x + sz - fold,
        y: ann.y + sz - fold,
        width: fold,
        height: fold,
        color: rgb(Math.max(0, c.r - 0.18), Math.max(0, c.g - 0.18), Math.max(0, c.b - 0.18)),
        opacity: 1,
      });
      page.drawText(String(ann.n), {
        x: ann.x + sz * 0.5 - ann.n.toString().length * 1.7,
        y: ann.y + (ann.h ?? sz) * 0.5 - 3.2,
        size: sz * 0.5,
        font: bold,
        color: ann.color.toLowerCase() === '#ffd43b' ? rgb(0.35, 0.26, 0) : rgb(1, 1, 1),
      });
      break;
    }    case 'image': {
      const mime = ann.dataUrl.split(';')[0]?.replace('data:', '') ?? 'image/png';
      let imgP = embedCache.get(ann.dataUrl);
      if (!imgP) {
        const raw = ann.dataUrl.split(',')[1];
        if (!raw) return;
        const bin = atob(raw);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        try {
          const promise = mime === 'image/jpeg' ? pdfDoc.embedJpg(bytes) : pdfDoc.embedPng(bytes);
          imgP = promise as unknown as Promise<PDFImage>;
        } catch {
          return;
        }
        embedCache.set(ann.dataUrl, imgP);
      }
      const img = await imgP;
      if (ann.flipH || ann.flipV) {
        // draw via raw cm matrix so the stamp mirrors inside its own rect
        const sx = ann.flipH ? -1 : 1;
        const sy = ann.flipV ? -1 : 1;
        const tx = ann.flipH ? ann.x + ann.w : ann.x;
        const ty = ann.flipV ? ann.y + ann.h : ann.y;
        const xobj = page.node.newXObject('StudioStamp', img.ref);
        page.pushOperators(
          PDFOperator.of(PDFOperatorNames.PushGraphicsState),
          PDFOperator.of(PDFOperatorNames.ConcatTransformationMatrix, [
            PDFNumber.of(sx),
            PDFNumber.of(0),
            PDFNumber.of(0),
            PDFNumber.of(sy),
            PDFNumber.of(tx),
            PDFNumber.of(ty),
          ]),
          PDFOperator.of(PDFOperatorNames.DrawObject, [xobj]),
          PDFOperator.of(PDFOperatorNames.PopGraphicsState),
        );
      } else {
        page.drawImage(img, { x: ann.x, y: ann.y, width: ann.w, height: ann.h, opacity: 1 });
      }
      break;
    }
  }
}

export interface ExportInput {
  doc: DocState;
  meta: DocMeta;
  /** comma ranges of 1-based page numbers; empty => all pages */
  range: string;
  /** per-source AcroForm values to write before pages are copied */
  formValues?: Record<string, Record<string, string | boolean>>;
  /** burn filled form values into page content (fields become static) */
  flattenForms?: boolean;
  /** page numbers / watermark / header-footer */
  stamps?: StampOptions;
  /** pdf.js proxies per source id — enables TRUE redaction (content removal
   *  via page rasterization) for pages that carry redact boxes. */
  proxies?: ReadonlyMap<string, PDFDocumentProxy>;
}

export interface BuildPdfResult {
  bytes: Uint8Array;
  pages: number;
  /** present when the export carried redactions: the verification report */
  verification?: RedactionReport;
  /** decoded covered strings captured pre-export (for post-compress re-verification) */
  coveredStrings: string[];
}

export async function buildPdf({ doc, meta, range, formValues, flattenForms, stamps, proxies }: ExportInput): Promise<BuildPdfResult> {
  const idxs = range.trim() ? parseRanges(range, doc.pages.length) : doc.pages.map((_, i) => i);
  const pagesToExport: PageRec[] = idxs.map((i) => doc.pages[i]);

  const out = await PDFDocument.create();
  const picked = fontPairFor(doc.settings?.font);
  const fonts = { normal: await out.embedFont(picked.normal), bold: await out.embedFont(picked.bold) };
  const embedCache = new Map<string, Promise<PDFImage>>();

  // Load each needed source file once.
  const libBySource = new Map<string, PDFDocument>();
  for (const p of pagesToExport) {
    if (p.src && !libBySource.has(p.src)) {
      const src: Source | undefined = doc.sources.find((s) => s.id === p.src);
      if (src) {
        const lib = await PDFDocument.load(src.bytes, { ignoreEncryption: true });
        const vals = formValues?.[p.src];
        if (vals && Object.keys(vals).length > 0) {
          // Write values, then flatten IN THE SOURCE: pdf-lib's copyPages does
          // not carry the AcroForm across, so live fields would be dropped and
          // values lost. Flattening burns the values into page content.
          const res = applyFieldValues(lib, vals);
          if (res.applied > 0) {
            try {
              lib.getForm().flatten();
            } catch {
              /* keep going: unflattened */
            }
          }
        }
        libBySource.set(p.src, lib);
      }
    }
  }

  const annsByPage = new Map<string, Annotation[]>();
  for (const a of doc.anns) {
    const list = annsByPage.get(a.pageId) ?? [];
    list.push(a);
    annsByPage.set(a.pageId, list);
  }
  // Marker numbering is drawn from the annotation itself (n) — fine.

  /** User-placed fillable fields, collected with their final out page so
   *  real AcroForm widgets can be created after the page loop. */
  const formWidgets: Array<{ page: PDFPage; ann: FormFieldAnn }> = [];

  /** Redaction-truth bookkeeping: rect count + covered strings for the
   *  post-export verification gate. */
  let redactionRegions = 0;
  const coveredStrings: string[] = [];

  for (const p of pagesToExport) {
    let outPage: PDFPage;
    let pageAnns = annsByPage.get(p.id) ?? [];
    let raster: RasterResult | null = null;
    if (p.src) {
      const lib = libBySource.get(p.src);
      if (!lib || p.page === null || p.page >= lib.getPageCount()) continue;
      const intrinsic = doc.sources.find((s) => s.id === p.src)?.pages[p.page]?.rot ?? 0;
      const total = ((intrinsic + p.rot) % 360 + 360) % 360;
      // Capture the text sitting under the redact rects BEFORE the deep pass
      // mutates the stream — the verification gate checks these strings are
      // absent from the OUTPUT bytes.
      const pageRects = redactRectsFor(pageAnns);
      if (pageRects.length > 0) {
        redactionRegions += pageRects.length;
        const cov = classifyCoveredText(lib, p.page, pageRects);
        if (cov) coveredStrings.push(...cov.covered);
      }
      // Deep pass FIRST: delete covered text operators / edited lines from
      // the source lib so the copied page (vector, flip or raster) carries
      // the removal. Returns vectorDone=true when rasterization can be skipped.
      const deep = await applyDeepContentPass(lib, p, pageAnns);
      coveredStrings.push(...deep.clearedFieldValues, ...deep.coveredText);
      const vectorRedactDone = deep.vectorDone;
      // TRUE redaction: pages still carrying unremovable redact coverage are
      // REPLACED by a raster with the boxes burned into the pixels — the
      // original content stream is discarded entirely.
      raster = vectorRedactDone ? null : await maybeRasterForRedaction(p, pageAnns, proxies, total);
      if (pageRects.length > 0 && !vectorRedactDone && !raster) {
        // Neither vector nor raster redaction completed: the clip-path
        // fallback below would only HIDE the content while leaving it in the
        // file, which violates the redaction guarantee. Refuse loudly.
        throw new Error(`redaction-failed: page ${p.page === null ? '?' : p.page + 1} could not be securely redacted`);
      }
      if (raster) {
        outPage = out.addPage([raster.w, raster.h]); // rotation + flip baked into the bitmap
        const jpgB64 = raster.dataUrl.split(',')[1] ?? '';
        const bin = atob(jpgB64);
        const jpgBytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) jpgBytes[i] = bin.charCodeAt(i);
        const img = await out.embedJpg(jpgBytes);
        outPage.drawImage(img, { x: 0, y: 0, width: raster.w, height: raster.h, opacity: 1 });
        pageAnns = transformAnnsToDisplaySpace(pageAnns, { x: p.bx, y: p.by, w: p.w, h: p.h }, total, p.flip ?? 0, raster.w, raster.h);
      } else if (p.flip) {
        // MIRRORED PAGE: embed the source page (crop-box normalized, content
        // space) as an XObject and draw it with a mirror matrix on a fresh
        // page. NOTE: the embed must come from the SOURCE document — pdf-lib
        // deadlocks when embedding a page that already belongs to `out`.
        // /Rotate is display-only; embedPage gives us raw content space, and
        // the page's total rotation is re-applied below. Because the app flips
        // in DISPLAY space, the content-space mirror axes swap for 90/270°.
        const embedded = await out.embedPage(lib.getPage(p.page));
        const w = embedded.width;
        const h = embedded.height;
        outPage = out.addPage([w, h]);
        outPage.setRotation(degrees(total));
        const swap = total % 180 === 90;
        const mh = swap ? p.flip & 2 : p.flip & 1;
        const mv = swap ? p.flip & 1 : p.flip & 2;
        const xobj = outPage.node.newXObject('StudioMirror', embedded.ref);
        outPage.pushOperators(
          PDFOperator.of(PDFOperatorNames.PushGraphicsState),
          PDFOperator.of(PDFOperatorNames.ConcatTransformationMatrix, [
            PDFNumber.of(mh ? -1 : 1),
            PDFNumber.of(0),
            PDFNumber.of(0),
            PDFNumber.of(mv ? -1 : 1),
            PDFNumber.of(mh ? w : 0),
            PDFNumber.of(mv ? h : 0),
          ]),
          PDFOperator.of(PDFOperatorNames.DrawObject, [xobj]),
          PDFOperator.of(PDFOperatorNames.PopGraphicsState),
        );
      } else {
        const [copied] = await out.copyPages(lib, [p.page]);
        outPage = out.addPage(copied);
        const intrinsic = doc.sources.find((s) => s.id === p.src)?.pages[p.page]?.rot ?? 0;
        outPage.setRotation(degrees(((intrinsic + p.rot) % 360 + 360) % 360));
      }
    } else {
      outPage = out.addPage([p.w, p.h]);
    }
    if (!raster) {
      // Clip-based fallback (only when rasterization is unavailable): the
      // region is excluded from all later painting. Content underneath may
      // still exist in the file — the raster path above is the real removal.
      // NOTE: when redact rects exist this branch is unreachable: the hard
      // refusal above throws instead of shipping a clip-path cover-up.
      burnRedactions(outPage, redactRectsFor(pageAnns));
    }
    // App annotations intersecting a redact box are NOT drawn: re-painting
    // them on top would re-expose the redacted content (the 'redact' boxes
    // themselves are always drawn). In the raster branch both lists are in
    // display space; otherwise both are in content space.
    const drawRects = redactRectsFor(pageAnns);
    for (const a of pageAnns) {
      // User-placed fillable fields become real AcroForm widgets below —
      // they are not drawn as vector annotations. A field under a redact
      // box is dropped entirely (its value could carry redacted content).
      if (a.type === 'formfield') {
        if (drawRects.length > 0 && annIntersectsRedact(a, drawRects)) continue;
        formWidgets.push({ page: outPage, ann: a });
        continue;
      }
      if (a.type !== 'redact' && drawRects.length > 0 && annIntersectsRedact(a, drawRects)) continue;
      await drawAnn(outPage, a, fonts, embedCache, out);
    }
    if (stamps) {
      const displayNum = pagesToExport.indexOf(p) + 1;
      drawStamps(outPage, fonts.normal, stamps, displayNum, pagesToExport.length, meta.title.trim() || doc.name);
    }
  }

  // Emit real, fillable AcroForm fields for user-placed form widgets.
  if (formWidgets.length > 0) {
    const form = out.getForm();
    const usedNames = new Set<string>();
    let seq = 0;
    for (const { page, ann } of formWidgets) {
      seq += 1;
      const name = ann.name && !usedNames.has(ann.name) ? ann.name : `field_${seq}`;
      usedNames.add(name);
      try {
        if (ann.kind === 'checkbox') {
          const cb = form.createCheckBox(name);
          cb.addToPage(page, { x: ann.x, y: ann.y, width: Math.max(8, ann.w), height: Math.max(8, ann.h) });
          if (ann.checked) cb.check();
        } else {
          const tf = form.createTextField(name);
          tf.addToPage(page, { x: ann.x, y: ann.y, width: Math.max(10, ann.w), height: Math.max(10, ann.h) });
          if (ann.value) tf.setText(ann.value);
        }
      } catch (e) {
        console.warn('form widget skipped:', name, e);
      }
    }
    try {
      form.updateFieldAppearances(fonts.normal);
    } catch {
      /* appearance generation is best-effort */
    }
  }

  const redacted = redactionRegions > 0;
  if (redacted) {
    // Redacted export: strip metadata, attachments, JavaScript, thumbnails.
    // The whole Info dict goes — no title/author/producer is re-applied.
    scrubRedactionArtifacts(out);
  } else {
    const t = meta.title.trim() || doc.name;
    if (t) out.setTitle(t);
    if (meta.author.trim()) out.setAuthor(meta.author.trim());
    if (meta.subject.trim()) out.setSubject(meta.subject.trim());
    const kws = meta.keywords
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (kws.length) out.setKeywords(kws);
    out.setProducer('PDF Studio (client-side)');
    out.setCreator('PDF Studio');
  }

  const bytes = await out.save({ useObjectStreams: true });
  if (redacted) {
    // Verification GATES delivery: throws `verification-failed` when any
    // covered string is still recoverable — no file is delivered.
    const verification = await gateRedactedExport(bytes, coveredStrings, redactionRegions);
    return { bytes, pages: pagesToExport.length, verification, coveredStrings };
  }
  return { bytes, pages: pagesToExport.length, coveredStrings: [] };
}

export function downloadBytes(bytes: Uint8Array, filename: string) {
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function niceFileName(name: string, action: string, n?: number): string {
  const base = name.replace(/\.pdf$/i, '');
  return `${base}-${action}${n ? `-${n}` : ''}.pdf`;
}
