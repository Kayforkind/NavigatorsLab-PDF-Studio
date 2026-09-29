/* Edge worker for PDF Studio at https://navigatorslab.com/pdf-studio/
 *
 * Serves the static app from the ASSETS binding under the /pdf-studio/
 * route prefix, mirroring the tools worker's proven pattern: path-route
 * assets workers must map the request path themselves (an assets-only
 * worker would look up "pdf-studio/index.html" inside the namespace and
 * 404).
 *
 * Security: stamps OWASP-recommended headers on every response. The CSP is
 * tailored to what this app actually does at runtime:
 *  - scripts only from this origin (+ 'wasm-unsafe-eval' so tesseract.js /
 *    pdf.js / web-llm can compile WebAssembly without full 'unsafe-eval')
 *  - workers from this origin or blob: (pdf.js + tesseract spawn blob workers)
 *  - inline styles allowed (React sets element styles at runtime)
 *  - images/fonts from self, data: and blob: (canvas rendering, stamps)
 *  - network only to self, blob: and HuggingFace (one-time AI model download,
 *    user-initiated; document bytes never leave the device)
 *  - no framing, no form posts, no plugins
 */
const SEC_HEADERS = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Content-Security-Policy':
    "default-src 'none'; " +
    "script-src 'self' 'wasm-unsafe-eval'; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: blob:; " +
    "font-src 'self' data:; " +
    'connect-src \'self\' blob: https://huggingface.co https://*.huggingface.co; ' +
    "worker-src 'self' blob:; " +
    "media-src 'self' blob:; " +
    "object-src 'none'; " +
    "base-uri 'self'; " +
    "form-action 'none'; " +
    "frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    let path = url.pathname.replace(/^\/pdf-studio/, '') || '/';
    // /pdf-studio/doc was the published launch-thread link for the
    // comparison page — redirect it to the docs comparison page.
    if (path === '/doc' || path === '/doc/') {
      return Response.redirect(
        'https://navigatorslab.com/pdf-studio/docs/comparison.html', 301);
    }
    if (path === '/' || path.endsWith('/')) path += 'index.html';
    if (!path.startsWith('/')) path = '/' + path;
    const asset = await env.ASSETS.fetch(new Request(new URL(path, url.origin), request));
    const headers = new Headers(asset.headers);
    for (const [k, v] of Object.entries(SEC_HEADERS)) headers.set(k, v);
    return new Response(asset.body, {
      status: asset.status,
      statusText: asset.statusText,
      headers,
    });
  },
};
