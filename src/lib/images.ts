import { PDFDocument } from 'pdf-lib';
import type { PDFDocumentProxy } from 'pdfjs-dist';

/** longest page side (px) when building a PDF from images */
const MAX_SIDE = 2000;

/**
 * Builds a real PDF from image files — one full-bleed page per image.
 * JPEG/PNG are embedded natively; anything else (webp, avif, …) is
 * rasterized through a canvas to PNG first. Fully local.
 */
export async function imagesToPdf(files: File[]): Promise<{ bytes: Uint8Array; pages: number }> {
  const imgs = files.filter((f) => f.type.startsWith('image/'));
  if (!imgs.length) throw new Error('Pick image files (PNG, JPG, WebP…).');
  const out = await PDFDocument.create();
  for (const f of imgs) {
    const buf = new Uint8Array(await f.arrayBuffer());
    const bmp = await createImageBitmap(new Blob([buf as BlobPart], { type: f.type }));
    try {
      const scale = Math.min(1, MAX_SIDE / Math.max(1, Math.max(bmp.width, bmp.height)));
      const w = Math.max(1, Math.round(bmp.width * scale));
      const h = Math.max(1, Math.round(bmp.height * scale));
      let embedded;
      if (f.type === 'image/jpeg') {
        embedded = await out.embedJpg(buf);
      } else if (f.type === 'image/png') {
        embedded = await out.embedPng(buf);
      } else {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d');
        if (!ctx) throw new Error('Could not decode image.');
        ctx.drawImage(bmp, 0, 0, w, h);
        const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'));
        if (!blob) throw new Error('Could not decode image.');
        embedded = await out.embedPng(new Uint8Array(await blob.arrayBuffer()));
      }
      const page = out.addPage([w, h]);
      page.drawImage(embedded, { x: 0, y: 0, width: w, height: h });
    } finally {
      bmp.close();
    }
  }
  return { bytes: await out.save({ useObjectStreams: true }), pages: imgs.length };
}

/**
 * Renders one PDF page to a PNG blob (2x-ish, capped at 2000px on the long
 * side). Used for "download page as PNG".
 */
export async function pageToPng(
  proxy: PDFDocumentProxy,
  pageIndex: number,
  rotation = 0,
): Promise<Blob> {
  const page = await proxy.getPage(pageIndex + 1);
  const probe = page.getViewport({ scale: 1, rotation });
  const scale = Math.min(3, MAX_SIDE / Math.max(1, Math.max(probe.width, probe.height)));
  const vp = page.getViewport({ scale, rotation });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(vp.width));
  canvas.height = Math.max(1, Math.floor(vp.height));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not render page.');
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
  if (!blob) throw new Error('Could not encode PNG.');
  return blob;
}
