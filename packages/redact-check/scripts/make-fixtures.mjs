/**
 * Build the two demo documents in public/fixtures/.
 *
 *  fake-redaction.pdf — text is drawn, then a black rectangle is painted over
 *                        it. The classic fake redaction: invisible on screen,
 *                        fully present in the content stream.
 *  real-redaction.pdf — the same layout with the sensitive text simply absent.
 *                        The box covers nothing.
 *
 * Deterministic output (no timestamps) so re-running produces identical bytes.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'public', 'fixtures');
mkdirSync(outDir, { recursive: true });

const BLACK = rgb(0, 0, 0);
const INK = rgb(0.1, 0.1, 0.12);
const MUTED = rgb(0.45, 0.47, 0.52);

async function build({ reveal }) {
  const doc = await PDFDocument.create();
  doc.setTitle(reveal ? 'Sample — fake redaction' : 'Sample — real redaction');
  doc.setProducer('pdfstudio redact-check fixtures');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const pages = [
    { name: 'Patient intake', secret: 'Patient: Jane Doe   SSN 123-45-6789', label: 'Patient record' },
    { name: 'Wire instructions', secret: 'IBAN GB29 NWBK 6016 1331 9268 19', label: 'Banking details' },
  ];

  for (const spec of pages) {
    const page = doc.addPage([612, 792]);
    page.drawText('NORTHWIND CLINIC', { x: 72, y: 720, size: 16, font: bold, color: INK });
    page.drawText(spec.name, { x: 72, y: 698, size: 10, font, color: MUTED });
    page.drawLine({
      start: { x: 72, y: 686 },
      end: { x: 540, y: 686 },
      thickness: 0.7,
      color: rgb(0.8, 0.82, 0.86),
    });

    page.drawText('Reference', { x: 72, y: 640, size: 10, font, color: MUTED });
    page.drawText('NW-2026-0042', { x: 180, y: 640, size: 11, font, color: INK });

    page.drawText(spec.label, { x: 72, y: 610, size: 10, font, color: MUTED });
    if (reveal) {
      // The "redacted" line: still in the file, just painted over below.
      page.drawText(spec.secret, { x: 180, y: 610, size: 11, font, color: INK });
    }
    // The black bar. In the fake document it sits on top of live text; in the
    // real one it covers blank space because the text was never written.
    page.drawRectangle({ x: 176, y: 602, width: 330, height: 20, color: BLACK });

    page.drawText('Everything above is fictional sample data.', {
      x: 72,
      y: 100,
      size: 9,
      font,
      color: MUTED,
    });
  }

  return doc.save();
}

const fake = await build({ reveal: true });
const real = await build({ reveal: false });
writeFileSync(join(outDir, 'fake-redaction.pdf'), fake);
writeFileSync(join(outDir, 'real-redaction.pdf'), real);
console.log(`wrote ${outDir}/fake-redaction.pdf (${fake.length} bytes)`);
console.log(`wrote ${outDir}/real-redaction.pdf (${real.length} bytes)`);
