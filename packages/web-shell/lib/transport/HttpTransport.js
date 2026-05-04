/**
 * HttpTransport — UncraftTransport implementation for the web shell (Next.js).
 * Routes editor-core's transport calls to web-shell API routes that own the
 * server-side LLM keys, Playwright capture, and asset relay.
 *
 * Used by canvas Node iframes that mount editor-core via mountEditor({ transport }).
 */

export function createHttpTransport({ baseUrl = '/api', boardId, nodeId } = {}) {
  async function post(path, body) {
    const r = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ ...body, boardId, nodeId })
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      throw new Error(`${path} ${r.status}: ${text || r.statusText}`);
    }
    return r.json();
  }

  return {
    async callLLM(req) {
      return post('/llm/call', { request: req });
    },
    async capture(viewport) {
      return post('/snapshot/capture-viewport', { viewport });
    },
    async storeKey(name, value) {
      await post('/keys/store', { name, value });
    },
    async readKey(name) {
      const r = await post('/keys/read', { name });
      return r?.value ?? null;
    },
    async injectCSS(target, css) {
      if (target === 'self' && typeof document !== 'undefined') {
        const style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);
      }
    },
    async scrapeURL(url) {
      return post('/snapshot/capture', { url });
    }
  };
}
