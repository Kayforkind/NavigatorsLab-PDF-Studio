# Reddit r/selfhosted launch post — DRAFT, DO NOT POST without Kazym's go

Fires from Kazym's account (u/kazimrmerchantt). Text post, not a link post.
Re-confirm the sub's sidebar rules the morning of posting.

---

**Title:**
I built an open-source PDF editor that runs 100% in your browser — your files never touch a server (Docker one-liner inside)

**Body:**

Full disclosure: I'm the developer, this is my project. It's called PDF Studio, it's MIT licensed, and v1.2.0 just dropped.

The pitch is simple: every mainstream PDF tool uploads your document to their server. Tax returns, contracts, medical records. PDF Studio does everything client-side — React + TypeScript + WASM, no backend, no tracking, no analytics. Your bytes never leave the machine.

The feature I'm proudest of is redaction. Most PDF "redactors" just paint a white box over the text — you can select-all, copy, and paste the "redacted" content in about two seconds. PDF Studio actually deletes the content from the file. Try the demo and select-all after redacting: there's nothing there.

Self-host it:

```
docker run -d -p 8080:80 --name pdf-studio ghcr.io/kayforkind/navigatorslab-pdf-studio:latest
```

Or just use the live demo (same code, static hosting): https://navigatorslab.com/pdf-studio

What else is in v1.2.0:
- Full UI in English, Spanish, German, French
- Local OCR (Tesseract WASM), form filling, signatures, merge/split
- A CLI and an MCP server, so AI agents can work with PDFs without exfiltrating them — the MCP server just passed an independent security audit (sandbox escape fixed, read-only mode added)
- Docs site with the full CLI/MCP reference

Honest limitations:
- First OCR run downloads ~8MB of model weights from Hugging Face (one time, disclosed in the UI). Everything after that is offline.
- It's a young project — v1.2.0, so expect rough edges. Issues and PRs get same-day responses through October.
- If you're comparing with Stirling-PDF: they're the powerhouse (50+ tools, huge community). PDF Studio's bet is different — a full editor UI plus a privacy story you can verify in DevTools' network tab.

Repo: https://github.com/Kayforkind/NavigatorsLab-PDF-Studio

Genuinely want feedback from people who self-host: what PDF workflows do you wish ran locally?

---

**Posting checklist (Kazym, morning of):**
- [ ] Re-read r/selfhosted sidebar rules (self-promo must be genuinely self-hostable + disclosed — both true here)
- [ ] Post as text post Tuesday-Thursday, ~9am CT for max US/EU overlap
- [ ] Stay in the thread all day — answer every question, including hostile ones, no defensiveness
- [ ] Have honest answers ready: "does it phone home?" (no, verify in DevTools), "ARM build?" (the image is amd64 — say so), "how is this different from Stirling-PDF?" (editor UI + verified privacy, smaller toolset)
