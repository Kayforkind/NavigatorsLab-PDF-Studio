# pdfstudio-mcp

**Give your agent hands on PDFs — locally.** Read, search, edit real text, redact by deleting the
bytes, merge, split, rotate, and rearrange pages over the Model Context Protocol.

No API key. No cloud. No upload endpoint. Parsing (`pdf.js`), editing (content-stream rewriting),
and writing (`pdf-lib`) all run in the server process, so a document never leaves the machine
running it.

```bash
npx pdfstudio-mcp --root ~/Documents --read-only
```

The agent talks to it over stdio. `--root` bounds every path the agent can touch (default: the
current directory).

## Why this one

Most PDF tools for agents can *read*. This one can also **change the file**: the edit tools rewrite
the page's content stream, so the original characters are deleted rather than covered. Redaction
goes further — it removes the covered text operators, rebuilds the output, and then scans the
resulting bytes for every covered string in UTF-8, UTF-16, and hex form. **If anything is still
recoverable, the tool refuses and writes no file.** A redaction that cannot be proven is not
reported as a success.

## Install

```bash
npx pdfstudio-mcp --help
```

Also listed in the official MCP registry as `io.github.Kayforkind/pdfstudio`, so registry-aware
clients can find it by name.

For a pinned install:

```bash
npm i -g pdfstudio-mcp
pdfstudio-mcp --root ./docs
```

### Claude Code

```bash
claude mcp add pdfstudio -- npx -y pdfstudio-mcp --root /path/to/your/docs --read-only
```

### Cursor, Cline, VS Code, or any MCP client

```json
{
  "mcpServers": {
    "pdfstudio": {
      "command": "npx",
      "args": ["-y", "pdfstudio-mcp", "--root", "/path/to/your/docs", "--read-only"]
    }
  }
}
```

Drop `--read-only` only when the agent genuinely needs to write files.

## Tools

| Tool | Writes | What it does |
| --- | --- | --- |
| `pdf_info` | — | Page count, page sizes, rotation, metadata |
| `pdf_extract_text` | — | Text per page, delimited and marked untrusted |
| `pdf_search_text` | — | Page/line/snippet hits with optional case sensitivity |
| `pdf_edit_text` | ✓ | Find/replace **real** text in the content stream; `replace: ""` deletes |
| `pdf_redact_text` | ✓ | Burn in every line containing a string; returns the full verification report |
| `pdf_redact_rect` | ✓ | Burn in rectangles (`page`, `x`, `y`, `w`, `h` in points, origin bottom-left) |
| `pdf_merge` | ✓ | Merge PDFs in order |
| `pdf_split` | ✓ | One file per range spec; `%d` and `%s` in the output template |
| `pdf_rotate` | ✓ | Rotate pages 90/180/270° clockwise |
| `pdf_pages` | ✓ | Delete and/or reorder pages |

`--read-only` registers only the three read tools, so an agent cannot modify anything.

Every mutating tool writes to an explicit output path — never in place. A redaction failure throws
instead of returning partial output, and the refusal carries the same machine-readable report as a
success (`pdfstudio.redact-report/v1`: pages, regions, strings checked, byte-scan and extraction
verification, refusal reason).

## Security model

- **Path containment.** Every path is resolved against `--root` with `realpath`, so `..` escapes,
  absolute paths outside the root, NUL bytes and symlinks pointing out of the tree are all
  rejected. Reads require a regular file (no FIFOs, sockets, or devices).
- **Least privilege.** `--read-only` is recommended and registers only read tools.
- **No network.** The server makes no outbound calls; there is no telemetry and no update check.
- **Prompt injection.** PDF content is untrusted input. Extraction and search output is wrapped in
  `<document-text>` delimiters with an explicit warning, and every read tool's description repeats
  that the agent must treat document text as data, never as instructions.
- **Protocol hygiene.** stdout carries JSON-RPC only; stray logging is redirected to stderr so a
  noisy dependency cannot corrupt framing.

## What it does not do

- No OCR. Scanned pages have no text layer to edit; use PDF Studio's on-device OCR first.
- No rendering, so no image extraction, thumbnails, or visual comparison.
- No certified digital signatures (it can draw a signature, not sign cryptographically).
- Replacement text uses Helvetica metrics: near-identical on exotic fonts, not glyph-perfect.

## From a clone

```bash
git clone https://github.com/Kayforkind/NavigatorsLab-PDF-Studio
cd NavigatorsLab-PDF-Studio
npm install
npm run build -w pdfstudio-mcp        # tsc + bundle → packages/mcp/dist/index.js
node packages/mcp/dist/index.js --root ./docs --read-only
```

Point a client at `packages/mcp/dist/index.js` instead of `npx`:

```json
{
  "mcpServers": {
    "pdfstudio": {
      "command": "node",
      "args": ["/abs/path/packages/mcp/dist/index.js", "--root", "/path/to/docs", "--read-only"]
    }
  }
}
```

### Tests

```bash
npm test -w pdfstudio-mcp      # unit tests: handlers, path containment, prompt-injection framing
npm run smoke -w pdfstudio-mcp # boots the BUNDLED server over stdio:
                               # handshake → tools/list → extract → redact → re-search → escape
```

The smoke test is the important one for releases: it exercises `dist/index.js`, the artifact users
actually run, not the TypeScript source.

## Publishing (maintainers)

The package ships one bundled file, with `pdfjs-dist` external and declared as a dependency.

```bash
cd packages/mcp
npm run build      # tsc typecheck/emit + esbuild bundle
npm run smoke      # 9 checks against dist/index.js — must pass
npm publish        # prepublishOnly re-runs build + smoke
```

`server.json` is the manifest for the official MCP registry; publish it with the registry's
`mcp-publisher` after the npm release. Bump `version` in **both** files together — the registry
entry points at a specific npm version.

## Companion CLI

The same engine is available as `pdfstudio` (`pdfstudio info`, `extract-text`, `search`,
`edit-text`, `redact`, `merge`, `split`, `rotate`, `pages`) for shell scripts and CI.

## License

MIT.
