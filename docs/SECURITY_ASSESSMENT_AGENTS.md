# PDF Studio — Agentic Interfaces Security Addendum

**Date:** 2026-09-28 · **Auditor:** follow-up internal audit (defensive, owner-authorized)
**Scope:** `packages/core` (Node-safe PDF engine), `packages/cli` (the `pdfstudio`
binary, 9 commands), `packages/mcp` (stdio MCP server, 10 tools) — as shipped in
**v1.1.0**.
**Parent document:** [SECURITY_ASSESSMENT.md](./SECURITY_ASSESSMENT.md) §8, which set
the threat model and mandatory controls while the code had not yet landed. This
addendum is the re-audit §8 called for, performed against the real code.

**Method:** full read of every source file in the three packages; targeted
proof-of-concept exploit for path containment; repo-wide grep for network
primitives (`fetch(`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, `EventSource`,
`http.get`), shell-outs (`child_process`, `exec`, `spawn`, `shell: true`),
`eval`/`new Function`, and `process.env` reads; OSV scan of the three new
runtime dependencies; adversarial-PDF framing tests; full test suites +
per-package `tsc -b`.

> **Bottom line:** the agentic interfaces honor the same "private by design"
> promise as the web app — zero network calls anywhere in the stack, no
> shell-outs, redaction that deletes bytes instead of covering them. The audit
> found **one real vulnerability (symlink escape in the MCP path containment,
> Medium)** — fixed during this audit with regression tests — plus three
> low-severity hardenings, all fixed. No finding contradicts the privacy claims.

---

## Agentic security score

| Category | Grade | One-line verdict |
|---|---|---|
| File containment (MCP `--root`) | **A−** | `realpath()`-before-check containment, regular-file-only reads, 5 containment tests. Deduction: check-then-act TOCTOU window (inherent, impact bounded — see residual). |
| Prompt-injection boundary | **A** | Every text output wrapped in `<document-text>` delimiters with an explicit UNTRUSTED notice; adversarial-PDF tests pin the framing. |
| stdio transport / protocol | **A** | stdio only, no listeners; `console.log/info/debug` rerouted to stderr so a noisy dependency can never corrupt JSON-RPC; no env leakage. |
| CLI input validation | **A** | No shell-outs (verified by grep); page ranges, angles, rects validated; exit codes 0/1/2; no document content in error output. |
| Redaction honesty | **A** | Vector-only deletion; pages with image XObjects or non-invertible fonts are skipped with reasons, never covered; `rebuildClean` drops orphaned streams so redacted bytes are gone from the file. |
| Dependencies (new in v1.1.0) | **A** | `npm audit`: 0 known vulns on the lockfile (re-checked 2026-10-08); the three new deps `commander@14.0.3`, `zod@3.25.76`, `@modelcontextprotocol/sdk@1.31.0` were OSV-clean on 2026-09-28. (`pdf-lib`, `pdfjs-dist` covered in the parent assessment.) |
| Secrets | **A** | Architecture needs no secrets; zero `process.env` reads in the packages. |

**Agentic interfaces overall: A−.** Consistent with the web app's A−; no change
to the headline grade.

### What changed vs §8's requirements

