---
layout: home

hero:
  name: "PDF Studio Docs"
  text: "The free, open-source PDF editor that runs entirely in your browser."
  tagline: No uploads · No accounts · No watermarks · No page limits · No catch
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
    details: v1.1.0 added a pdfstudio CLI (9 commands) and an MCP server (10 tools) reusing the same content-stream engine — 100% local, agent-native.
---

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
| [Security](/guide/security) | Privacy architecture and the internal A− security audit |
| [FAQ](/faq) | Pricing, limits, offline use, redaction vs. whiteout, and more |

## Try it in 30 seconds

[Open the live app](https://navigatorslab.com/pdf-studio/), drop in any PDF, press `E`,
click any line of existing text, retype it.

**MIT** — free for personal, commercial, and everything in between.
[License](https://github.com/Kayforkind/NavigatorsLab-PDF-Studio/blob/main/LICENSE) ·
[Discussions](https://github.com/Kayforkind/NavigatorsLab-PDF-Studio/discussions) ·
[navigatorslab.com](https://navigatorslab.com)
