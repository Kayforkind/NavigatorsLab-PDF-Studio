---
layout: home

hero:
  name: "PDF Studio Docs"
  text: "A PDF editor with no backend. It rewrites the file's content stream, in your browser."
  tagline: MIT · zero server · npm CLI and MCP server · no uploads, accounts, watermarks or page limits
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: Open the Live App
      link: https://navigatorslab.com/pdf-studio/
    - theme: alt
      text: GitHub
      link: https://github.com/Kayforkind/NavigatorsLab-PDF-Studio

features:
  - title: ✏️ True text editing
    details: Click any line — or any table cell — and retype it. The original text operators are rewritten in the file itself, not overlaid. Exports as real, searchable vector text.
  - title: 🖤 Real redaction
    details: Covered content is deleted from the file at export — vector text operators removed, and pages rasterized where text can't be proven removable. Not painted over.
  - title: 📝 Forms
    details: Fill real AcroForms — text, checkboxes, radios, dropdowns — then flatten them so nobody can change your answers.
  - title: 🖋️ Sign & annotate
    details: Signature pad, highlight, pen, arrows, shapes, sticky notes, image stamps — all exported as real vector content.
  - title: 🔠 On-device OCR
    details: Scanned pages become editable text via local Tesseract (EN/ES/FR/DE). No upload, ever.
  - title: 🤖 On-device AI
    details: Ask questions about your document; a real LLM runs in your browser via WebAssembly. Your data never leaves.
  - title: ⚖️ Revision diff
    details: Drop in two versions, get a line-by-line diff. Did the payment terms change? Now you know.
  - title: 📄 Page ops
    details: Reorder, rotate, merge, split, duplicate, delete. Stamp page numbers, watermarks, headers & footers at export.
  - title: 💻 CLI & MCP
    details: The same engine as a `pdfstudio` CLI (9 commands) and a standalone `pdfstudio-mcp` server (10 tools). 100% local, agent-native, no API key.
  - title: 🕵️ Redaction checker
    details: Drop in a PDF and see the text still hiding under its black boxes. A five-minute way to find out whether a "redaction" was real.
---

## For developers

The MCP server is published on npm; the CLI builds from the repo.

```bash
npx pdfstudio-mcp --root ./docs --read-only    # MCP: 10 PDF tools over stdio for any agent
npx pdfstudio info contract.pdf                # CLI — from a clone, after `npm run build:packages`
```

Everything is local by construction: pdf.js parses, the content stream is rewritten in place, pdf-lib
writes. No service to run, no key to set, no document bytes on the wire. Redaction is gated — the
exporter re-scans its own output and refuses to produce a file if a covered string is still
recoverable.

**[CLI reference](/guide/cli)** · **[MCP reference](/guide/mcp)** ·
**[Redaction engine](/guide/redaction)** · **[Security audit](/guide/security)**

## Private by architecture, not by policy

PDF Studio runs **100% in your browser**. Your files are opened, edited, and saved
on your own machine — there is no server to upload to. Open devtools while you
edit: your document bytes never leave the machine.

- **Zero network calls carry document bytes** — verified by an internal security audit ([Security](/guide/security))
- The only external host the app ever contacts is HuggingFace, for **one-time, user-triggered AI model downloads**
- Autosaves stay in your browser's localStorage; a one-click wipe deletes them

## Start here

| | |
|---|---|
| [Getting started](/guide/getting-started) | Open a PDF, tour the UI, make your first edits |
| [Installation](/guide/installation) | Use it in the browser, install the PWA, Docker self-hosting, build from source |
| [CLI reference](/guide/cli) | `pdfstudio info`, `edit-text`, `redact`, `merge`, `split`, `rotate`, `pages`… |
| [MCP server](/guide/mcp) | Give Claude Code / Cursor / Cline 10 PDF tools over stdio — no network, path-contained |
| [Redaction checker](https://navigatorslab.com/pdf-studio/redact-check/) | Drop in a PDF and see the text still hiding under its black boxes |
| [Security](/guide/security) | Privacy architecture and the internal A− security audit |
| [FAQ](/faq) | Pricing, limits, offline use, redaction vs. whiteout, and more |

## Try it in 30 seconds

[Open the live app](https://navigatorslab.com/pdf-studio/), drop in any PDF, press `E`,
click any line of existing text, retype it.

**MIT** — free for personal, commercial, and everything in between.
[License](https://github.com/Kayforkind/NavigatorsLab-PDF-Studio/blob/main/LICENSE) ·
[Discussions](https://github.com/Kayforkind/NavigatorsLab-PDF-Studio/discussions) ·
[navigatorslab.com](https://navigatorslab.com)
