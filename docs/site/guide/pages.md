# Page management

Reorder, rotate, merge, split, duplicate, delete — all from the thumbnail rail.

## Organize pages

- **Reorder:** drag thumbnails into the order you want.
- **Per-page controls:** each thumbnail offers rotate, duplicate, delete, and
  insert-blank.
- **Rotate:** turn any page 90°, 180°, or 270° clockwise.
- **Merge:** merge another PDF at any position — or just drop a file onto the
  canvas.
- **Delete / duplicate / insert blank:** one click per thumbnail.

Sideways scans get a one-click, undoable **"Turn upright"** banner — for 90°,
180°, and 270° camera-rotation metadata alike. Mirrored artwork (a generator bug
that shows in *every* viewer) is fixed with per-page horizontal/vertical flip:
the export mirrors the real content while your marks stay put.

## Extract and split at export

In the **Save** dialog:

- **Extract a range** — e.g. `1-3,5` — to export only those pages.
- **Split** — emit one file per page.

## Compare two versions

Press **Compare**, drop in two files, and read the diff — additions in green,
removals in red, with per-page counts. Built for "did the contract terms change
between versions?"

## Automate it

```bash
pdfstudio merge a.pdf b.pdf -o combined.pdf
pdfstudio split in.pdf --ranges 1-3 --ranges 4-6 -o "part-%d.pdf"
pdfstudio rotate in.pdf --angle 90 -p 1-2 -o rotated.pdf
pdfstudio pages in.pdf --delete 5 --order 3,1,2 -o reordered.pdf
```

See [CLI reference](/guide/cli) and [`pdf_merge` / `pdf_split` / `pdf_rotate` / `pdf_pages`](/guide/mcp).
