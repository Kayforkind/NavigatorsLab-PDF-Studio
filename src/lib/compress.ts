import { getDocument } from 'pdfjs-dist';
import { PDFDocument } from 'pdf-lib';
import { pdfjsLoadOptions } from './pdfio';

export interface CompressOptions {
  /** longest page side in pixels of the rasterized output */
  maxSide: number;
  /** JPEG quality 0..1 */
  quality: number;
}

export const COMPRESS_PRESETS: Record<string, { label: string; opts: CompressOptions }> = {
  high: { label: 'High quality (≈2000px, q85)', opts: { maxSide: 2000, quality: 0.85 } },
  medium: { label: 'Medium (≈1500px, q70)', opts: { maxSide: 1500, quality: 0.7 } },
  low: { label: 'Smallest (≈1000px, q55)', opts: { maxSide: 1000, quality: 0.55 } },
};

export function clampCompress(o: { maxSide: number; quality: number }): CompressOptions {
  return {
    maxSide: Math.min(4000, Math.max(400, Math.round(o.maxSide) || 1500)),
    quality: Math.min(0.95, Math.max(0.3, o.quality || 0.7)),
  };
}

/**
 * Reduces a PDF's file size by rasterizing every page to JPEG and rebuilding
 * the document. Honest trade-off, stated in the UI: pages become images, so
 * text is no longer selectable/searchable. All annotations and stamps must
 * already be burned in — call this on the bytes buildPdf produces.
 */
export async function compressPdfBytes(
  bytes: Uint8Array,
  rawOpts: { maxSide: number; quality: number },
  onProgress?: (done: number, total: number) => void,
): Promise<{ bytes: Uint8Array; ratio: number; pages: number }> {
  const opts = clampCompress(rawOpts);
  const js = await getDocument(pdfjsLoadOptions(new Uint8Array(bytes))).promise;
  const out = await PDFDocument.create();
  const n = js.numPages;
  for (let i = 1; i <= n; i++) {
    const page = await js.getPage(i);
    const probe = page.getViewport({ scale: 1 });
    const longest = Math.max(probe.width, probe.height) || 1;
    const scale = Math.min(3, opts.maxSide / longest);
    const vp = page.getViewport({ scale });
    const w = Math.max(1, Math.floor(vp.width));
    const h = Math.max(1, Math.floor(vp.height));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not rasterize page for compression.');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const dataUrl = canvas.toDataURL('image/jpeg', opts.quality);
    const bin = atob(dataUrl.split(',')[1] ?? '');
    const jpg = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) jpg[k] = bin.charCodeAt(k);
    const img = await out.embedJpg(jpg);
    const pg = out.addPage([w, h]);
    pg.drawImage(img, { x: 0, y: 0, width: w, height: h });
    onProgress?.(i, n);
  }
  try {
    await js.destroy();
  } catch {
    /* ignore */
  }
  const outBytes = await out.save({ useObjectStreams: true });
  return { bytes: outBytes, ratio: outBytes.length / Math.max(1, bytes.length), pages: n };
}
