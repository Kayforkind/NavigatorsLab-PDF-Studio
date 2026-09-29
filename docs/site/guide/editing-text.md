# Editing text

The flagship feature. Most free PDF editors only stamp new text *on top* of the
page; PDF Studio **rewrites the original at the content-stream level** — the old
glyphs' show-text operators are deleted from the file itself.

## Edit a line

1. Open a digital PDF (one with selectable text — not a flat scan).
2. Pick the **Edit text** tool (`E`) in the left rail.
3. Every line of the original text glows as a clickable target — and **table
   rows light up per cell**, so an invoice's Reference / Recipient / Amount
   columns are independent targets.
4. Click a line (or one cell), retype it, press `Enter`.

On export, PDF Studio splices the page's content stream: the original text
operators are **removed from the file** and your replacement is written in as
real vector text at the same position and size, with kerning that reproduces
the original column spacing — searchable, selectable, and print-crisp.

> **Want proof?** Export a file after an edit and search the bytes for any word
> of the original line — it is not there.

## How it works

The app runs the page's content stream through a tokenizer. Your replacement is
written back with TJ kerning operators that reproduce the original spacing, so
columns stay aligned and the text stays crisp at any zoom.

**Honest limits:**

- Editing needs a **text layer**. Flat scans go through the [OCR tool](/guide/ocr) first.
- Replacement text uses **Helvetica metrics** — near-identical, not glyph-perfect,
  on exotic embedded fonts.
- Lines set in exotic subset/CID fonts (whose glyph ids can't be safely
  re-encoded) fall back to a page-sampled cover instead of a true rewrite —
  everything else is rewritten in place.

## Automate it

The same engine powers the CLI and MCP tools:

```bash
pdfstudio edit-text in.pdf --find "Acme Corp" --replace "Globex Inc" --all -o out.pdf
```

See [CLI reference](/guide/cli) and [`pdf_edit_text`](/guide/mcp).
