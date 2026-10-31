# redact-check

**Find out whether a PDF's black boxes actually removed the text underneath them.**

Most "redaction" in the wild is a filled rectangle drawn on top of live text. It looks safe
on screen and it is worthless: the characters are still in the content stream, so anyone can
select them, copy them, or delete the rectangle. This tool reads a PDF in the browser, finds
the solid boxes, and prints the text still hiding under each one.

Nothing is uploaded. There is no server, no account, and no network call carrying your file.

```bash
npm run dev:redact-check      # http://localhost:5200
npm run build:redact-check    # static bundle in packages/redact-check/dist
```

Drop a PDF on the page, or open a shareable link straight to a result:

```
http://localhost:5200/?demo=fixtures/fake-redaction.pdf
```

## What it reports

| Verdict | Meaning |
| --- | --- |
| `LEAKS FOUND` | Text was recovered from underneath at least one solid box. That redaction was cosmetic. |
| `NOTHING RECOVERABLE` | Boxes were found, but no text survives under them. |
| `NO SOLID BOXES FOUND` | Nothing in the document looks like a drawn-over box. Not a clean bill of health — see the limits. |

Each finding names the page, the box's position and size in points, how much of the line it
covers, and the recovered string. A JSON report (`pdfstudio.redact-check/v1`) can be
downloaded for scripting or attaching to a ticket.

## How it works

1. **Render** each page with pdf.js at 2× and read the pixels back.
2. **Detect** connected dark regions whose filled area covers ≥ 85% of their own bounding box
   (`src/detect.ts`). Glyphs are sparse inside their box and fail this test; filled rectangles
   pass it. Regions covering most of the page are rejected as backgrounds.
3. **Locate** every text run in device space, composing pdf.js's text matrix with the viewport
   matrix so rotated pages (0/90/180/270°) are handled without special cases.
4. **Clip** each run against each box in the run's own frame. The covered character range is
   mapped proportionally across the string, which makes its boundaries approximate by a
   character or two.
5. **Confirm** the covered glyph band is actually dark. This is the step that separates a real
   leak from a white "REDACTED" label printed *on top of* the box: a label leaves light pixels,
   hidden text leaves only dark ones.

Steps 1 and 3–5 are in `src/analyze.ts`; all the geometry in step 2–5 is pure and lives in
`src/detect.ts`, which is why it can be unit-tested without a browser.

## Tests

```bash
cd packages/redact-check && npx vitest run   # 24 tests, plain Node
```

They cover solidity detection (a box vs. a line of glyphs vs. a full-page background), the
rotation cases, the white-label exclusion, and a pinned regression for the unit bug that
matters here: `item.width` is in PDF points, so it must be multiplied by the render scale,
while the composed text matrix already contains the font size.

Run end-to-end in a browser with the two fixtures (`npm run fixtures` regenerates them):

| Fixture | Expected |
| --- | --- |
| `public/fixtures/fake-redaction.pdf` | 2 boxes, 3 recoverable strings (`Patient: Jane Doe`, `SSN 123-45-6789`, `IBAN GB29 NWBK 6016 1331 9268 19`) |
| `public/fixtures/real-redaction.pdf` | 2 boxes, 0 recoverable strings |

## Limits — read these before trusting it

- It checks **text**, not pixels. An image or a scan under a box cannot be shown to be gone.
- Clean means "nothing was recovered from the boxes it found", not "this file is safe".
- Boxes in a light colour, translucent overlays, and content outside the visible page area are
  not detected.
- Text removed from the content stream but still present in metadata, annotations, or
  attachments is a different check and is not covered here.
- The character boundaries of a recovered string are approximate; the point is that the text is
  reachable.

These limits are also stated in the UI, because a privacy tool that overstates its result is
worse than no tool.

## License

MIT, same as the rest of PDF Studio.
