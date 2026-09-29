# PDF Studio — Scoped Plans: Translation Infra + Docs Site

Prepared 2026-09-28 as part of the repo hygiene sprint. Neither is built yet; both need Kazym's go-ahead.

---

## A. Translation infrastructure (Crowdin)

**Why:** Stirling-PDF's 40+ Crowdin languages turned each language community into a distribution channel. This is the proven long-tail flywheel for PDF tools.

**Current state:** UI strings are hardcoded in React components (`src/`). No i18n framework.

**Scope:**

1. Add `react-i18next` + `i18next` to the app (~1 day)
   - Wrap all user-facing strings in `t()` calls. The app has a large string surface (toolbar labels, dialogs, tooltips) — estimate ~300-500 strings.
   - Add language switcher to the topbar/settings (persist to localStorage).
   - Ship with English as the source language; extract `en.json`.
2. Set up Crowdin project (free for open source) (~2 hours)
   - Connect the GitHub repo via the Crowdin GitHub Action: source `public/locales/en.json`, auto-PR translations back.
   - Apply at crowdin.com (open-source license approval usually < 48h).
3. Pilot one language end-to-end (~2-3 hours)
   - Machine-translate Spanish via Crowdin MT as the seed, then recruit one native reviewer from the community.
4. Add a "Help translate" link in README + app footer pointing at the Crowdin project.

**Effort estimate:** 2-3 focused days for the i18n retrofit + Crowdin wiring; translations then compound for free.

**Sequencing note:** do this AFTER the MCP/CLI packages land (they add CLI strings too) to avoid double string-extraction work. Target v1.2.0.

**Risks:** string churn in early versions makes translators redo work — freeze UI copy for one release cycle first.

---

## B. Docs site

**Why:** docs-as-marketing (SEO surface, linkable guides, tutorial SEO like "how to redact a PDF properly") + reduces support load. Paperless-ngx and Stirling-PDF both run docs sites.

**Scope — recommended: VitePress on GitHub Pages (free, zero infra):**

1. Add `docs/` VitePress project (~1 day)
   - Pages: Getting started, Features (one page per major feature with screenshots), Privacy architecture, Self-hosting (Docker), FAQ, Contributing, Changelog (link releases).
   - Reuse the existing README content as the seed — most copy already exists.
2. Deploy via the existing `.github/workflows/deploy-pages.yml` pattern (~2 hours)
   - Build docs to `gh-pages` branch; serve at `navigatorslab.com/pdf-studio/docs/` or `docs.navigatorslab.com` via the Cloudflare worker route.
3. SEO basics (~2 hours)
   - Title/meta per page, sitemap, canonical URLs. The redact-tutorial article (already drafted for dev.to) becomes the first docs guide with the canonical URL here.

**Effort estimate:** 1.5-2 days total.

**Alternative (cheaper):** skip the separate site and expand README + EXAMPLES.md. Saves ~1 day but loses the SEO surface. Recommend the VitePress route only after the Show HN / Reddit launch sequence is done — docs don't drive launches, launches drive docs traffic.

**Sequencing:** after v1.1.0 (MCP/CLI documented together with the app).

---

## Recommended order

1. v1.1.0: MCP server + CLI (sibling agent, in progress) → document in README + release notes
2. v1.2.0: i18n retrofit + Crowdin (plan A above)
3. Post-launch: docs site (plan B above), once launch traffic justifies it
