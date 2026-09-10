import {
  LineCapStyle,
  PDFDocument,
  PDFFont,
  PDFImage,
  PDFName,
  PDFNumber,
  PDFPage,
  PDFOperator,
  PDFOperatorNames,
  StandardFonts,
  degrees,
  rgb,
} from 'pdf-lib';
import type { Annotation, DocState, PageRec, Source } from '../types';
import { parseRanges } from './ranges';
import { applyFieldValues } from './forms';
import { rasterizePage, transformAnnsToDisplaySpace, type RasterResult } from './rasterize';
import { planDeepEdit, planVectorRedaction, installStream } from './textRewrite';
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

function expandTokens(tpl: string, pageNum: number, pageCount: number, title: string): string {
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
): Promise<boolean> {
  try {
    if (p.page === null) return false;
    const rects = redactRectsFor(pageAnns);
    let vectorDone = false;
    if (rects.length > 0) {
      const vr = planVectorRedaction(lib, p.page, rects);
      if (vr) {
        installStream(lib, p.page, vr.bytes);
        if (vr.removed > 0 && vr.partial === 0) vectorDone = true;
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
    return vectorDone;
  } catch (e) {
    console.warn('deep content pass skipped:', e);
    return false;
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

export async function buildPdf({ doc, meta, range, formValues, flattenForms, stamps, proxies }: ExportInput): Promise<{ bytes: Uint8Array; pages: number }> {
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

  for (const p of pagesToExport) {
    let outPage: PDFPage;
    let pageAnns = annsByPage.get(p.id) ?? [];
    let raster: RasterResult | null = null;
    if (p.src) {
      const lib = libBySource.get(p.src);
      if (!lib || p.page === null || p.page >= lib.getPageCount()) continue;
      const intrinsic = doc.sources.find((s) => s.id === p.src)?.pages[p.page]?.rot ?? 0;
      const total = ((intrinsic + p.rot) % 360 + 360) % 360;
      // Deep pass FIRST: delete covered text operators / edited lines from
      // the source lib so the copied page (vector, flip or raster) carries
      // the removal. Returns true when rasterization can be skipped.
      const vectorRedactDone = await applyDeepContentPass(lib, p, pageAnns);
      // TRUE redaction: pages still carrying unremovable redact coverage are
      // REPLACED by a raster with the boxes burned into the pixels — the
      // original content stream is discarded entirely.
      raster = vectorRedactDone ? null : await maybeRasterForRedaction(p, pageAnns, proxies, total);
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
      burnRedactions(outPage, redactRectsFor(pageAnns));
    }
    for (const a of pageAnns) {
      await drawAnn(outPage, a, fonts, embedCache, out);
    }
    if (stamps) {
      const displayNum = pagesToExport.indexOf(p) + 1;
      drawStamps(outPage, fonts.normal, stamps, displayNum, pagesToExport.length, meta.title.trim() || doc.name);
    }
  }

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

  const bytes = await out.save({ useObjectStreams: true });
  return { bytes, pages: pagesToExport.length };
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
