/**
 * type-sample-client.js — measure a captured page's typography IN THE BROWSER
 * from its stored HTML, for site nodes captured before typeSample existed
 * (old nodes upgrade automatically — product rule). A hidden sandboxed iframe
 * (no scripts) renders the capture; computed styles give family/size/weight.
 * Zero LLM. Best-effort: returns null when nothing measurable.
 */

function pickRole(doc, selectors) {
  for (const sel of selectors) {
    let el = null;
    try { el = [...doc.querySelectorAll(sel)].find((cand) => (cand.textContent || '').trim().length > 2); } catch { /* bad selector */ }
    if (el) {
      const cs = doc.defaultView.getComputedStyle(el);
      const family = (cs.fontFamily.split(',')[0] || '').replace(/["']/g, '').trim();
      const size = Math.round(parseFloat(cs.fontSize) || 0);
      if (family && size > 0) return { family, size, weight: Number(cs.fontWeight) || 400 };
    }
  }
  return null;
}

export async function sampleTypeFromHtml(html) {
  if (!html || typeof document === 'undefined') return null;
  const frame = document.createElement('iframe');
  // allow-same-origin (we must read computed styles) but NO scripts — the
  // capture renders inert, exactly like the node body preview does.
  frame.setAttribute('sandbox', 'allow-same-origin');
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:1280px;height:800px;visibility:hidden;pointer-events:none;';
  document.body.appendChild(frame);
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('type-sample timeout')), 8000);
      frame.onload = () => { clearTimeout(timer); resolve(); };
      frame.srcdoc = html;
    });
    // One settle frame so stylesheets inside the srcdoc apply.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const doc = frame.contentDocument;
    if (!doc) return null;
    const display = pickRole(doc, ['h1', 'h2', '[class*="hero"] *']);
    const body = pickRole(doc, ['main p', 'p', 'body']);
    return (display || body) ? { display, body } : null;
  } catch {
    return null;
  } finally {
    frame.remove();
  }
}
