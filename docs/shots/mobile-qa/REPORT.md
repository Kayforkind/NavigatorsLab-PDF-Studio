# PDF Studio — Deep Mobile QA Report

**Target:** `https://navigatorslab.com/pdf-studio/`
**Date:** 2026-09-28
**Tester:** Jules (automated, Playwright + CDP genuine touch)
**Build under test:** production `assets/index-D5sBH5_j.js` / `assets/index-BgznJGyY.css` (mobile-fix build, verified live via bundle hash)
**Scope:** TEST ONLY. No application code changed. No push. No deploy.

## Method

- Real Chromium mobile emulation (`isMobile: true`, `hasTouch: true`) at 360×740, 390×844, 414×896, 768×1024, 844×390.
- All taps/drags performed as **genuine touch** via CDP `Input.dispatchTouchEvent` (touchStart/touchMove/touchEnd), including two-finger pinch. No mouse events presented as touch.
- Correction applied mid-pass: horizontally off-screen toolbar buttons were scrolled into view (`scrollIntoView({inline:'center'})`) and verified inside the viewport *before* tapping; the first pass produced false results by tapping off-screen coordinates.
- Egress via local preemptive-auth forwarding proxy (`127.0.0.1:18080`); production returned HTTP 200.
- Screenshots: this directory (`docs/shots/mobile-qa/`). Raw harness output: `results.json`, `results2.json`.

## Matrix verdicts

| # | Item | 360×740 | 390×844 | 414×896 | 768×1024 | 844×390 (landscape) |
|---|------|---------|---------|---------|----------|---------------------|
| 1 | Landing layout / dropzone / buttons / overflow | PASS | PASS | PASS | PASS* | PASS* |
| 2 | Real multipage PDF loads (4-page demo) | PASS | PASS | PASS | PASS | PASS |
| 3 | Every markup tool, genuine touch | — | PASS | — | — | PASS (rect verified) |
| 4 | Annotation selection, inspector, property editing | — | PASS | — | — | — |
| 5 | Export/Forms/Compare/AI/Help/Signature dialogs | — | PASS | — | **FAIL (D1)** | **FAIL (D1)** |
| 6 | Valid PDF export (bytes start `%PDF-`) | — | PASS | — | — | — |
| 7 | Every topbar control (behavior, not just visibility) | — | PASS | — | — | — |
| 8 | Mobile page navigation / jumping | — | LIMIT (D2) | — | — | — |
| 9 | Console errors / uncaught exceptions | PASS | PASS | PASS | PASS | PASS |
| 10 | All inputs ≥ 16px | — | PASS | — | — | — |
| 11 | Pinch zoom | — | LIMIT (D3) | — | — | — |
| 12 | Select-mode touch panning | — | PASS | — | — | — |
| 13 | Landscape usability | — | — | — | — | PASS* |

\* Items 1/13 at ≥768px widths: the app renders its **desktop layout** there; usable, but see defect D1 (topbar/dialogs).

### Detail per item

**1. Landing / dropzone / overflow.** No horizontal page overflow on the landing page at any size (`documentElement.scrollWidth == viewport`). Dropzone visible at 390×844.

**2. Document load.** Built-in 4-page demo loads at all five sizes (`.sheet-inner` × 4 present).

**3. Markup tools (genuine touch, 390×844).** Each tool activated by real touch-tap on its rail button (verified `.active`), then exercised with real touch-drag/tap on the page canvas. All PASS:
Highlight, Underline, Strikethrough, Ink, Rectangle, Ellipse, Arrow, Redact, Whiteout, Add text, Sticky note, Text field, Edit text, Signature (pad opens → stroke drawn → confirm → placed), Image stamp (placed), Checkbox (placed).
Evidence: `v2-tool-*.png`. At 844×390 (desktop layout) rectangle touch-draw also verified working with on-screen coordinates (annotations 0→2).

