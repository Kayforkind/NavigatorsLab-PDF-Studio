# NavigatorsLab PDF Studio — Feature Walkthroughs

Hands-on guides for every feature, with the exact steps to reproduce each result.
All examples work in the [live app](https://kayforkind.github.io/pdf-studio/) or a local build
(`npm install && npm run dev`) — everything happens in *your* browser, no file ever leaves the device.

---

## 1 · Edit text that's already in the PDF

The flagship feature. Most "editors" only add text on top; PDF Studio rewrites the original text in place.

1. Open any digital PDF (one with selectable text — not a scan).
2. Pick the **Edit text** tool in the left rail.
3. Hover the page: every line of the original text glows with a clickable hint.
4. Click a line → retype it → press Enter or click away.

What happens under the hood: the app samples the page background around the line, paints that
rectangle over the old glyphs (so it blends invisibly even on textured scans), and stamps your
replacement text at the same baseline. On export it's burned into real vector content —
not a screenshot-style overlay.

> Scanned page with no text layer? Use **Edit text → OCR this page** (or the status-bar shortcut).
> Tesseract runs locally in WASM; each recognized line becomes an editable text box.

---

## 2 · Fix flipped / rotated content

Camera scans and broken generators sometimes store pages upside-down or mirrored.

- **Upside-down (90°/180°/270° rotation metadata):** on open, a banner offers
  **"Turn upright"** — one undoable bulk step.
- **Mirrored artwork:** each thumbnail has **Mirror page horizontally / vertically** buttons.
  The canvas mirrors instantly and the export mirrors the real page content while your marks
  stay put — verified by pixel-diffing the canvas against its own mirror.
- **Individual image/signature wrong way round:** select it → Inspector → Flip H / Flip V.

---

## 3 · Fill PDF forms (AcroForm)

1. Open a fillable PDF and press **Forms** in the top bar.
2. Every field is listed — text, checkboxes, radio groups, dropdowns — with a jump-to-page button.
3. Type values right in the dialog.
4. Toggle **"Show fields on pages"**: the widgets are drawn on the page itself; clicking one
   scrolls the dialog to it and focuses that field.
5. On **Save PDF**, values are written into the real form fields. Choose **Flatten** to burn them
   into page content so nobody can change them.

> The pipeline flattens each source file *before* copying pages, because pdf-lib's `copyPages`
> silently drops the AcroForm — a real bug this project caught and documented.

---

## 4 · Stamp page numbers, watermarks, headers & footers

In the **Export** dialog:

- **Page numbers** — position, format (`1`, `Page 1`, `1 / N`), first number, skip-cover toggle.
- **Watermark** — diagonal text with size/opacity/color (e.g. `CONFIDENTIAL`).
- **Header/footer** — tokens `{page}`, `{pages}`, `{date}`, `{title}`.

All stamps render during export at true PDF coordinates, so they're crisp at any zoom.

---

## 5 · Compare two PDFs

1. Press **Compare** in the top bar.
2. Drop a second file (or pick the same one edited in another tab).
3. The dialog diffs the extracted text line-by-line (LCS): **green = added**, **red = removed**,
   with per-page counts.

Great for contract revisions: "did the payment terms change between v1 and v2?"

---

## 6 · Organize pages

- **Reorder** by dragging thumbnails.
- **Rotate** (honors intrinsic `/Rotate`), **duplicate**, **delete**, **insert blanks**
  — per page or in bulk.
- **Merge** another PDF after the current page, or drop a file straight onto the canvas.
- **Split/extract** any range (`1-3,5`) or export one file per page.

---

## 7 · Search the whole document

Type in the top-bar search box: matches are highlighted on every page;
**Enter / Shift+Enter** cycles through them with a live `n / total` counter.

---

## 8 · Ask AI about the document — privately

The **✦ AI assistant** runs a small LLM (Qwen2.5 0.5B / Llama 3.2 1B) fully in your browser
via WebLLM/WebAssembly. Ask questions or summarize; the PDF itself never leaves the device.
Model weights download once (~0.6 GB) and are cached. **Extract text** works with no download at all.

---

## 9 · OCR a scanned page into editable text

Edit-text tool → **OCR this page**. Each recognized line becomes a real text annotation whose
background is sampled from the page, so exported output is clean vector text over the original scan.
Needs a one-time ~15 MB language-data download, cached afterwards.

---

## 10 · Session restore

Everything (files, page ops, marks, form values) autosaves to on-device storage. After a refresh
or crash, the start screen offers **Resume session** — pick up exactly where you left off.

---

## For developers

```bash
npm install
npm run dev        # http://localhost:5199
npm test           # 24 unit tests (doc model, viewport parity, export, diff)
npm run typecheck
npm run build      # → dist/ (PWA service worker included)
```

Geometry invariant: **all marks live in the page's PDF user space**; the overlay and the exporter
share the same CropBox-aware transform math (`src/lib/viewport.ts`), which is pinned against
pdf.js's own `PageViewport` in tests — including offset MediaBox/CropBox origins that break
most home-grown editors.
