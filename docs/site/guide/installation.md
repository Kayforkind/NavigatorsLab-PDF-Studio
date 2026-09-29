# Installation

PDF Studio has no backend, so "installing" mostly means choosing how you open
the app. Pick one of the four options below.

## Option 1 — Use it in the browser (recommended)

Nothing to install. Open the [live app](https://navigatorslab.com/pdf-studio/)
and drop in a PDF.

This is the zero-setup option: the app, its PDF engine, OCR engine, and
(optionally) the on-device AI all run in your browser. Your files never leave
your machine.

## Option 2 — Install the PWA

PDF Studio is a Progressive Web App:

1. Open the live app in Chrome, Edge, or Safari.
2. Use your browser's **Install** / **Add to Home Screen** option.

The installed app gets a fullscreen, offline-capable window — and on phones the
tool rail docks to the bottom of the screen with thumb-reachable icons. Your
session still autosaves locally and resumes where you left off.

## Option 3 — Docker self-hosting

Zero backend, so self-hosting is one command. Images publish to GHCR on every
release:

```bash
docker run -d -p 8080:80 --name pdf-studio ghcr.io/kayforkind/navigatorslab-pdf-studio:latest
# → http://localhost:8080
```

Or with docker-compose:

```bash
docker compose up -d
# → http://localhost:8080
```

Or build the image yourself from the repo:

```bash
git clone https://github.com/Kayforkind/NavigatorsLab-PDF-Studio
cd NavigatorsLab-PDF-Studio
docker build -t pdf-studio .
docker run -d -p 8080:80 pdf-studio
```

The container serves the static `dist/` build behind nginx — your documents
still never leave the machine running it.

::: tip Air-gapped use
Serve `dist/` on an internal network and point the AI/OCR model loaders at
internal mirrors. The app makes no network calls for document data, so it works
fully offline after the first load.
:::

## Option 4 — Build from source

```bash
git clone https://github.com/Kayforkind/NavigatorsLab-PDF-Studio
cd NavigatorsLab-PDF-Studio
npm install
npm run dev        # http://localhost:5199
npm test           # test suite
npm run build      # → dist/ (relative base: works at domain root, subpath, or CDN)
```

**Stack:** TypeScript · React 19 · Vite · pdf.js (render) · pdf-lib (write) ·
Tesseract.js (OCR) · WebLLM (AI) · vite-plugin-pwa. **Zero backend.**

Good first issues are labeled `good first issue` — see
[CONTRIBUTING.md](https://github.com/Kayforkind/NavigatorsLab-PDF-Studio/blob/main/CONTRIBUTING.md).

## The CLI and MCP server

v1.1.0 added two agent-native interfaces in `packages/` that reuse the exact
same content-stream engine as the app — no new parsing code, no network calls,
document bytes never leave the machine:

```bash
npm install
npm run build:packages
```

Then run the CLI with `npx pdfstudio …` from the repo root, or make it global
with `npm link -w packages/cli` and call `pdfstudio` anywhere. The MCP server
lives at `packages/mcp/dist/index.js` after the build.

- Full reference: [CLI](/guide/cli) · [MCP server](/guide/mcp)
