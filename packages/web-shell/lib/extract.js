import { generateDesignMd } from './design-md.js';
import { extractContent } from './demarcelize.js';

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
      // screenshot / style / prompt land in later tasks.
    }
  }
  // asset targets land in later tasks.
  return { error: 'not_implemented', message: `extract "${to}" not implemented yet` };
}
