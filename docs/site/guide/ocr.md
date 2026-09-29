# OCR

Turn scanned pages into editable, searchable text — entirely on your device.

## How it works

1. Open a scanned PDF (one with no selectable text layer).
2. Pick the **Edit text** tool (`E`), then choose **OCR this page**.
3. Tesseract runs locally in WebAssembly. Each recognized line becomes a real
   editable text box with the page background sampled behind it.
4. Edit the recognized text like any other line, then export — flat scans
   become clean vector text.

## Languages

Four languages ship with the app:

| Language | Code | One-time download |
|---|---|---|
| English | eng | ~2.8 MB |
| Español | spa | ~1.1 MB |
| Français | fra | ~0.6 MB |
| Deutsch | deu | ~0.8 MB |

Each language pack loads once (on first use) and is cached afterwards —
OCR works fully offline from then on.

## Privacy

OCR is fully on-device. The scan never leaves your machine; the only network
activity is the one-time language-data download, which you trigger yourself.

::: tip
After OCR, recognized lines behave like native text: you can [edit](/guide/editing-text)
them in place, and export produces real searchable, selectable vector text.
:::

## Automate it

The [CLI](/guide/cli) and [MCP server](/guide/mcp) currently focus on text
editing, redaction, and page operations. For scanned documents in scripts,
pre-OCR in the app first, then automate against the text layer.
