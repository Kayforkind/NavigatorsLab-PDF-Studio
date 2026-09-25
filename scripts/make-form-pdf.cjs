/* Generates public/form-test.pdf — the small AcroForm used by review-e2e.cjs.
 * The fixture is generated rather than committed so it can never rot out of
 * sync with pdf-lib's own writer. Run: node scripts/make-form-pdf.cjs */
const fs = require('node:fs');
const path = require('node:path');
const { PDFDocument, StandardFonts } = require('pdf-lib');

(async () => {
  const out = path.resolve(__dirname, '..', 'public', 'form-test.pdf');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  page.drawText('PDF Studio — form test', { x: 60, y: 700, size: 18, font });
  page.drawText('Name:', { x: 60, y: 640, size: 12, font });
  page.drawText('Email:', { x: 60, y: 600, size: 12, font });
  const form = doc.getForm();
  const name = form.createTextField('name');
  name.addToPage(page, { x: 120, y: 632, width: 260, height: 22 });
  const email = form.createTextField('email');
  email.addToPage(page, { x: 120, y: 592, width: 260, height: 22 });
  fs.writeFileSync(out, await doc.save());
  console.log('wrote', out);
})();
