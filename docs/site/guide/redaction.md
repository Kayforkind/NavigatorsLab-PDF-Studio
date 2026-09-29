# Redaction

PDF Studio offers **two different** covering tools. They look similar on
screen, but only one of them is secure. Know the difference before you ship a
file with sensitive data.

## Redact — truly secure (`B`)

**Redaction permanently removes the covered content from the file.** Use it for
anything sensitive: SSNs, account numbers, names, addresses.

1. Pick the **Redact** tool (`B`) and drag over what must not be seen. The box
   is opaque black on canvas.
2. Export the PDF.

At export, redaction runs a two-pass process:

1. **Vector redaction** — every show-text operator fully covered by a redact box
   is **deleted from the page's content stream**. The text is gone from the
   file, not painted over.
2. **Rasterization fallback** — for content that can't be proven removable
   (scanned images, exotic fonts, complex vector art), the page is rendered to
   pixels with the redact boxes burned in, so the region is truly destroyed.

Either way, the covered content does not survive in the exported file. What was
redacted cannot be recovered by selecting, copying, or inspecting the PDF.

::: warning Never use whiteout for sensitive data
[Whiteout](#whiteout-visual-cover-only) only covers content visually. Use
**Redact** when the data must actually be gone.
:::

## Whiteout — visual cover only (`W`)

**Whiteout covers with the page-sampled background color.** It blends in on
tinted or scanned pages, which makes it ideal for invisible cleanup — fixing a
smudge on a scan, removing a stray mark — but **it is NOT secure**:

- The covered text or content is **still in the file** underneath.
- Anyone with the PDF can select, copy, or uncover what you covered.

Use whiteout for cosmetic fixes. Use redaction for sensitive data.

## Redaction checklist

- Redact → export → **verify**: try selecting and copying the covered area in
  the exported file; check that the text isn't searchable.
- Prefer redacting whole lines/text blocks over partial words.
- When in doubt, re-open the exported file and inspect it before sharing.

## Automate it

```bash
# burned-in redaction: bytes deleted, unrecoverable
pdfstudio redact in.pdf --find "123-45-6789" -o clean.pdf
pdfstudio redact in.pdf --rect "2:72,500,200,24" -o clean.pdf   # page:x,y,w,h in points
```

See [CLI reference](/guide/cli) and [`pdf_redact_text` / `pdf_redact_rect`](/guide/mcp).
