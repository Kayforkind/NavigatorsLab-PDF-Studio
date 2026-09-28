/**
 * pdfstudio-core — Node-safe PDF operations for PDF Studio's agentic interfaces.
 *
 * Reuses the app's real engines (src/lib/textRewrite.ts content-stream
 * rewriting + vector redaction, src/lib/ranges.ts range syntax) instead of
 * reimplementing PDF parsing. Everything here runs with zero network calls:
 * document bytes never leave the machine.
 */
export {
  MAX_INPUT_BYTES,
  assertPdfBytes,
  loadPdf,
  pdfInfo,
  mergePdfs,
  splitPdf,
  rotatePages,
  arrangePages,
} from './pdf.js';
export type { PageGeometry, PdfInfo, PageSelection } from './pdf.js';

export { extractText, searchText, groupItemsIntoLines } from './text.js';
export type { PageText, TextLine, SearchHit, SearchOptions, PdfJsTextItem } from './text.js';

export { editText, redactRects, redactText } from './edit.js';
export type {
  Replacement,
  Skip,
  EditOptions,
  EditReport,
  RedactRect,
  RedactReport,
} from './edit.js';
