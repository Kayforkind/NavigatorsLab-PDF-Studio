# r/selfhosted — paste-ready (owner posts manually)

Post type: **Text post** · Sub: r/selfhosted
Post after re-reading the sub's rules. Mention in your own words that you are the developer.

---

**Title**

I built an open-source PDF editor that runs 100% in your browser. Your files never touch a server (Docker one-liner inside)

**Body**

I'm the developer of PDF Studio. It's MIT licensed, and v1.2.0 is out.

Most PDF tools upload your document to their servers: contracts, tax forms, medical records. PDF Studio does everything in the browser with no backend, no accounts, and no analytics. Your files stay on your machine.

The feature I'm proudest of is redaction. Many "redaction" tools paint a box over the text, and the text is still there underneath. PDF Studio removes the covered text from the file at export, then scans the output for the redacted strings and refuses to deliver the file if any are still recoverable.

Self-host it:

```
docker run -d -p 8080:80 --name pdf-studio ghcr.io/kayforkind/navigatorslab-pdf-studio:latest
```

Or use the live version (same code, static hosting): https://navigatorslab.com/pdf-studio/

What's in v1.2.0:
- UI in English, Spanish, German, and French
- Edit existing text in place, forms, signatures, merge and split, annotations
- Local OCR for scanned pages (the engine ships with the app and runs offline)
- A CLI and an MCP server, so AI agents can work with PDFs. The MCP server got a security review that found and fixed a sandbox escape, and added a read-only mode.
- Docs site with the full CLI and MCP reference

Honest limitations:
- The optional on-device AI assistant downloads a model (about 0.6 GB) from Hugging Face the first time you use it. After that it runs offline.
- Text editing needs a real text layer. Scanned pages go through OCR first.
- Replacement text uses Helvetica metrics, so exotic embedded fonts may look near-identical rather than exact.
- It's a young project, so expect rough edges.
- The Docker image is amd64 only.

If you're comparing with Stirling-PDF: it has a broader toolset and a large community. PDF Studio focuses on editing and on privacy you can check yourself in the browser's network tab.

Repo: https://github.com/Kayforkind/NavigatorsLab-PDF-Studio

What PDF workflows do you wish ran locally?

---

**Before posting (checklist, for you)**
- [ ] Read the r/selfhosted sidebar rules for the day you post.
- [ ] Post as a text post, not a link.
- [ ] Be in the thread for the first hours and answer questions.
- [ ] Have answers ready: "Does it phone home?" (No, check the network tab.) "ARM build?" (amd64 only.) "How is this different from Stirling-PDF?" (editor UI and privacy you can check; smaller toolset.)
