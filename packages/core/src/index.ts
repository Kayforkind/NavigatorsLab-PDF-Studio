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

export { editText, redactRects, redactText, findTextRects, buildRedactReport } from './edit.js';
export type {
  Replacement,
  Skip,
  EditOptions,
  EditReport,
  RedactRect,
  RedactReport,
  RedactCliReport,
} from './edit.js';
export { verifyRedaction } from './redactVerify.js';
export type { RedactVerification, RedactStringCheck } from './redactVerify.js';
export {
  REFUSE_TYPE0_TYPE3,
  REFUSE_INLINE_IMAGES,
  REFUSE_PATTERNS,
  REFUSE_UNRECOGNIZED_TEXT,
  REFUSE_IMAGE_NESTED_FORM,
  REFUSE_IMAGE_PIXEL,
  REFUSE_FORM_RECURSION,
  REFUSE_NO_COVERAGE,
  SCRUBBED_ENTRIES,
} from './redactImages.js';
