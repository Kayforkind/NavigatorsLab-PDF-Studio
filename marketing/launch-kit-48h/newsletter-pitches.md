# Newsletter pitches — DRAFTS, send only on Kazym's go (48h blitz window)

## 1. Console.dev — follow-up (already pitched 2026-09-28)

Subject: Follow-up: PDF Studio v1.2.0 — the private-by-design PDF editor, now with audited AI interfaces

Hi,

Following up on my note from last week — PDF Studio (the open-source, 100%-client-side PDF editor) just shipped v1.2.0, and there's a new angle since we last spoke:

- **Audited for agents:** we put the CLI and MCP server through an internal security re-audit against the project's threat model. Found and fixed a real sandbox escape (symlink breakout from `--root`), added a `--read-only` MCP mode, and hardened untrusted-text delimiters. Full report: docs/SECURITY_ASSESSMENT_AGENTS.md in the repo.
- **Four languages:** full UI localization in Spanish, German, French (+English).
- **Docs site:** complete CLI/MCP references, security model, FAQ.
- **Still zero backend:** every byte stays on-device — verifiable in DevTools.

The privacy-engineering angle: we proved a browser app can do what Adobe does without a server, and now we're proving AI agents can touch documents without exfiltrating them.

Links: https://github.com/Kayforkind/NavigatorsLab-PDF-Studio · https://navigatorslab.com/pdf-studio

Happy to do a technical Q&A on the sandboxing work if that's useful.

— Kazym

## 2. TLDR Newsletter — new pitch

Subject: Open-source, self-hostable PDF editor with zero backend

Angle: TLDR's audience is builders who self-host. Lead with the one-line Docker deploy and the "verify in DevTools" privacy story. Keep it under 120 words, link the repo and the live demo. Mention Hacktoberfest participation (good-first-issues, same-day reviews) — TLDR readers contribute.

## 3. Bytes / JavaScript Weekly — new pitch

Subject: A full PDF editor in the browser with no server — React + TS + WASM

Angle: this is a technical-architecture story for a JS audience. How do you do real PDF editing, OCR (Tesseract WASM), and true redaction with no backend? Bundle discipline, worker threading, and the security model (what the threat model covers, what it explicitly doesn't). Offer a written technical deep-dive, not a product pitch.

## 4. Changelog Weekly — new pitch

Angle: the open-source story. Solo founder, MIT, building a privacy-respecting alternative to Adobe in the open, Hacktoberfest-friendly. The "why" narrative: every PDF tool uploads your documents; this one architecturally can't.

---

**Send order in the blitz:** Console.dev follow-up first (warm lead), then TLDR, then Bytes/JS Weekly, then Changelog — spaced ~3 hours apart inside the 48h window so each lands in a different inbox cycle.