**4. Selection / inspector / property editing (390×844).** Tap on a drawn rectangle shows the dashed selection outline with resize handle. The inspector does **not** auto-open on selection (design); tapping the topbar *"Colors, fonts & size (opens the style panel)"* button opens it (`display:flex`, 320×784, fits viewport). With the rect selected it shows SELECTION: RECT, color swatches, Custom color, Line-width slider (2.5pt), delete. Tapping the red swatch via genuine touch changed the rect's stroke `#ffd400` → `#ff5c5c`. Full flow works.
Evidence: `v2-inspector-selected-390x844.png`, `v2-inspector-recolored-390x844.png`.

**5/6. Dialogs & export (390×844).** Export, Forms, Compare, AI, Help dialogs all open via genuine touch and fit (x=10, w=374, internal scrollWidth == clientWidth). Export → "Download PDF" produced **5862 bytes starting `%PDF-`**. Mobile Save CTA (`button.save-cta`) also downloads a valid PDF (5862 bytes, `%PDF-`).
At 768×1024 and 844×390: **FAIL — see D1.**

**7. Topbar controls (390×844, by behavior).** Open → file picker opens; Merge → file picker opens; Undo/Redo → annotation round-trip verified; Zoom out/in → 100%→125% verified; Forms/Compare/AI/Help → dialogs open; Print → no errors; Palette → inspector opens; Export → dialog opens; Save CTA → valid PDF download. The 0×0 icon button titled "Save a copy (Ctrl+S)" is the hidden desktop control; the visible `button.save-cta` is the mobile Save — not a defect.

**8. Page navigation.** The thumbnail strip (`.thumb-strip`, `aria-label="Pages"`) is `display:none` on mobile — **no page-jump control exists on mobile**; navigation is by touch scrolling/panning, which works (see 12). Scrolling reaches all 4 pages. See D2.

**9. Console / exceptions.** Zero uncaught page errors in all flows. Only console noise: `Loading the script 'https://static.cloudflareinsights.com/beacon.min.js…'` blocked by the site's CSP (third-party analytics, not app code). One `Failed to parse PDF document … No PDF header found` error was reproduced as a **harness artifact** (the test uploaded a PNG into a PDF file input); not an app defect.

**10. Inputs ≥16px.** All visible inputs (search box) computed ≥16px. Zero violations.

**11. Pinch zoom.** Two-finger CDP pinch-spread on the canvas: no crash, no error — but zoom stayed 100%→100%. Zoom is available via topbar −/+ buttons (verified 100%→125%). See D3.

**12. Select-mode panning.** Touch swipe on canvas in Select mode scrolled the real scroller (`main.canvas-area` scrollTop 0→319). (An earlier "no scroll" reading measured `window.scrollY`; the app scrolls an inner container — harness correction, not an app bug.)

**13. Landscape (844×390).** App renders desktop layout (left tool rail). Touch drawing works; dialogs affected by D1.

## Defects

### D1 — HIGH — Topbar not scrollable and all modal dialogs mispositioned at viewport widths 768–1191px
- **Viewports:** 768×1024, 844×390 (any window ≥768px wide).
- **Root cause (observed):** `.topbar` has `overflow-x: auto` at ≤767px but reverts to `overflow-x: visible` at ≥768px. The topbar's button content is 1192px wide, so it overflows: `document.documentElement.scrollWidth = 1192` (page-level horizontal overflow) and `window.innerWidth` reports 1192. The `.modal-backdrop` (`position:fixed; left:0; right:0`) sizes to that 1192px layout viewport, so every `.modal-wide` dialog (737px) centers at x=227 — its right edge (965px) hangs past the 768px viewport. All five dialogs affected: Export, Forms, Compare, AI, Help.
- **User impact:** topbar buttons past 768px (Export, Save, …) are cut off; dialogs render partially off-screen with action buttons unreachable.
- **Repro:** 768×1024 → load demo doc → tap Export. Dialog at x=227, w=737, right edge 965 > 768.
- **Screenshots:** `v2-s3-export-768x1024.png`, `v2-s3-export-844x390.png`, `v2-dialog-mispositioned-768x1024.png`.
- **Note:** at 390/360/414 the topbar scrolls internally and all dialogs fit — the defect is specific to the ≥768px breakpoint.