| §8 requirement | Status in shipped code |
|---|---|
| 8.1 Tier the tools; gate destructive ones | **Partial → hardened.** All 10 tools ship ungated (MCP has no server-driven confirmation primitive; destructive ops rely on the host app's approval UX). **Added `--read-only`**: registers only the 3 read tools, giving users a least-privilege default to opt into. |
| 8.1 No ambient authority | ✓ Every tool touches only explicitly passed paths under `--root` (default: cwd). |
| 8.2 Canonicalize then contain (realpath) | **Was violated → fixed (F-A1).** Containment was lexical-only; a symlink inside the root pointing outside was followed. Now `realpathSync` on the longest existing prefix before the check. |
| 8.2 Regular-file check | **Added (F-A1).** Reads reject FIFOs/sockets/devices/directories. |
| 8.2 No silent overwrite | **Deviation, documented.** Outputs overwrite without an `overwrite:` flag — matches CLI semantics; the agent explicitly names every output. Noted as accepted. |
| 8.3 Frame extracted content as untrusted | ✓ `<document-text>` delimiters + UNTRUSTED notice on extract; **extended to search snippets (F-A3)**. |
| 8.3 No auto-chaining | ✓ Tools never invoke other tools. |
| 8.3 Confirmation for side effects | Relies on MCP host approval UX (protocol has no server-side confirm primitive). Documented. |
| 8.3 Adversarial tests | **Added (F-A3).** PDFs with embedded instruction text assert the framing holds. |
| 8.4 No network listeners | ✓ stdio only. |
| 8.4 Keep stdout sacred | ✓ `console.log/info/debug` → stderr; `warn`/`error` already go to stderr natively. |
| 8.4 Env hygiene / no doc content in logs | ✓ No env reads; nothing is written to log files. |
| 8.5 No shell-outs | ✓ Verified by grep: zero `child_process`/`exec`/`spawn` in package sources. |
| 8.5 Input validation | ✓ Page ranges, 90°-multiple angles, rect geometry all validated. |
| 8.5 Temp files | n/a — no temp files; everything is in-memory. |
| 8.5 Exit codes / error hygiene | ✓ 0/1/2; errors carry user-supplied paths only, never document content. |
| 8.6 Secrets | ✓ None needed; none read. |

---

## Findings

| ID | Severity | Status | Finding |
|---|---|---|---|
| F-A1 | **Medium** | **Fixed** | **Symlink escape in MCP path containment.** `resolveWithin()` used lexical `resolve()` only. A symlink planted inside `--root` pointing outside (e.g. `docs/link.pdf` → `/etc/passwd`, or a symlinked directory) passed the `relative()` check, and `readFileSync`/`writeFileSync` then followed it — full read/write outside the root. Proven with a PoC. The builder's handoff claimed symlink-escape prevention; the tests never covered it. **Fix:** `realpathSync()` the longest existing prefix *before* the containment check; canonicalize the root too; `readPdf` additionally requires a regular file (`statSync().isFile()`), closing the FIFO-hang vector. 5 new tests: file-symlink escape, dir-symlink escape, write-through-symlink escape, directory-as-input rejection, plus the pre-existing traversal tests. |
| F-A2 | Low | **Fixed** | **No least-privilege mode.** §8.1 asked for write tools disabled by default or an opt-in. All 10 tools registered unconditionally. **Fix:** `--read-only` flag on `pdfstudio-mcp` registers only `pdf_info`, `pdf_extract_text`, `pdf_search_text`. Registered-tool counts pinned in tests (3 vs 10). |
| F-A3 | Low | **Fixed** | **Search snippets lacked the untrusted delimiters.** `pdf_extract_text` wrapped output in `<document-text>` but `pdf_search_text` emitted bare snippets with only the notice line. **Fix:** snippets now wrapped identically; 2 adversarial-PDF tests assert the framing (embedded "ignore previous instructions" text stays delimited and flagged). |
| F-A4 | Info | **Fixed** | **CLI `split -o -` with multiple ranges** concatenated several PDFs to stdout (garbled, unusable). Now refused with a clear error. |
| — | Info | Accepted | **TOCTOU window**: containment is check-then-act; a symlink swapped between `realpathSync` and `readFileSync` is not defended. Accepted: the server runs with the invoking user's own privileges against the user's own `--root`, so a successful race gains nothing the user doesn't already have. |
| — | Info | Accepted | **Silent overwrite** of MCP outputs (see §8.2 deviation above). |
| — | Info | Accepted | **Destructive-tool confirmation** relies on the MCP host's approval UX; the protocol offers no server-driven confirm primitive. `--read-only` is the server-side least-privilege answer. |

No high or critical findings.

---

## Verification evidence

- **Exploit PoC (pre-fix):** symlink `root/link.txt` → outside `secret.txt`; lexical `resolveWithin` returned the in-root path and `readFileSync` returned `TOP-SECRET`. Post-fix: `resolveWithin` throws `/escapes/`.
- **Network grep:** `fetch(|XMLHttpRequest|WebSocket|sendBeacon|EventSource|http.get` across `packages/*/src` (excluding tests) → **zero hits**.
- **Shell-out grep:** `child_process|exec(|spawn(|shell:` → zero hits (only regex `.exec(` matches).
- **Eval/env grep:** `eval|new Function|process.env` → zero hits.
- **OSV `querybatch` (2026-09-28):** `commander@14.0.3`, `zod@3.25.76`, `@modelcontextprotocol/sdk@1.31.0` → **0 vulnerabilities** each. Current check: `npm audit --omit=dev` (CI).
- **Redaction honesty:** `planVectorRedaction` returns `null` for pages with image XObjects (`src/lib/textRewrite.ts:919`); `edit.ts` surfaces those as `skipped` with reasons; `rebuildClean` copies pages into a fresh `PDFDocument` so orphaned content streams (edited-out bytes) are dropped from the output file.
- **Tests:** core 17/17 · cli 9/9 · mcp 20/20 (12 pre-existing + 8 new security tests) · per-package `tsc -b` clean.
- **Note:** root `tsc -b` currently fails on `src/i18n.ts` (`initReactI18n` is not an export of `react-i18next`) — pre-existing, unrelated to this audit; a sibling agent's in-progress translations work. Flagged, not touched.

## Reproduction / re-audit notes

- Symlink tests: `packages/mcp/src/server.test.ts` → "path containment" + "prompt-injection framing" + "read-only mode" describes.
- Read-only: `node packages/mcp/dist/index.js --root DIR --read-only` then list tools — only the 3 read tools appear.
- Containment: `resolveWithin` is exported from `packages/mcp/src/index.ts` for direct unit testing.
- Re-run `npm audit` before each release: `commander`, `zod`, `@modelcontextprotocol/sdk` are the new long-lived deps.
