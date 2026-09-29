# How it works

PDF Studio is a PDF editor that runs entirely in your browser. There is no
server: your file is opened, edited, and saved on your own device. This page
explains what happens at each step — including redaction, which works
differently from what the screen suggests.

## The short version

1. **Open** — the PDF is loaded into memory in your browser. Nothing is
   uploaded anywhere.
2. **Edit** — the Edit tool rewrites the page's content stream itself. The
   original text is deleted from the file and your replacement is written in
   as real vector text. Not an overlay. Not a text box on top.
3. **Fill & sign** — form values are written into the real AcroForm fields;
   signatures are drawn onto the page.
4. **OCR** — scanned pages get a text layer from on-device Tesseract, so they
   become searchable and editable.
5. **Redact** — you draw boxes over what must disappear. In the editor these
   are **marked for redaction**: a promise, not a removal. Nothing is deleted
   yet.
6. **Export** — the file is rebuilt from scratch. This is where redaction
   actually destroys content (see below), edits are written into the content
   streams, forms are flattened, and everything is verified before the file
   is handed to you.

Every step — including redaction, OCR, and the AI assistant — happens on
your device. If the network cable were unplugged after the page loaded, the
whole editor would keep working.

## Redaction: marked, then destroyed

This is the part people get wrong, so here it is plainly:

**Drawing a redaction box does not remove anything.** The hatched box in the
editor means "this region is marked for redaction when the file is exported."
The destruction happens at export — deliberately, because only then can the
tool rebuild the file and prove the content is gone.

### What export does with your redaction boxes

1. **Records what must disappear.** The text sitting under each box is
   captured before anything is touched. These strings become the checklist
   the finished file is tested against.
2. **Clears hidden copies first.** Form field values under the boxes are
   wiped, source-document annotations under the boxes are dropped, and the
   accessibility structure tree (`/Alt`, `/ActualText`, `/E`) is sanitized —
   because redacted text can survive in any of these places even after the
   visible text is gone.
3. **Deletes covered text from the content stream.** Every text-drawing
   operator fully covered by a box is removed from the page's content stream,
   recursively through nested Form XObjects. Pages that share resources are
   never affected — the redacted objects are cloned before editing. Vector
   fills and strokes under the boxes are removed too. Everything else on the
   page stays as vector text: selectable, searchable, print-crisp.
4. **Burns what can't be proven removable.** If any text is only *partially*
   covered, or the page contains images, exotic fonts, or vector effects the
   tool can't fully analyze, the page is rendered to pixels with the boxes
   burned in — and the original content stream is discarded entirely. A
   half-removed word is treated as not removed at all.
5. **Scrubs the file's metadata.** The document info dictionary, XMP metadata,
   embedded files, JavaScript (open actions, additional actions), and page
   thumbnails are all removed from redacted exports.
6. **Verifies before delivering.** The finished file is scanned for every
   covered string across multiple encodings (UTF-8, UTF-16 with and without
   byte-order marks, Latin-1, hex forms). If *anything* redacted is still
   recoverable, **no file is delivered** — export fails with an error instead
   of handing you a file that leaks.

After export, the app shows a verification report: how many regions were
redacted, how many strings were checked, how many were recoverable (zero, or
the export would have failed).

### What the tool refuses to do

- **It will not ship a file where covered text survives.** Verification
  failure is a hard error, not a warning.
- **It will not silently downgrade to a visual cover-up.** If neither the
  vector removal nor the pixel-burn path can complete, export throws an
  error instead of delivering a file that only *looks* redacted.
- **Whiteout is not redaction.** The whiteout tool covers content with a
  page-colored box for cosmetic cleanup. The content stays in the file. Use
  redaction for sensitive data.

### Honest limits

- Redaction requires export. If you close the tab without exporting, the
  marked boxes were never applied.
- The tool can't redact what it can't verify. A scanned page with no text
  layer takes the pixel-burn path automatically — the whole page becomes an
  image, which is secure but no longer has selectable text.
- This guarantee covers the file PDF Studio writes. It can't reach copies
  you already sent somewhere else.

## Editing, forms, and export

**Text editing** works like redaction's gentler sibling: the tool finds the
text-drawing operators for the line you clicked, deletes the originals, and
writes your replacement as real vector text in the content stream. Table
cells are edited independently. Replacement text uses Helvetica metrics, so
on exotic embedded fonts the match is near-identical rather than
glyph-perfect.

**Forms** write values into the real AcroForm fields. At export you can
flatten them — the values are burned into the page content and the fields
themselves are removed, so nobody can change your answers afterward.

**Export** rebuilds the PDF from your working document: page order, rotation,
and flips applied; annotations drawn as vector content; page numbers,
watermarks, and headers/footers stamped; optional page ranges or splits. The
file you download is generated fresh — it is not your original file with
things layered on top.

## Diff, OCR, and AI

**Revision diff** compares two PDFs line by line and shows what changed —
useful for contracts and proposals.

**OCR** runs Tesseract on your device (English, Spanish, French, German). A
scanned page gets a real text layer, which makes it searchable, editable,
and redactable.

**On-device AI** runs a small language model (0.5B–1B parameters) in your
browser via WebAssembly. It summarizes the document and answers questions
about it. Your document never leaves the device; the model is small, so it
won't match a frontier model — but it never phones home.

## Automation: CLI and MCP

The same engine ships as a command-line tool (`pdfstudio`) and an MCP server
(`pdfstudio-mcp`), so scripts and AI agents can edit, redact, OCR, and
convert PDFs with identical guarantees. Redaction through the CLI/MCP
produces a machine-readable verification report (regions, strings checked,
recoverable) and refuses the same way the web app does: a failed
verification means no output file.

See [CLI reference](/guide/cli) and [MCP server](/guide/mcp).
