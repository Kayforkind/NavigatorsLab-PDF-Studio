# README "Security" section — INSERT AS-IS (do not edit README.md directly)

Paste the block below into README.md at the spot the repo coordinator chooses
(suggested: after the "Privacy — absolute, by architecture" section).

---

## Security

[![Security: A-](https://img.shields.io/badge/security-A--brightgreen?style=for-the-badge)](./docs/SECURITY_ASSESSMENT.md)
[![Audit: 2026-09-28](https://img.shields.io/badge/audit-2026--09--28-blue?style=for-the-badge)](./docs/SECURITY_ASSESSMENT.md)
[![Vuln policy](https://img.shields.io/badge/vulnerability_policy-SECURITY.md-lightgrey?style=for-the-badge)](./SECURITY.md)

**Independent security audit — 2026-09-28 — overall grade: A−.** Every claim below
was verified against the source code, not asserted. [Full assessment with code
references](./docs/SECURITY_ASSESSMENT.md) · [Vulnerability reporting policy](./SECURITY.md)

| Category | Grade | Verdict |
|---|---|---|
| Data exfiltration | **A** | Zero network calls carry document bytes — verified by exhaustive audit of `src/`. The only external host the app ever contacts is HuggingFace, for one-time AI model downloads you trigger yourself. |
| XSS / injection | **A** | No `innerHTML`-class sinks anywhere; pages render to canvas; hostile PDFs are inert pixels and escaped text. |
| Supply chain | **A−** | Every runtime byte is self-hosted; CDN fallbacks are overridden and CSP-blocked. |
| Dependencies | **A** | 0 known vulnerabilities in shipped dependencies (OSV scan of pinned versions). |
| Local data | **A−** | Autosave lives only in your browser's localStorage; the one-click wipe deletes all of it (tested). |
| Security headers | **A** | Strict Content-Security-Policy, HSTS, no-framing, no referrer leakage — stamped on every response. |

**Residual risks (stated plainly):** autosave is plaintext on your disk, so wipe
after use on a shared machine; AI model weights come from HuggingFace over TLS
without hash verification. Neither lets data leave your device.

Found something? Please report it privately — see [SECURITY.md](./SECURITY.md).
