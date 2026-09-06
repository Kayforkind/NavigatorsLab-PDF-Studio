# NavigatorsLab PDF Studio — a private, free, full-featured PDF editor

A complete, client-side PDF editor: **edit the text that's already inside a PDF**, annotate, sign, redact,
organize pages, merge and split, fill forms, **OCR scanned pages**, and **ask an on-device LLM about the document** —
100% in the browser. No account, no upload, no watermark, no page or task limits.

A [NavigatorsLab](https://navigatorslab.com) project · MIT licensed · **hands-on walkthroughs in [EXAMPLES.md](./EXAMPLES.md)**

```
npm install
npm run dev        # http://localhost:5199 → click "Open the demo document"
npm run typecheck
npm test           # unit + integration tests (24)
npm run build      # production build + PWA service worker in dist/
```

> Engine note: `pdfjs-dist` is pinned to the 4.x line (^4.10.38) because 5.x/6.x call native
> `Uint8Array.prototype.toHex()`/`toBase64()`, missing on older engines; 4.x ships guarded fallbacks.

## Market position (short version)

The PDF-editor software market is ~$4.8B (2025) and growing ~10–18% CAGR toward $11–25B by the mid-2030s;
AI-assisted document tools are its fastest-growing segment. Users' loudest recurring complaints about free tools:
paywalls at the save step, watermarks, per-hour/page/task caps, forced sign-up, and privacy fears around uploading
contracts and IDs. Free editors that truly modify existing text (e.g. PDFgear) are desktop-only. **PDF Studio's
wedge: the private, unlimited, cross-platform web editor with in-place text editing, OCR, and on-device AI.**

## Features

| Area | What works |
| --- | --- |
| Open / save | Drop or choose a PDF, or the built-in demo. Local download only. Offline-capable (PWA). |
| Edit existing text | Edit tool → hover hints show clickable lines → click, retype → original glyphs are painted over with a **sampled** page background and your text is stamped in place. |
| Annotate | Highlight, underline, strikethrough, sticky notes, freehand pen, text stamps. |
| Sign & images | Signature pad (transparent PNG, remembered per session); PNG/JPG/WebP stamps. |
| Redact / whiteout | Black-out boxes; whiteout samples the page background so it blends into scans. |
| Pages | Drag-reorder thumbnails, 90° rotate (honors the file's intrinsic /Rotate), duplicate, delete, blank pages; **one-click "turn upright" banner** when a file's pages carry camera rotation metadata. |
| **Fix flipped content** | Horizontal/vertical flip for any page (mirrors the artwork on canvas *and* on export while your marks stay put) plus per-annotation H/V flip for images & signatures — repairs generator-broken scans without leaving the app. |
| Merge / split | Merge after the current page (or drop onto the canvas); export any range or one file per page. |
| **Forms (AcroForm)** | Detects fillable fields (text, checkboxes, radio groups, dropdowns) with a fill dialog; **"show on pages"** draws every widget on the canvas — click one to jump & focus it in the dialog. Values are written into the real fields on Save, or **flattened** into page content so they can't be changed. |
| **Stamps** | Page numbers (position / format / first number / skip cover), diagonal watermark (size, opacity, color), header & footer lines — tokens `{page}` `{pages}` `{date}` `{title}`. |
| **Search** | Full-document, case-insensitive; highlighted matches with Enter / Shift+Enter navigation. |
| **Compare** | Diff two PDFs' extracted text side-by-side — additions highlighted green, removals red, per-page counts. |
| **Autosave** | The working session (pages, marks, form values) is stored on-device and offered as “Resume” on the start screen after a refresh or crash. |
| Model & undo | Full undo/redo (Ctrl/⌘Z · Ctrl/⌘Y) over page ops and every annotation. |
| **OCR scans** | Edit-text tool → "OCR this page": Tesseract runs **locally via WASM**, each recognized line becomes editable, replaceable text (background sampled from the page). Needs a one-time ~15 MB language-data download, cached afterwards. |
| **On-device AI** | ✦ button → ask or summarize the open document with WebLLM (Qwen2.5 0.5B / Llama 3.2 1B) running in WebAssembly. Model weights download once (~0.6–0.9 GB); the **document itself never leaves the device**. "Extract text" works fully offline. |
| Properties / export | Title/author/subject/keywords, page range extraction. |
| Privacy | Zero network calls with your data for viewing/editing/export. Model/OCR downloads are public weights cached by the browser. |

## Architecture

```
src/
  types.ts               domain model: sources, PageRec, Annotation (PDF-point content space)
  lib/docModel.ts        undoable reducer (pages + annotations, past/future stacks)
  lib/viewport.ts        pure port of pdf.js PageViewport math (rotation-aware css ⇄ content)
  lib/pdfio.ts           pdf.js load/render/text-extraction (pdf.js-coupled bits)
  lib/ranges.ts          page-range parsing ("1-3,5")
  lib/exportPdf.ts       pdf-lib exporter: page ops, /Rotate, flattened annotations, metadata
  lib/ocr.ts             local OCR (Tesseract WASM) → grouped lines
  lib/ai.ts              lazy WebLLM engine wrapper (graceful offline errors)
  lib/sample.ts          generates the demo document
  components/*           PageSheet (canvas+SVG overlay+interactions), Thumbs, ToolRail,
                         Inspector (incl. OCR), AIDialog, modals, Landing
```

Key invariant: **all geometry lives in the source page's PDF user space** (y-up, bottom-left). The overlay converts
to screen space with the same transform pdf.js uses for rendering and the exporter draws into the same space — so
what you see is what you get, on rotated pages too (verified: overlay glyphs within 1px, exported baseline exact).

## Tests

`npm test` runs 24 tests:
- `docModel.test.ts` — page ops, undo/redo, deletion cascades, reorder/merge/duplicate, bulk rotation.
- `viewport.test.ts` — parity with pdf.js `PageViewport` transforms/dimensions for 0/90/180/270°, coordinate
  round-trips, range parsing.
- `exportPdf.test.ts` — exports a real PDF (rotation metadata, blank pages, flattened text/highlight/edit
  annotations, metadata) and re-parses it with pdf.js to assert content and page ranges.
- `compare.test.ts` — LCS line-diff: insertions, deletions, edits (−1/+1), identical files.

## Deploy (any static host; one command)

```bash
npm run build        # → dist/ (includes service worker + manifest)
```

- **Netlify**: `netlify deploy --prod --dir=dist` (or connect the repo — `netlify.toml` handles the SPA fallback).
- **Vercel**: `vercel --prod` (`vercel.json` rewrites to the app shell).
- **GitHub Pages**: push to `main` — the included workflow (`.github/workflows/deploy-pages.yml`) builds and publishes automatically. The Vite `base` is relative (`'./'`), so the build works at any subpath (`/repo-name/`) *and* at a custom domain with zero changes. Verified locally by serving the production build under `/pdf-studio/`.
- **Cloudflare Pages / S3 + CDN / any static server**: upload `dist/` with SPA fallback to `index.html`.

## Limitations & roadmap

- Edit-text targets digital PDFs with a text layer; **scanned pages use the OCR tool** (runs locally, replaced text is
  vector on export).
- Text replacement uses Helvetica metrics (close but not glyph-identical to embedded fonts).
- Compare diffs extracted text, not rendered pixels — good for contract/revision review, not for layout shifts.
- WebLLM model weights and the OCR language file download over the network once (browser-cached). You can point
  `loadEngine`/`runOcr` at a self-hosted mirror to go 100% air-gapped.
- Bigger next steps: XFA form support, digital signatures, annotation import/export (FDF/XFDF), and PWA auto-update UX polish.

## License

MIT — see [LICENSE](./LICENSE). Fully open source: fork it, self-host it, ship it.
