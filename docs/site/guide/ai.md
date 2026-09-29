# On-device AI

Ask questions about your document. A real LLM runs in your browser via
WebAssembly — your data never leaves.

## How it works

1. Open a PDF and press the **✦ AI** button in the top bar.
2. On first use, pick a model. It downloads once — you see progress, and it's
   explicitly your choice.
3. Ask questions, request summaries, or extract text. The prompt (your document
   text, truncated at ~24k characters, plus your question) is built locally and
   answered **inside the in-browser engine**.

## Models

| Model | Download | Min. memory | Best for |
|---|---|---|---|
| Qwen2.5 0.5B Instruct | ~0.6 GB | ~1.6 GB | Fast Q&A and summaries |
| Llama 3.2 1B Instruct | ~0.9 GB | ~2.5 GB | Better answers, slower |

These are small models: great at summarizing and answering questions about your
document, not frontier models. **Extract text** needs no model download at all.

## Privacy

- Model weights come from **HuggingFace** — the only external host the app ever
  contacts — over TLS, downloaded once and cached in your browser.
- Your document text is **never part of any network request**. The chat runs
  inside the locally loaded engine.
- After the download, the AI works fully offline.

::: info Honest residual risk
The app does not verify integrity hashes of downloaded model weights; trust
rests on TLS + HuggingFace. A compromised weight file could misbehave, but it
cannot exfiltrate your data — the Content-Security-Policy still binds the page
(see [Security](/guide/security)).
:::
