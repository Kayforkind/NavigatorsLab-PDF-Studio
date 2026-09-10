/* Edge worker for PDF Studio at https://navigatorslab.com/pdf-studio/
 *
 * Serves the static app from the ASSETS binding under the /pdf-studio/
 * route prefix, mirroring the tools worker's proven pattern: path-route
 * assets workers must map the request path themselves (an assets-only
 * worker would look up "pdf-studio/index.html" inside the namespace and
 * 404). */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    let path = url.pathname.replace(/^\/pdf-studio/, '') || '/';
    if (path === '/' || path.endsWith('/')) path += 'index.html';
    if (!path.startsWith('/')) path = '/' + path;
    const asset = await env.ASSETS.fetch(new Request(new URL(path, url.origin), request));
    return new Response(asset.body, asset);
  },
};