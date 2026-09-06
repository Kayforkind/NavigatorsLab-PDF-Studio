/* Generates hostile test PDFs into public/ — run: node scripts/hostile.cjs */
const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb, degrees } = require('pdf-lib');

async function base() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  return { doc, font, bold };
}

function marker(page, font, bold) {
  // Big L in the TOP-LEFT of *user space* (y-up): a 100pt-wide banner at the top.
  page.drawRectangle({ x: 60, y: 700, width: 200, height: 60, color: rgb(0.1, 0.15, 0.6) });
  page.drawText('TOP-LEFT-L', { x: 70, y: 715, size: 28, font: bold, color: rgb(1, 1, 1) });
  // Crosshair at content point (300, 400) — the exact center of a Letter page.
  page.drawLine({ start: { x: 288, y: 400 }, end: { x: 312, y: 400 }, thickness: 2, color: rgb(1, 0, 0) });
  page.drawLine({ start: { x: 300, y: 388 }, end: { x: 300, y: 412 }, thickness: 2, color: rgb(1, 0, 0) });
  page.drawText('C300,400', { x: 316, y: 396, size: 10, font, color: rgb(1, 0, 0) });
  page.drawText('BOTTOM-RIGHT-R', { x: 380, y: 60, size: 20, font: bold, color: rgb(0.6, 0.1, 0.1) });
}

async function main() {
  const out = path.join(__dirname, '..', 'public');
  fs.mkdirSync(out, { recursive: true });

  // 1. CropBox strictly smaller than MediaBox, offset from origin.
  {
    const { doc, font, bold } = await base();
    const p = doc.addPage([612, 792]);
    marker(p, font, bold);
    p.setCropBox(72, 72, 468, 648); // x0=72 y0=72 → crop 468x648
    fs.writeFileSync(path.join(out, 'h-cropbox.pdf'), await doc.save());
  }
  // 2. Non-zero MediaBox origin.
  {
    const { doc, font, bold } = await base();
    const p = doc.addPage([612, 792]);
    marker(p, font, bold);
    p.setMediaBox(100, 50, 512, 742);
    fs.writeFileSync(path.join(out, 'h-origin.pdf'), await doc.save());
  }
  // 3. Intrinsic /Rotate 180 with upright markers.
  {
    const { doc, font, bold } = await base();
    const p = doc.addPage([612, 792]);
    marker(p, font, bold);
    p.setRotation(degrees(180));
    fs.writeFileSync(path.join(out, 'h-rot180.pdf'), await doc.save());
  }
  // 4. Intrinsic /Rotate 90.
  {
    const { doc, font, bold } = await base();
    const p = doc.addPage([612, 792]);
    marker(p, font, bold);
    p.setRotation(degrees(90));
    void 0;
    fs.writeFileSync(path.join(out, 'h-rot90.pdf'), await doc.save());
  }
  // 5. The killer combo: /Rotate 180 AND offset CropBox.
  {
    const { doc, font, bold } = await base();
    const p = doc.addPage([612, 792]);
    marker(p, font, bold);
    p.setRotation(degrees(180));
    p.setCropBox(36, 200, 540, 500);
    fs.writeFileSync(path.join(out, 'h-rot180-crop.pdf'), await doc.save());
  }
  console.log('hostile PDFs written to', out);
}
main().catch((e) => { console.error(e); process.exit(1); });
