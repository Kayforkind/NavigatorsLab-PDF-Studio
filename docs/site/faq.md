# Frequently asked questions

## Is it really free? What's the catch?

Free, MIT-licensed, no catch. No accounts, no watermarks, no caps, no "pro"
tier. Fork it, self-host it, ship it.

## How is this different from other free PDF editors?

They let you *annotate* — text boxes stamped over content. PDF Studio rewrites
the content stream: original text operators are deleted from the file, and
replacements are written in as real vector text.

## Does my document leave my device?

**Never.** There is no upload endpoint and no server. The only network use is
user-triggered: downloading AI model weights from HuggingFace (once, cached),
which contain no document data. See [Security](/guide/security).

## Does it work offline?

Yes. Install the [PWA](/guide/installation#option-2-install-the-pwa) for a
fullscreen offline-capable app, or self-host with [Docker](/guide/installation#option-3-docker-self-hosting).
AI and OCR models work offline after their one-time download.

## What's the difference between redaction and whiteout?

**Redaction** (`B`) permanently removes covered content from the file — text
operators are deleted, and pages are rasterized where text can't be proven
removable. **Whiteout** (`W`) only covers content with the page-sampled
background color; the underlying text is still in the file and is **not
secure**. Use redaction for sensitive data. See [Redaction](/guide/redaction).

## Honest limits?

- **Text editing needs a text layer.** Flat scans go through the [OCR tool](/guide/ocr) first.
- **Replacement text uses Helvetica metrics** — near-identical, not glyph-perfect, on exotic embedded fonts.
- **The on-device AI runs small models (0.5B–1B):** great at summarizing and
  answering questions about your document, not a frontier model.

## Can I automate PDF Studio?

Yes — v1.1.0 added two local, agent-native interfaces reusing the same
content-stream engine as the app:

- **[CLI](/guide/cli)** — `pdfstudio` with 9 commands: `info`, `extract-text`,
  `search`, `edit-text`, `redact`, `merge`, `split`, `rotate`, `pages`. Stdin/stdout
  pipes, `--json` output, exit codes `0`/`1`/`2`.
- **[MCP server](/guide/mcp)** — 10 tools (`pdf_info`, `pdf_extract_text`,
  `pdf_search_text`, `pdf_edit_text`, `pdf_redact_text`, `pdf_redact_rect`,
  `pdf_merge`, `pdf_split`, `pdf_rotate`, `pdf_pages`) over stdio, with path
  containment and prompt-injection hardening.

Both make zero network calls.

## How do I report a security issue?

**Do not open a public GitHub issue.** Email Kazym at
`kazim.r.merchant@gmail.com` with subject `[SECURITY] PDF Studio — <short
description>`. See the [vulnerability policy](/guide/security#report-a-vulnerability).

## How do I contribute?

The repo labels newcomer-friendly work as
[`good first issue`](https://github.com/Kayforkind/NavigatorsLab-PDF-Studio/labels/good%20first%20issue).
See
[CONTRIBUTING.md](https://github.com/Kayforkind/NavigatorsLab-PDF-Studio/blob/main/CONTRIBUTING.md)
for setup (`npm install`, `npm run dev`, `npm test`, `npm run build`).

## Where is my autosaved session stored?

In your browser's localStorage, on your device only. A one-click "forget"
control wipes it completely — use it on shared machines.
