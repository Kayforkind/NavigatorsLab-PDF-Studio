/* Mirror-export ground truth check (cross-document embed — matches exporter).
 * Run: node scripts/mirror-check.cjs
 */
const { PDFDocument, PDFOperator, PDFOperatorNames, PDFNumber } = require('pdf-lib');
const { getDocument } = require('pdfjs-dist/legacy/build/pdf.mjs');

async function main() {
  const src = await PDFDocument.load(require('fs').readFileSync('dev-assets/h-cropbox.pdf'));
  const out = await PDFDocument.create();
  const embedded = await out.embedPage(src.getPage(0));
  const w = embedded.width;
  const h = embedded.height;
  const page = out.addPage([w, h]);
  const xobj = page.node.newXObject('StudioMirror', embedded.ref);
  page.pushOperators(
    PDFOperator.of(PDFOperatorNames.PushGraphicsState),
    PDFOperator.of(PDFOperatorNames.ConcatTransformationMatrix, [
      PDFNumber.of(-1),
      PDFNumber.of(0),
      PDFNumber.of(0),
      PDFNumber.of(1),
      PDFNumber.of(w),
      PDFNumber.of(0),
    ]),
    PDFOperator.of(PDFOperatorNames.DrawObject, [xobj]),
    PDFOperator.of(PDFOperatorNames.PopGraphicsState),
  );
  const bytes = await out.save();

  const doc = await getDocument({ data: new Uint8Array(bytes) }).promise;
  try {
    const pg = await doc.getPage(1);
    const tc = await pg.getTextContent();
    const items = tc.items.filter((i) => i.str.trim());
    for (const it of items.slice(0, 5)) {
      console.log(JSON.stringify(it.str.slice(0, 16)), 'at x =', Math.round(it.transform[4]));
    }
    const vw = pg.getViewport({ scale: 1 }).width;
    const banner = items.find((i) => i.str.startsWith('TOP-LEFT-L'));
    console.log(banner && banner.transform[4] > vw / 2 ? 'PASS: banner mirrored to right half' : 'FAIL: banner not mirrored');
  } finally {
    await doc.destroy();
    process.exit(0);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