### D2 — LOW (design observation) — No page-jump control on mobile
- `.thumb-strip` is `display:none` at mobile widths; no page-number input or jump UI exists. Page navigation is scroll/pan only (functional). Flagging because page jumping was explicitly requested; may be intentional.

### D3 — LOW (observation) — Pinch-spread does not zoom
- Genuine two-finger pinch on the canvas: no zoom change (100%→100%), no crash, no error. Zoom works via topbar −/+ buttons. If pinch-to-zoom is intended on mobile, it's not wired; if it's intentionally button-only, no action needed.

## Harness artifacts corrected during this pass (NOT app defects — do not file)

- Text-field "activation fail" → flake; retest: `active=true` on first tap.
- Inspector "never opens" → it intentionally opens via the palette button, not on selection; full property editing verified working.
- Export "Download PDF not found" → exact-text regex missed the button; download works, valid `%PDF-` bytes.
- Save CTA click timeout → prior failed step left the Export dialog open over the button; retest downloads valid PDF.
- Select-mode pan "no scroll" → measured `window.scrollY`; app scrolls `main.canvas-area` — panning works.
- 844×390 rectangle "not drawn" → drag coordinates landed below the short viewport; on-screen drag draws fine.
- `Failed to parse PDF … No PDF header` console error → test uploaded `stamp.png` into a PDF file input.
- First-pass "passes" for ink/rect at 390×844 were invalid (taps hit off-screen buttons); corrected pass re-verified every tool with on-screen coordinates.

## Test limitations

- Playwright `headless-shell` Chromium, not headed Chrome; not tested on physical iOS/Android devices.
- `window.innerWidth` reporting 1192 at 768px windows appears to be a headless-shell mobile-emulation quirk (CSS media queries correctly see 768px); the D1 dialog mispositioning itself is real and visible in screenshots regardless.
- File-picker flows verified to *open*; no real file was uploaded through them (no user files involved).
- Print verified to open without errors; print output not inspected.
- AI dialog opened; no AI query executed (on-device model load not exercised).
- Pinch tested as two-finger touch-spread; OS-level gesture events (`gesturestart`) not simulated.
- Image-stamp upload exercised the image input; the stray "No PDF header" console error came from the harness touching a PDF input.

## Confirmation

**No application code was changed, nothing was pushed, nothing was deployed during this QA.** All work products are the test scripts, screenshots, `results.json`/`results2.json`, and this report under `docs/shots/mobile-qa/`.

## Addendum 2026-09-28 ~13:50 UTC — D1 FIXED and deployed

- **Fix (CSS only, `src/styles.css`):** the base `.topbar` rule now has `overflow-x: auto` (+ hidden scrollbars) at ALL widths, with `.topbar > * { flex: none; }` and `.topbar > .tb-spacer { flex: 1 0 4px; }` moved up from the ≤720px media query. The ~1192px button row now scrolls inside the topbar instead of overflowing the page, so the layout viewport stays at the visual viewport width and `position:fixed` dialog backdrops center correctly. No App.tsx changes.
- **Tests:** 42/42 pass. Production build clean.
- **Re-verified (genuine touch, headless-shell):** at 768×1024 `documentElement.scrollWidth` = 768 (was 1192); Export and Forms dialogs fully on-screen (x=24, right edge 761 ≤ 768); same at 844×390 (right edge 834 ≤ 844). Zero page errors. Desktop 1440×900 regression-checked: no topbar scroll, Save still right-aligned. Screenshots: `d1fix-*.png`.
- **Deployed:** commit `e8d3400b` (styles.css only) pushed via GitHub Data API; `deploy_worker.py` → script deploy 200, cache purge 200. Live verified: HTTP 200, served JS/CSS byte-identical to local build, fix present in served bundle.
- **Known remaining (not fixed):** D2 (no page-jump UI on mobile — accepted design limitation, thumb strip hidden by design); D3 (pinch-spread does not zoom — nice-to-have, zoom via topbar −/+ works).
