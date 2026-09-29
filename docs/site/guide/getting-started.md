# Getting started

This guide takes you from opening your first PDF to making your first edits.

## Open a PDF

1. Go to the [live app](https://navigatorslab.com/pdf-studio/) — or your self-hosted copy ([installation options](/guide/installation)).
2. **Drag & drop** any PDF onto the page, or press `Ctrl/⌘ O` to pick one.
3. That's it. There is no sign-up, no upload, no waiting — the file is read
   locally by your browser.

::: tip Private by design
Your file is opened, edited, and saved on your own machine. Open your browser's
devtools while you work: your document bytes never leave the device.
:::

## Tour of the UI

- **Left tool rail** — the editing tools. Hover any tool for its keyboard shortcut.
  - `V` select · `E` edit text · `T` text box · `H` highlight · `U` underline · `X` strike
  - `N` sticky note · `D` pen · `A` arrow · `R` rectangle · `O` ellipse
  - `G` signature · `I` image stamp
  - `F` text field · `C` checkbox (form-field tools)
  - `B` redact · `W` whiteout (visual cover only — [not secure](/guide/redaction))
- **Thumbnail rail** — page thumbnails. Drag to reorder; each thumbnail has
  controls to rotate, duplicate, delete, or insert a blank page.
- **Top bar** — search across the whole document, open the **Forms** dialog for
  fillable PDFs, open **Compare** to diff two versions, and open the **✦ AI**
  assistant.
- **Save / export** — `Ctrl/⌘ S` downloads a copy. The export dialog offers page
  ranges (`1-3,5`), split into one file per page, plus stamping: page numbers,
  watermarks, headers & footers.

### Useful shortcuts

| Keys | Action |
|---|---|
| `Ctrl/⌘ Z` / `Ctrl/⌘ Y` | Undo / redo |
| `Ctrl/⌘ O` | Open a PDF |
| `Ctrl/⌘ S` | Save a copy |
| `Ctrl/⌘ P` | Print |
| `Del` / `Esc` | Delete selected mark / cancel |
| `+` / `−` / `0` | Zoom in / out / reset to 100% |

## Your first edits

1. Press `E` (Edit text), then **click any line** of the original text. Every
   line — and every table cell — is a clickable target.
2. Retype the line and press `Enter`. The original text is rewritten in the
   file's content stream itself: no overlay, no text box on top. See
   [Editing text](/guide/editing-text).
3. Press `H` and drag over a sentence to highlight it, or `N` and click to drop
   a sticky note. See [Annotations](/guide/annotations).
4. Press `Ctrl/⌘ S` to download your edited copy.

## What to try next

- **Cover sensitive data for real** — [Redaction](/guide/redaction) deletes
  covered content from the file; whiteout only covers it visually.
- **Turn a scan into editable text** — [OCR](/guide/ocr) runs on-device.
- **Ask the document questions** — [On-device AI](/guide/ai) runs a small LLM in
  your browser, nothing uploaded.
- **Automate it** — the [CLI](/guide/cli) and [MCP server](/guide/mcp) give
  scripts and AI agents the same editing engine.

## Sessions autosave

Everything you do autosaves on-device. If you refresh or the tab crashes, the
start screen offers to restore the whole session — files, page operations,
marks, and form values. The autosave lives only in your browser's localStorage;
a one-click "forget" control wipes it completely.
