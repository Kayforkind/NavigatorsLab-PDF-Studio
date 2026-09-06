import { PDFDocument, PDFFont, PDFPage, rgb, StandardFonts } from 'pdf-lib';

const W = 612;
const H = 792;
const M = 52;

const DARK = rgb(0.09, 0.1, 0.13);
const GRAY = rgb(0.42, 0.45, 0.5);
const ACCENT = rgb(0.30, 0.35, 0.95);
const SOFT = rgb(0.96, 0.97, 1);

let font: PDFFont;
let bold: PDFFont;

function line(page: PDFPage, text: string, y: number, size = 11, color = DARK, f = font) {
  page.drawText(text, { x: M, y, size, font: f, color });
  return y - size * 1.45;
}

function right(page: PDFPage, text: string, xRight: number, y: number, size = 11, color = DARK, f = font) {
  page.drawText(text, { x: xRight - f.widthOfTextAtSize(text, size), y, size, font: f, color });
}

export async function makeSamplePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  font = await doc.embedFont(StandardFonts.Helvetica);
  bold = await doc.embedFont(StandardFonts.HelveticaBold);

  doc.setTitle('PDF Studio — Demo Document');
  doc.setAuthor('PDF Studio');
  doc.setSubject('Feature tour');
  doc.setKeywords(['demo', 'pdf', 'editor']);

  /* ---------------- Page 1: cover ---------------- */
  const p1 = doc.addPage([W, H]);
  p1.drawRectangle({ x: 0, y: H - 190, width: W, height: 190, color: rgb(0.09, 0.1, 0.14) });
  p1.drawRectangle({ x: 0, y: H - 194, width: W, height: 4, color: ACCENT });
  p1.drawText('PDF STUDIO', { x: M, y: H - 96, size: 34, font: bold, color: rgb(1, 1, 1) });
  p1.drawText('Free forever. Private by design. Everything stays on your device.', {
    x: M,
    y: H - 130,
    size: 14,
    font,
    color: rgb(0.75, 0.78, 0.9),
  });
  p1.drawText('What this demo document exercises:', { x: M, y: H - 246, size: 13, font: bold, color: DARK });
  let y = H - 272;
  for (const s of [
    '•  Edit existing text — switch to the "Edit text" tool and click any paragraph below.',
    '•  Annotate — highlight clauses, underline, strike through, draw, type, stick notes.',
    '•  Sign & redact — draw a signature, paste a logo, black out or white out anything.',
    '•  Organize — rotate pages, drag thumbnails to reorder, delete, duplicate, insert blanks.',
    '•  Merge & split — drop a second PDF onto the canvas or export a page range.',
    '•  Privacy — export is generated locally; no upload, no account, no watermark, no limits.',
  ]) {
    y = line(p1, s, y, 12);
  }
  p1.drawText('Tip: use the tools on the left rail. Undo/redo (Ctrl+Z / Ctrl+Y) cover everything.', {
    x: M,
    y: 84,
    size: 11,
    font: font,
    color: GRAY,
  });
  p1.drawText('PDF Studio · demo file, generated in your browser', { x: M, y: 44, size: 9, font, color: GRAY });

  /* ---------------- Page 2: agreement (editable paragraphs) ---------------- */
  const p2 = doc.addPage([W, H]);
  p2.drawText('INDEPENDENT CONTRACTOR AGREEMENT', { x: M, y: H - 74, size: 17, font: bold, color: DARK });
  p2.drawLine({ start: { x: M, y: H - 86 }, end: { x: W - M, y: H - 86 }, thickness: 1, color: ACCENT });
  let yy = H - 116;
  const paras: Array<[string, number]> = [
    ['1.  Services. The Contractor shall perform the services described in Exhibit A with professional skill and care, and in accordance with the schedule and milestones set out therein.', 12],
    ['2.  Fees. In consideration of the Services, the Company shall pay the Contractor a fixed fee of USD 4,800, payable in two equal installments of USD 2,400.', 12],
    ['2.1  The first installment is due within fifteen (15) days after signature of this Agreement.', 11],
    ['2.2  The second installment is due upon final acceptance of the deliverables described in Exhibit A.', 11],
    ['3.  Intellectual Property. All work product created under this Agreement shall be owned by the Company, and the Contractor hereby assigns all right, title and interest in and to such work product.', 12],
    ['4.  Confidentiality. The Contractor agrees to keep confidential all non-public information received from the Company during the term, including pricing, customers and trade secrets.', 12],
    ['5.  Term and Termination. This Agreement begins on the Effective Date and continues until the Services are completed, unless earlier terminated in writing by either party.', 12],
  ];
  for (const [t, s] of paras) {
    yy = line(p2, t, yy, s);
    yy -= 6;
  }
  yy -= 12;
  p2.drawText('IN WITNESS WHEREOF, the parties have executed this Agreement as of the Effective Date.', {
    x: M,
    y: yy,
    size: 11,
    font,
    color: DARK,
  });
  yy -= 26;
  p2.drawText('Company: __________________________________', { x: M, y: yy, size: 11, font, color: DARK });
  yy -= 18;
  p2.drawText('Contractor: _______________________________', { x: M, y: yy, size: 11, font, color: DARK });
  yy -= 30;
  p2.drawText('Effective Date: ___________________________', { x: M, y: yy, size: 11, font, color: DARK });
  p2.drawText('(Edit this page with the "Edit text" tool: click any line, retype, and it is rewritten in the exported PDF.)', {
    x: M,
    y: 44,
    size: 9,
    font,
    color: GRAY,
  });

  /* ---------------- Page 3: invoice with table ---------------- */
  const p3 = doc.addPage([W, H]);
  const cols = { item: M, qty: 410, price: 480, total: W - M };
  p3.drawText('INVOICE #2026-0142', { x: M, y: H - 74, size: 17, font: bold, color: DARK });
  p3.drawText('Bill to:  Northwind Traders, 15 Harbor Avenue, Seattle, WA', { x: M, y: H - 96, size: 11, font, color: DARK });
  p3.drawText('Issued:  April 12, 2026     Due:  May 12, 2026', { x: M, y: H - 112, size: 11, font, color: DARK });
  const ty = H - 152;
  p3.drawRectangle({ x: M, y: ty - 8, width: W - 2 * M, height: 26, color: SOFT });
  p3.drawText('DESCRIPTION', { x: cols.item, y: ty, size: 10, font: bold, color: ACCENT });
  p3.drawText('QTY', { x: cols.qty - 30, y: ty, size: 10, font: bold, color: ACCENT });
  p3.drawText('RATE', { x: cols.price - 40, y: ty, size: 10, font: bold, color: ACCENT });
  right(p3, 'AMOUNT', cols.total, ty, 10, ACCENT, bold);
  const rows: Array<[string, number, number, number]> = [
    ['Design system & component library', 1, 3200, 3200],
    ['User research sessions', 6, 120, 720],
    ['Prototype in Figma', 2, 90, 180],
    ['Usability testing report', 1, 240, 240],
  ];
  let ry = ty - 30;
  p3.drawLine({ start: { x: M, y: ry + 14 }, end: { x: W - M, y: ry + 14 }, thickness: 1, color: rgb(0.82, 0.84, 0.9) });
  for (const [item, qty, rate, total] of rows) {
    p3.drawText(item, { x: cols.item, y: ry, size: 11, font, color: DARK });
    p3.drawText(String(qty), { x: cols.qty - 30 + 30 - font.widthOfTextAtSize(String(qty), 11), y: ry, size: 11, font, color: DARK });
    right(p3, rate.toLocaleString('en-US', { style: 'currency', currency: 'USD' }), cols.price, ry, 11);
    right(p3, total.toLocaleString('en-US', { style: 'currency', currency: 'USD' }), cols.total, ry, 11);
    ry -= 24;
  }
  p3.drawLine({ start: { x: M, y: ry + 6 }, end: { x: W - M, y: ry + 6 }, thickness: 1.2, color: DARK });
  right(p3, 'SUBTOTAL', cols.total, ry - 8, 11, DARK, bold);
  right(p3, '$4,340.00', cols.total - 0, ry - 26, 11, DARK, bold);
  right(p3, 'TAX (7.5%)', cols.total, ry - 26, 11, DARK, bold);
  ry -= 50;
  right(p3, '$325.50', cols.total, ry - 0, 11, DARK, bold);
  p3.drawLine({ start: { x: M, y: ry - 12 }, end: { x: W - M, y: ry - 12 }, thickness: 2, color: ACCENT });
  right(p3, 'TOTAL DUE', cols.total, ry - 28, 13, DARK, bold);
  right(p3, '$4,665.50', cols.total, ry - 48, 13, ACCENT, bold);
  p3.drawText('Payment via bank transfer to account 62-1100-4490 or card on file.', { x: M, y: 96, size: 10, font, color: GRAY });
  p3.drawText('Thank you for your business!', { x: M, y: 72, size: 11, font: bold, color: DARK });

  /* ---------------- Page 4: checklist / form ---------------- */
  const p4 = doc.addPage([W, H]);
  p4.drawText('ONBOARDING CHECKLIST — NEW SUPPLIER', { x: M, y: H - 74, size: 15, font: bold, color: DARK });
  p4.drawRectangle({ x: 0, y: H - 80, width: W, height: 2, color: SOFT });
  const items = [
    'W-9 / VAT registration form collected',
    'Bank account details verified (IBAN check)',
    'Insurance certificates (liability, min. $1M)',
    'Data processing agreement signed',
    'Security questionnaire completed',
    'Primary & backup contacts provided',
    'Vendor code assigned in procurement system',
    'Terms accepted in the supplier portal',
  ];
  let cy = H - 118;
  for (const it of items) {
    p4.drawRectangle({ x: M, y: cy - 1, width: 13, height: 13, borderColor: GRAY, borderWidth: 1.2 });
    p4.drawText(it, { x: M + 24, y: cy, size: 11.5, font, color: DARK });
    cy -= 33;
  }
  cy -= 14;
  p4.drawText('Reviewed by: ____________________    Date: ____________', { x: M, y: cy, size: 11, font, color: DARK });
  cy -= 40;
  p4.drawText('Notes:', { x: M, y: cy, size: 11, font: bold, color: DARK });
  p4.drawRectangle({ x: M, y: cy - 120, width: W - 2 * M, height: 130, borderColor: rgb(0.8, 0.82, 0.88), borderWidth: 1 });
  p4.drawText('Try the highlighter on the page 2 contract, the pen on this checklist, and a signature next to "Reviewed by".', {
    x: M,
    y: 44,
    size: 9,
    font,
    color: GRAY,
  });

  return doc.save();
}
