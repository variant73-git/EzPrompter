import { generateDesignMd } from './design-md.js';
import { extractContent } from './demarcelize.js';
import { describeSiteAsPrompt, describeImageAsTokens, describeImageAsPrompt } from './extract-llm.js';

// Render a standalone HTML string to a PNG data URL via headless Chromium.
// Used for site→Screenshot extraction (the node's snapshot HTML, not a URL).
export async function htmlToScreenshotDataUrl(html, { width = 1280, height = 800 } = {}) {
  const { launchBrowser } = await import('./browser.js');
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setViewportSize({ width, height });
    await page.setContent(html, { waitUntil: 'networkidle' });
    const buf = await page.screenshot({ type: 'png', fullPage: false });
    return `data:image/png;base64,${buf.toString('base64')}`;
  } finally {
    await browser.close();
  }
}

// Which `to` targets are valid for which source kind. Keeps the route and
// the UI honest about combos that actually have a generator.
const SITE_TARGETS = new Set(['designmd', 'content', 'screenshot', 'style', 'prompt']);
const ASSET_TARGETS = new Set(['tokens', 'prompt']);

// Normalized result the route persists. Unused fields stay null.
function result({ kind, meta, html = null, designMd = null, dataUrl = null, truncated = false }) {
  return { kind, meta, html, designMd, dataUrl, truncated };
}

/**
 * Produce a derived artifact from a source node. Pure of DB — the caller
 * persists. Returns { error } on bad input (never throws for validation);
 * generator failures reject so the route aborts before any write.
 */
export async function runExtract({ to, node, model }) {
  if (!node || !node.id) return { error: 'no_source', message: 'node required' };
  const isSite = node.kind === 'site';
  const isAsset = node.kind === 'asset' || node.kind === 'image';

  const allowed = isSite ? SITE_TARGETS : isAsset ? ASSET_TARGETS : null;
  if (!allowed) return { error: 'unsupported_combo', message: `cannot extract from kind "${node.kind}"` };
  if (!['designmd', 'content', 'screenshot', 'style', 'prompt', 'tokens'].includes(to)) {
    return { error: 'invalid_to', message: `unknown extract target "${to}"` };
  }
  if (!allowed.has(to)) return { error: 'unsupported_combo', message: `cannot extract "${to}" from a ${node.kind}` };

  const name = node.meta?.name || node.kind;

  if (isSite) {
    if (!node.html) return { error: 'no_source', message: 'site has no snapshot html' };
    switch (to) {
      case 'designmd': {
        const gen = await generateDesignMd({ html: node.html, ...(model ? { model } : {}) });
        return result({ kind: 'designmd', html: node.html, designMd: gen.md, truncated: gen.truncated,
          meta: { name: `${name} — design`, source: 'extract', extractTo: 'designmd', sourceNodeId: node.id } });
      }
      case 'content': {
        const md = await extractContent({ html: node.html, ...(model ? { model } : {}) });
        return result({ kind: 'designmd', designMd: md,
          meta: { name: `${name} — content`, source: 'extract', extractTo: 'content', sourceNodeId: node.id } });
      }
      case 'style': {
        // No LLM — keep the raw HTML as a reusable style chassis (applyDesign
        // reads the html source; run-flow's md bucket is empty here).
        return result({ kind: 'designmd', html: node.html,
          meta: { name: `${name} — style`, source: 'extract', extractTo: 'style', sourceNodeId: node.id } });
      }
      case 'screenshot': {
        const dataUrl = await htmlToScreenshotDataUrl(node.html);
        return result({ kind: 'asset', dataUrl,
          meta: { name: `${name} — screenshot`, source: 'extract', extractTo: 'screenshot', sourceNodeId: node.id } });
      }
      case 'prompt': {
        const text = await describeSiteAsPrompt({ html: node.html, ...(model ? { model } : {}) });
        return result({ kind: 'prompt',
          meta: { name: `${name} — prompt`, prompt: text, source: 'extract', extractTo: 'prompt', sourceNodeId: node.id } });
      }
    }
  }
  if (isAsset) {
    const dataUrl = node.meta?.dataUrl;
    if (!dataUrl) return { error: 'no_source', message: 'asset has no image data' };
    switch (to) {
      case 'tokens': {
        const md = await describeImageAsTokens({ dataUrl, ...(model ? { model } : {}) });
        return result({ kind: 'designmd', designMd: md,
          meta: { name: `${name} — tokens`, source: 'extract', extractTo: 'tokens', sourceNodeId: node.id } });
      }
      case 'prompt': {
        const text = await describeImageAsPrompt({ dataUrl, ...(model ? { model } : {}) });
        return result({ kind: 'prompt',
          meta: { name: `${name} — prompt`, prompt: text, source: 'extract', extractTo: 'prompt', sourceNodeId: node.id } });
      }
    }
  }
  return { error: 'not_implemented', message: `extract "${to}" not implemented yet` };
}
