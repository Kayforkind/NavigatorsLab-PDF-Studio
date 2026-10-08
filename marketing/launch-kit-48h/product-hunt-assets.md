# Product Hunt launch assets — DRAFT, do not submit without Kazym's go

## Tagline (≤60 chars)
The open-source PDF editor that can't see your documents
(57 chars)

## Name
PDF Studio

## Description (for the listing)
PDF Studio is a private-by-design, open-source PDF editor that runs 100% in your browser. Edit text, truly redact content, run local OCR, fill forms, sign, merge, and split — with zero uploads, zero tracking, and zero backend. Self-host it with one Docker command, or use it as a CLI and MCP server so AI agents can work with PDFs without exfiltrating them. MIT licensed, now in 4 languages.

## Topics
Open Source, Privacy, Developer Tools, Productivity

## Maker's first comment (post this immediately after launch goes live)
Hey PH! I'm Kazym, I built PDF Studio.

The short version: every mainstream PDF tool uploads your document to their server. I wanted an editor where that's architecturally impossible — so there's no server. It's React + TypeScript + WASM running entirely in your browser; your files never leave your machine, and you can verify that in DevTools' network tab in ten seconds.

The feature I'm proudest of: honest redaction. Most PDF redactors paint a white box over text that stays selectable underneath. Ours actually deletes the content from the file.

v1.2.0 adds Spanish/German/French UI, a full docs site, and an internally audited CLI + MCP server (we found and fixed a real sandbox escape before shipping).

It's MIT licensed and self-hosts in one line: `docker run -d -p 8080:80 --name pdf-studio ghcr.io/kayforkind/navigatorslab-pdf-studio:latest`

I'll be here all day answering questions — especially skeptical ones. Try to break the privacy story; that's the whole point.

## Launch-day notes
- PH launches flip at 12:01am PT. Be present in the comments all day — PH rewards maker presence.
- First 4 hours decide ranking. Line up the Reddit post and X thread to point at the PH page in that window (only if the 48h blitz is firing — never brigade, just let the same audience find it).
- Thumbnail: use the social-preview.png (1280x640, new NavigatorsLab logo) from the repo root.
