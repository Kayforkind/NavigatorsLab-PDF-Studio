<!-- SECURITY SECTION for the PDF Studio app page (~/workspace/navsite/worker-home/dist/apps/pdf-studio.html)
     Drop-in HTML snippet. Styling hooks use generic class names; adapt to the page's
     existing CSS conventions when wiring in. All claims verified in the 2026-09-28 audit. -->

<section class="security" id="security">
  <h2>Security, verified — not promised</h2>
  <p class="security-grade">
    Internal security audit · 2026-09-28 ·
    <strong>Overall grade: A−</strong>
  </p>

  <table class="security-scores">
    <thead>
      <tr><th>Category</th><th>Grade</th><th>What was proven</th></tr>
    </thead>
    <tbody>
      <tr><td>Data exfiltration</td><td><strong>A</strong></td><td>No code path sends document bytes anywhere — verified by auditing every network call in the source.</td></tr>
      <tr><td>XSS / injection</td><td><strong>A</strong></td><td>Zero <code>innerHTML</code>-class sinks; pages render to canvas; hostile PDFs are inert.</td></tr>
      <tr><td>Supply chain</td><td><strong>A−</strong></td><td>All runtime code self-hosted; CDN fallbacks overridden and blocked by policy.</td></tr>
      <tr><td>Dependencies</td><td><strong>A</strong></td><td>Zero known vulnerabilities in shipped dependencies (<code>npm audit --omit=dev</code>, run in CI).</td></tr>
      <tr><td>Local data</td><td><strong>A−</strong></td><td>Autosave stays in your browser; one-click wipe deletes all of it.</td></tr>
      <tr><td>Security headers</td><td><strong>A</strong></td><td>Strict Content-Security-Policy, HSTS, no framing, no referrer leakage.</td></tr>
    </tbody>
  </table>

  <ul class="security-proofs">
    <li><strong>No uploads, structurally.</strong> The app contains zero <code>fetch</code> / XHR / WebSocket calls for document data — and the Content-Security-Policy forbids the browser from contacting any host except the app itself and HuggingFace (one-time AI model downloads you trigger). Even a bug couldn't phone home.</li>
    <li><strong>Hostile PDFs can't hack the page.</strong> PDF pages are painted as canvas pixels and all extracted text is escaped — there is no HTML injection surface for a malicious document to exploit.</li>
    <li><strong>Your disk, your data.</strong> Autosave keeps full document state in your browser's local storage so you can resume after closing the tab — and the one-click wipe removes every trace. Nothing is ever transmitted.</li>
    <li><strong>AI that can't leak.</strong> The optional on-device assistant downloads public model weights once, then runs entirely in your browser via WebAssembly. Your questions and document text never leave the machine.</li>
  </ul>

  <p class="security-links">
    <a href="https://github.com/Kayforkind/NavigatorsLab-PDF-Studio/blob/main/docs/SECURITY_ASSESSMENT.md">Read the full assessment (methodology, code references, residual risks)</a>
    ·
    <a href="https://github.com/Kayforkind/NavigatorsLab-PDF-Studio/blob/main/SECURITY.md">Report a vulnerability</a>
  </p>
</section>
