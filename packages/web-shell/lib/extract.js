import { generateDesignMd } from './design-md.js';
import { extractContent } from './demarcelize.js';
import { describeSiteAsPrompt, describeImageAsTokens, describeImageAsPrompt, cloneImageToHtml } from './extract-llm.js';
import { embedClonedImageRegions } from './clone-images.js';

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
const SITE_TARGETS = new Set(['designmd', 'content', 'screenshot', 'style', 'prompt', 'html']);
// 'clone' = full faithful site from the image; 'styleclone' = clone in the
// background, then a design.md derived from that real clone (high precision).
const ASSET_TARGETS = new Set(['tokens', 'prompt', 'clone', 'styleclone']);

// Normalized result the route persists. Unused fields stay null.
function result({ kind, meta, html = null, designMd = null, dataUrl = null, truncated = false }) {
  return { kind, meta, html, designMd, dataUrl, truncated };
}

// extractContent() returns a structured content object; turn it into a
// readable markdown document for the .md (designmd) node body.
function contentToMarkdown(c) {
  if (!c || typeof c !== 'object') return String(c ?? '');
  const lines = [];
  if (c.brand) lines.push(`# ${c.brand}`);
  if (c.tagline) lines.push(`\n${c.tagline}`);
  if (c.hero) {
    lines.push('\n## Hero');
    if (c.hero.headline) lines.push(`**${c.hero.headline}**`);
    if (c.hero.subheadline) lines.push(c.hero.subheadline);
    const ctas = [c.hero.cta_primary, c.hero.cta_secondary].filter(Boolean);
    if (ctas.length) lines.push(`CTAs: ${ctas.join(' · ')}`);
  }
  if (Array.isArray(c.nav) && c.nav.length) {
    lines.push('\n## Navigation');
    lines.push(c.nav.map((n) => `- ${typeof n === 'string' ? n : (n.label || n.title || JSON.stringify(n))}`).join('\n'));
  }
  if (Array.isArray(c.features) && c.features.length) {
    lines.push('\n## Features');
    lines.push(c.features.map((f) => `- **${f.title || ''}** — ${f.description || ''}`).join('\n'));
  }
  for (const key of ['stats', 'testimonials', 'pricing', 'faq', 'sections']) {
    const arr = c[key];
    if (Array.isArray(arr) && arr.length) {
      lines.push(`\n## ${key[0].toUpperCase()}${key.slice(1)}`);
      lines.push(arr.map((x) => `- ${typeof x === 'string' ? x : JSON.stringify(x)}`).join('\n'));
    }
  }
  if (c.footer) {
    lines.push('\n## Footer');
    if (c.footer.tagline) lines.push(c.footer.tagline);
    if (c.footer.copyright) lines.push(c.footer.copyright);
  }
  return lines.join('\n').trim();
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
  if (!['designmd', 'content', 'screenshot', 'style', 'prompt', 'tokens', 'html', 'clone', 'styleclone'].includes(to)) {
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
        const content = await extractContent({ html: node.html, ...(model ? { model } : {}) });
        return result({ kind: 'designmd', designMd: contentToMarkdown(content),
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
      case 'html': {
        // No LLM — clone the site's HTML into a fresh editable .html node.
        return result({ kind: 'site', html: node.html,
          meta: { name: `${name} — html`, source: 'extract', extractTo: 'html', sourceNodeId: node.id } });
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
      case 'clone': {
        // Clone the website shown in the image into a full site node (blue),
        // then embed the REAL images (hero/render/logo) cropped from the
        // screenshot pixels — placeholders become pixel-identical.
        const raw = await cloneImageToHtml({ dataUrl, ...(model ? { model } : {}) });
        const html = await embedClonedImageRegions(raw, dataUrl);
        return result({ kind: 'site', html,
          meta: { name: `${name} — clone`, source: 'extract', extractTo: 'clone', sourceNodeId: node.id } });
      }
      case 'styleclone': {
        // Run the faithful clone (with real images embedded) in the background,
        // then derive the design.md FROM that generated clone — an extreme-
        // precision style spec, not a shallow token guess. The clone html rides
        // along in meta for reuse.
        const raw = await cloneImageToHtml({ dataUrl, ...(model ? { model } : {}) });
        const html = await embedClonedImageRegions(raw, dataUrl);
        const gen = await generateDesignMd({ html, ...(model ? { model } : {}) });
        return result({ kind: 'designmd', html, designMd: gen.md, truncated: gen.truncated,
          meta: { name: `${name} — style`, source: 'extract', extractTo: 'styleclone', sourceNodeId: node.id, cloneHtml: html } });
      }
    }
  }
  return { error: 'not_implemented', message: `extract "${to}" not implemented yet` };
}
