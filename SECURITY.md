# Security Policy — PDF Studio

## Reporting a vulnerability

If you find a security issue in PDF Studio, **do not open a public GitHub issue**.
Email the maintainer directly:

- **Contact:** Kazym — `kazim.r.merchant@gmail.com`
- **Subject line:** `[SECURITY] PDF Studio — <short description>`

Please include:

1. What you found and where (file/URL, steps to reproduce).
2. What an attacker could do with it (impact).
3. Whether it affects document confidentiality — that's our highest-severity class.

## Scope

In scope:

- The web app (`src/`, `index.html`, `worker.js`, `vite.config.ts`) — anything that could
  leak document bytes off the device, execute injected script, or bypass the
  Content-Security-Policy.
- The PWA service worker caching behavior.
- `packages/mcp` and `packages/cli` once published — path traversal, prompt injection
  via malicious PDFs, shell-out hygiene.

Out of scope:

- The hosting provider's infrastructure (Cloudflare).
- Third-party model hosts (HuggingFace) beyond what our code requests.
- Social engineering, physical device access.

## What happens next

- **Acknowledgement** within 72 hours.
- **Triage and severity rating** within 7 days, using the rubric in
  `docs/SECURITY_ASSESSMENT.md` (document-confidentiality issues are treated as critical).
- **Fix and disclosure:** we fix first, then publish a brief advisory. If you reported
  it, you're credited (or anonymous — your choice).

## Safe harbor

Good-faith security research against PDF Studio is welcome. Don't exfiltrate other
people's data, don't degrade the live site, and stay within the scope above.
