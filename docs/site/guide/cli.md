# CLI reference — `pdfstudio`

The `pdfstudio` CLI reuses the exact same content-stream engine as the web app —
true in-place text editing, burned-in redaction, and page operations. **100%
local: no network calls, document bytes never leave the machine.**

## Setup

```bash
git clone https://github.com/Kayforkind/NavigatorsLab-PDF-Studio
cd NavigatorsLab-PDF-Studio
npm install
npm run build:packages
```

Run from the repo root with `npx pdfstudio …`, or make it global and call
`pdfstudio` anywhere:

```bash
npm link -w packages/cli
```

## Conventions

- `-` as an input reads the PDF from **stdin**.
- `-o -` writes binary output to **stdout** (pipe-friendly). PDF Studio refuses
  to write binary PDF to a terminal — pipe it or use `-o <file>`.
- **Exit codes:** `0` ok · `1` error · `2` no matches / nothing changed.
- `--json` on read commands (`info`, `extract-text`, `search`) emits
  machine-readable output for scripting.
- Human-readable reports go to **stderr**; data goes to **stdout**.

## Commands

### `info` — metadata and page geometry

```bash
pdfstudio info contract.pdf
pdfstudio info contract.pdf --json
```

### `extract-text` — text per page

```bash
pdfstudio extract-text contract.pdf -p 1-3
pdfstudio extract-text contract.pdf -o text.txt
cat in.pdf | pdfstudio extract-text - --json
```

| Flag | Description |
|---|---|
| `-p, --pages <spec>` | 1-based pages, e.g. `"1-3,5"` |
| `-o, --output <file>` | Write to file (`-` = stdout) |
| `--json` | Machine-readable output |

### `search` — find text

```bash
pdfstudio search contract.pdf "termination clause"
pdfstudio search contract.pdf "Termination" --case-sensitive --json
```

Prints page/line/snippet hits. Exits `2` with `no matches` on stderr when
nothing is found.

### `edit-text` — true in-place text editing

```bash
pdfstudio edit-text in.pdf --find "Acme Corp" --replace "Globex Inc" --all -o out.pdf
pdfstudio edit-text in.pdf --find "draft" --replace "" -o out.pdf   # delete
cat in.pdf | pdfstudio edit-text - --find "draft" --replace "FINAL" -o - > out.pdf
```

The original bytes are **deleted from the content stream**, not overlaid —
same engine as the app's Edit tool.

| Flag | Description |
|---|---|
| `--find <text>` | **Required.** Text to find |
| `--replace <text>` | **Required.** Replacement (`""` deletes) |
| `-p, --pages <spec>` | 1-based page ranges, e.g. `"1-3,5"` (default: all) |
| `--all` | Replace every occurrence (default: first match only) |
| `--case-sensitive` | Case-sensitive match |
| `-o, --output <file>` | **Required.** Output PDF (`-` = stdout) |

### `redact` — burned-in redaction

```bash
pdfstudio redact in.pdf --find "123-45-6789" -o clean.pdf
pdfstudio redact in.pdf --rect "2:72,500,200,24" -o clean.pdf
pdfstudio redact in.pdf --rect "1:72,700,300,20" --rect "3:72,700,300,20" -o clean.pdf
```

Covered text is **deleted from the file — unrecoverable**. `--rect` takes
`<page:x,y,w,h>` in PDF points, origin at the bottom-left of the page's media
box (repeatable). `--find` redacts every line containing the text.

| Flag | Description |
|---|---|
| `--find <text>` | Redact every line containing this text |
| `--rect <spec>` | `<page:x,y,w,h>` in points (repeatable) |
| `-p, --pages <spec>` | Limit `--find` to these 1-based pages |
| `--case-sensitive` | Case-sensitive `--find` |
| `-o, --output <file>` | **Required.** Output PDF (`-` = stdout) |

### `merge` — combine PDFs

```bash
pdfstudio merge a.pdf b.pdf -o combined.pdf
```

Merges inputs in order. `-` may be used for one of the inputs (stdin).

### `split` — one PDF per range

```bash
pdfstudio split in.pdf --ranges 1-3 --ranges 4-6 -o "part-%d.pdf"
```

`--ranges` is repeatable (1-based, e.g. `"1-3"`). The output template supports
`%d` (part index) and `%s` (sanitized range spec). Use `-o -` for a single
range to stdout.

### `rotate` — rotate pages

```bash
pdfstudio rotate in.pdf --angle 90 -p 1-2 -o rotated.pdf
```

| Flag | Description |
|---|---|
| `--angle <deg>` | **Required.** `90`, `180`, or `270` (clockwise) |
| `-p, --pages <spec>` | 1-based pages (default: all) |
| `-o, --output <file>` | **Required.** Output PDF (`-` = stdout) |

### `pages` — delete and reorder

```bash
pdfstudio pages in.pdf --delete 5 --order 3,1,2 -o reordered.pdf
```

| Flag | Description |
|---|---|
| `--delete <ranges>` | 1-based pages to drop, e.g. `"2,5-7"` |
| `--order <list>` | 1-based new order, e.g. `"3,1,2"` — unlisted pages keep relative order, appended |
| `-o, --output <file>` | **Required.** Output PDF (`-` = stdout) |

## Privacy guarantee for scripts

The CLI makes **zero network calls**. Parsing (pdf.js), editing (content-stream
rewriting), and writing (pdf-lib) all run in process. Redaction deletes the
text operators from the file, and the output is rebuilt so orphaned bytes are
gone too.

## Prompt-injection note

PDF content is **untrusted input**. If you feed CLI output into an agent or
script that treats text as instructions, keep the boundary: document text is
data, never instructions. (The MCP server wraps extraction results in explicit
delimiters — see [MCP server](/guide/mcp).)
