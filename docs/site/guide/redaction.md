# Redaction

PDF Studio offers **two different** covering tools. They look similar on
screen, but only one of them is secure. Know the difference before you ship a
file with sensitive data.

## Redact — truly secure (`B`)

**Redaction permanently removes the covered content from the file.** Use it for
anything sensitive: SSNs, account numbers, names, addresses.

1. Pick the **Redact** tool (`B`) and drag over what must not be seen. In the
   editor the box is shown **hatched**, labeled as *marked for redaction* —
   this is a promise, not a removal. Nothing is deleted yet.
2. **Export the PDF.** The destruction happens at export, when the file is
   rebuilt (see [How it works](/guide/how-it-works#redaction-marked-then-destroyed)).

At export, redaction runs a destructive pipeline:

1. **Hidden copies cleared** — form field values, source annotations, and
   accessibility-tree text (`/Alt`, `/ActualText`) under the boxes are wiped
   first, because redacted text can survive in these places.
2. **Vector removal** — every text-drawing operator fully covered by a redact
   box is **deleted from the page's content stream**, recursively through
   nested Form XObjects. Vector fills and strokes under the boxes are
   removed too. Everything else stays as vector text: selectable, searchable,
   print-crisp.
3. **Pixel-burn fallback** — for content that can't be proven removable
   (partially covered text, scanned images, exotic fonts, complex vector
   effects), the page is rendered to pixels with the redact boxes burned in,
   and the original content stream is discarded entirely.
4. **Metadata scrubbed** — document info, XMP, embedded files, JavaScript,
   and thumbnails are removed from redacted exports.
5. **Verification gate** — the finished file is scanned for every covered
   string across multiple encodings. If anything redacted is still
   recoverable, **no file is delivered**: export fails with an error instead
   of handing you a file that leaks.

What was redacted cannot be recovered by selecting, copying, or inspecting
the exported PDF — and the tool refuses to deliver a file where that isn't
true.

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

- Redact → export → **verify**: after export the app shows a verification
  report (regions redacted, strings checked, recoverable). Then try selecting
  and copying the covered area in the exported file yourself; check that the
  text isn't searchable.
- Prefer redacting whole lines/text blocks over partial words. Partial
  coverage forces the pixel-burn path, which turns the whole page into an
  image.
- When in doubt, re-open the exported file and inspect it before sharing.

## Automate it

```bash
# burned-in redaction: bytes deleted, unrecoverable
pdfstudio redact in.pdf --find "123-45-6789" -o clean.pdf
pdfstudio redact in.pdf --rect "2:72,500,200,24" -o clean.pdf   # page:x,y,w,h in points
```

See [CLI reference](/guide/cli) and [`pdf_redact_text` / `pdf_redact_rect`](/guide/mcp).
