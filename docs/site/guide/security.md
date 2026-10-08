# Security & privacy

PDF Studio is private **by architecture, not by policy**. This page summarizes
the privacy design and the internal security audit. For the full assessment
with code references, see
[`docs/SECURITY_ASSESSMENT.md`](https://github.com/Kayforkind/NavigatorsLab-PDF-Studio/blob/main/docs/SECURITY_ASSESSMENT.md)
in the repo.

## Privacy architecture

| Question | Answer |
|---|---|
| Where do my files go? | **Nowhere.** There is no upload endpoint. Open devtools while you edit: your document bytes never leave the machine. |
| Is any of my data collected? | **No.** No accounts, no analytics on your documents. Sessions autosave **locally in your browser**. |
| What *does* download? | The app itself, plus optional public AI/OCR model weights (cached after first fetch). Your documents never transit the network. |
| Can I air-gap it? | **Yes.** Serve `dist/` on an internal network and point the model loaders at internal mirrors. |

- **No server.** The app is a static build; there is no backend to upload to.
- **No tracking, no analytics.** Nothing about your documents is collected.
- **The only external host ever contacted is HuggingFace**, for one-time,
  user-initiated AI model downloads. Document content is never part of those
  requests — prompts run inside the locally loaded engine.
- **Autosave is local-only** (`localStorage`), with a one-click wipe that
  deletes all of it.

## Internal audit — 2026-09-28 — overall grade: A−

The audit was a defensive, owner-authorized static analysis of every network
call, DOM sink, storage write, and runtime dependency in the source tree, plus
a CSP review and an OSV vulnerability scan of pinned dependencies. Every claim
was verified against the source code, not asserted.

| Category | Grade | Verdict |
|---|---|---|
| Data exfiltration | **A** | Zero network calls carry document bytes — verified by exhaustive audit of `src/`. |
| XSS / injection | **A** | No `innerHTML`-class sinks anywhere; pages render to canvas; hostile PDFs are inert pixels and escaped text. |
| Supply chain | **A−** | Every runtime byte is self-hosted; CDN fallbacks are overridden and CSP-blocked. |
| Dependencies | **A** | 0 known vulnerabilities in shipped dependencies (OSV scan of pinned versions). |
| Local data | **A−** | Autosave lives only in your browser's localStorage; the one-click wipe deletes all of it (tested). |
| Security headers | **A** | Strict Content-Security-Policy, HSTS, no-framing, no referrer leakage — stamped on every response. |

**No medium, high, or critical findings.**

## Stated plainly: residual risks

- **Autosave is plaintext on your disk.** On a shared machine, wipe after use
  (or use a private window, where storage evaporates on close).
- **AI model weights come from HuggingFace over TLS without hash verification.**
  A compromised weight file could misbehave, but it cannot exfiltrate — the CSP
  still binds the page.

Neither lets data leave your device.

## MCP server & CLI controls

The v1.1.0 agent interfaces were built against the audit's threat model:

- **Path containment** — every path is `realpath()`-canonicalized and must stay
  inside `--root`; `..` escapes, absolute paths outside the root, NUL bytes, and
  symlink escapes are rejected.
- **stdio only** — no network listeners; logging goes to stderr so the
  JSON-RPC channel stays clean.
- **Prompt-injection hardening** — extracted text is wrapped in delimiters and
  marked untrusted on every tool; per-call output capped at 50,000 characters.
- **Read-only tier** — `pdf_info`, `pdf_extract_text`, `pdf_search_text` never
  modify files.
- **No shell-outs** — all parsing is in-process (pdf.js / pdf-lib).

## Report a vulnerability

Found a security issue? **Do not open a public GitHub issue.** Email the
maintainer directly:

- **Contact:** Kazym — `kazim.r.merchant@gmail.com`
- **Subject:** `[SECURITY] PDF Studio — <short description>`

Include what you found and where, what an attacker could do with it, and whether
it affects document confidentiality — that's the highest-severity class. Expect
acknowledgement within 72 hours. See
[`SECURITY.md`](https://github.com/Kayforkind/NavigatorsLab-PDF-Studio/blob/main/SECURITY.md)
for the full policy.
