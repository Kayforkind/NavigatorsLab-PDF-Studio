# Annotations & signing

Everything you draw lives in true PDF coordinates — the on-screen overlay and
the exporter share the same CropBox-aware transform math — and exports as real
vector content, not a screenshot.

## Markup tools

| Tool | Shortcut | What it does |
|---|---|---|
| Select | `V` | Move and resize marks |
| Text box | `T` | Add new text anywhere |
| Highlight | `H` | Drag a box to highlight |
| Underline | `U` | Underline with color/opacity controls |
| Strikethrough | `X` | Strike through text |
| Sticky note | `N` | Click to drop a note |
| Pen | `D` | Freehand drawing |
| Arrow | `A` | Drag tail → tip; the arrowhead lands on release |
| Rectangle | `R` | Outlined rectangle |
| Ellipse | `O` | Outlined ellipse |
| Image stamp | `I` | Stamp an image from your device |

Color and line weight follow the style controls. Press `Esc` to cancel, `Del`
to remove the selected mark.

## Sign a document

1. Pick the **Signature** tool (`G`) and click where it should go.
2. Draw on the signature pad — mouse, trackpad, or touch all work.
3. Confirm, and the signature is stamped onto the page, exported as a
   transparent PNG at true PDF coordinates.

## Stamps at export

In the **Save** dialog you can also add:

- **Page numbers** — position, `1` / `Page 1` / `1 of N` formats, custom first
  number, skip-cover option
- **Watermark** — diagonal, with size/opacity/color controls
- **Headers & footers** — with `{page}`, `{pages}`, `{date}`, and `{title}` tokens

All rendered at true PDF coordinates in the exported file.

::: warning Redaction is not annotation
Covering text with a rectangle or [whiteout](/guide/redaction#whiteout-visual-cover-only)
only hides it visually — the text is still in the file. To remove sensitive
content for real, use [Redaction](/guide/redaction).
:::
