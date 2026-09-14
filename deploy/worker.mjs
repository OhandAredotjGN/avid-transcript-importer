// Routing and security headers only. Transcript processing never reaches this Worker.
const BASE = '/TranscriptTamer';
const CSP = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'none'";
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', {status:405, headers:{Allow:'GET, HEAD'}});
    if (url.pathname === '/' || /^\/transcripttamer\/?$/i.test(url.pathname) && url.pathname !== BASE) {
      url.pathname = BASE;
      return Response.redirect(url, 308);
    }
    if (url.pathname !== BASE && !url.pathname.startsWith(BASE + '/')) return new Response('Not found', {status:404});
    if (url.pathname === BASE) url.pathname = BASE + '/index.html';
    const asset = await env.ASSETS.fetch(new Request(url, request));
    const response = new Response(asset.body, asset);
    response.headers.set('Content-Security-Policy', CSP);
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    response.headers.set('X-Frame-Options', 'DENY');
    response.headers.set('Cache-Control', 'public, no-transform, max-age=0, must-revalidate');
    return response;
  }
};
