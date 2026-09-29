# X launch thread — DRAFTS ONLY, do not publish without Kazym's explicit go

Voice: sharp dev/entrepreneur takes, no motivational fluff, no emoji spam.
Stage in X Drafts as-is. Post 2/12 carries the demo link (first reply gets the link treatment for algo).

---

**1/12**
I built an open-source PDF editor that can't see your documents.

Here's the problem it solves. 🧵

**2/12**
Every mainstream PDF tool uploads your file to their server first.

Tax returns. Contracts. Medical records. All of it, sitting on someone else's disk.

https://navigatorslab.com/pdf-studio

**3/12**
PDF Studio runs 100% in your browser. WASM + local processing. No backend, no tracking, no analytics.

Open DevTools' network tab while you use it. Nothing leaves.

**4/12**
The feature that sold me on building it: redaction.

Most PDF "redactors" paint a white box over your text. Select-all → copy → paste defeats it in 2 seconds.

**5/12**
PDF Studio's redaction actually deletes the content from the file. Select-all after redacting and there's nothing there.

If your redactor can't pass the select-all test, it's decoration.

**6/12**
Self-host it in one line:

docker run -d -p 8080:80 --name pdf-studio ghcr.io/kayforkind/navigatorslab-pdf-studio:latest

MIT licensed. Your machine, your documents.

**7/12**
v1.2.0 just shipped:
- UI in EN/ES/DE/FR
- Local OCR, forms, signatures, merge/split
- CLI + MCP server for AI agents (audited: sandbox escape fixed, read-only mode)

**8/12**
The MCP server part matters more than it looks.

Agents are about to touch everyone's documents. Ours runs with a --read-only mode and every path is realpath-resolved inside its root. We found and fixed a symlink escape before shipping.

**9/12**
Honest state of the project: it's young (v1.2.0), Stirling-PDF has 50+ tools and we don't.

Our bet: a real editor UI plus a privacy story you can verify yourself in 10 seconds.

**10/12**
If you self-host, I'd genuinely like your feedback: what PDF workflows do you wish ran locally?

Issues get same-day responses through October.

**11/12**
Repo's here. Star it if you want software that respects you.

https://github.com/Kayforkind/NavigatorsLab-PDF-Studio

**12/12**
Building in the open. Next up: the comparison page (PDF Studio vs Adobe vs Stirling-PDF, every cell verified) and more languages.

What should come first? 👇
