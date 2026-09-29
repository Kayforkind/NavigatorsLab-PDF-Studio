const { PDFDocument, StandardFonts, rgb } = require('/home/hatch/workspace/pdfstudio/node_modules/pdf-lib');
const fs = require('fs');

async function formsPdf() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  page.drawText('Vendor onboarding', { x: 72, y: 730, size: 22, font: bold });
  page.drawText('Please complete all fields. This form is fillable in any PDF reader —', { x: 72, y: 700, size: 11, font });
  page.drawText('including PDF Studio, which detects every field automatically.', { x: 72, y: 684, size: 11, font });
  const form = pdf.getForm();
  const labels = [['Full name', 'full_name', 640], ['Company', 'company', 600], ['Email', 'email', 560], ['Phone', 'phone', 520]];
  for (const [label, name, y] of labels) {
    page.drawText(label, { x: 72, y: y + 4, size: 11, font });
    const tf = form.createTextField(name);
    tf.addToPage(page, { x: 180, y, width: 360, height: 22, borderWidth: 1, borderColor: rgb(0.6, 0.6, 0.65) });
  }
  page.drawText('Agreements', { x: 72, y: 470, size: 14, font: bold });
  const checks = [['nda', 'NDA signed'], ['insurance', 'Insurance certificates provided'], ['security', 'Security questionnaire completed']];
  checks.forEach(([name, label], i) => {
    const y = 440 - i * 30;
    const cb = form.createCheckBox(name);
    cb.addToPage(page, { x: 72, y, width: 16, height: 16, borderWidth: 1, borderColor: rgb(0.6, 0.6, 0.65) });
    page.drawText(label, { x: 98, y: y + 2, size: 11, font });
  });
  fs.writeFileSync('/home/hatch/workspace/pdfstudio/docs/shots/capture/form-demo.pdf', await pdf.save());
  console.log('form-demo.pdf written');
}

async function comparePdfs() {
  async function make(lines, path) {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([612, 792]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    page.drawText('Master Services Agreement', { x: 72, y: 740, size: 18, font: bold });
    let y = 700;
    for (const ln of lines) { page.drawText(ln, { x: 72, y, size: 11, font }); y -= 22; }
    fs.writeFileSync(path, await pdf.save());
  }
  const base = [
    '1. Term. This agreement begins on January 1, 2026 and runs for twelve (12) months.',
    '2. Fees. Client pays $4,500 per month, invoiced quarterly in arrears.',
    '3. Support. Email support with a 48-hour response time is included.',
    '4. Termination. Either party may terminate with 30 days written notice.',
    '5. Confidentiality. Both parties keep shared materials strictly confidential.',
  ];
  const changed = [
    '1. Term. This agreement begins on January 1, 2026 and runs for twenty-four (24) months.',
    '2. Fees. Client pays $5,200 per month, invoiced quarterly in arrears.',
    '3. Support. Email support with a 48-hour response time is included.',
    '4. Termination. Either party may terminate with 60 days written notice.',
    '5. Confidentiality. Both parties keep shared materials strictly confidential.',
  ];
  await make(base, '/home/hatch/workspace/pdfstudio/docs/shots/capture/compare-a.pdf');
  await make(changed, '/home/hatch/workspace/pdfstudio/docs/shots/capture/compare-b.pdf');
  console.log('compare pdfs written');
}

(async () => { await formsPdf(); await comparePdfs(); })();
