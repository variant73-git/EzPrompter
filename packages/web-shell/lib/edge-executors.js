/**
 * edge-executors.js — pure DOM transformations for the canvas edge kinds.
 *
 *   transplant  — replace target element (by selector) with source element (by selector).
 *   token-swap  — extract :root CSS custom properties + body font-family from source,
 *                 inject into target's <head>.
 *   reskin      — defers to lib/demarcelize.js (LLM call).
 *
 * Returns the new HTML string for the target.
 */

import { parseHTML } from 'linkedom';
import { reskin as demarReskin } from './demarcelize.js';

function parse(html) {
  // linkedom.parseHTML returns { window, document, ... }
  return parseHTML(html);
}

function serialize(doc) {
  return '<!DOCTYPE html>' + doc.documentElement.outerHTML;
}

export function applyTransplant({ sourceHtml, targetHtml, payload }) {
  const sourceSel = payload?.sourceSelector;
  const targetSel = payload?.targetSelector;
  if (!sourceSel || !targetSel) throw new Error('transplant: sourceSelector + targetSelector required');

  const src = parse(sourceHtml);
  const tgt = parse(targetHtml);

  const srcEl = src.document.querySelector(sourceSel);
  if (!srcEl) throw new Error(`transplant: source element not found (${sourceSel})`);

  const tgtEl = tgt.document.querySelector(targetSel);
  if (!tgtEl) throw new Error(`transplant: target element not found (${targetSel})`);

  // Clone source's outerHTML into target's location (replace the target node entirely).
  const wrapper = tgt.document.createElement('div');
  wrapper.innerHTML = srcEl.outerHTML;
  const newNode = wrapper.firstElementChild;
  if (!newNode) throw new Error('transplant: failed to materialise source node');
  tgtEl.replaceWith(newNode);

  // Carry over <style> tags from source <head> that may scope the new element.
  const srcStyles = src.document.querySelectorAll('head style');
  const tgtHead = tgt.document.querySelector('head');
  if (tgtHead && srcStyles.length) {
    for (const s of srcStyles) {
      const tag = tgt.document.createElement('style');
      tag.setAttribute('data-uncraft-from', 'transplant');
      tag.textContent = s.textContent;
      tgtHead.appendChild(tag);
    }
  }

  return serialize(tgt.document);
}

function extractRootVars(css) {
  // Captures :root { ... } block content; returns object of var declarations.
  const m = css.match(/:root\s*\{([\s\S]*?)\}/);
  if (!m) return {};
  const out = {};
  m[1].split(';').forEach((decl) => {
    const idx = decl.indexOf(':');
    if (idx < 0) return;
    const name = decl.slice(0, idx).trim();
    const val = decl.slice(idx + 1).trim();
    if (name.startsWith('--')) out[name] = val;
  });
  return out;
}

function inlineStyleSheets(doc) {
  const styles = [...doc.querySelectorAll('head style')];
  return styles.map((s) => s.textContent || '').join('\n');
}

export function applyTokenSwap({ sourceHtml, targetHtml }) {
  const src = parse(sourceHtml);
  const tgt = parse(targetHtml);
  const srcCss = inlineStyleSheets(src.document);
  const tokens = extractRootVars(srcCss);

  // Detect source body font-family from inline style or computed-ish heuristic.
  const srcBody = src.document.body;
  const bodyStyle = srcBody?.getAttribute('style') || '';
  const fontMatch = bodyStyle.match(/font-family\s*:\s*([^;]+)/i)
    || srcCss.match(/body\s*\{[^}]*font-family\s*:\s*([^;}]+)/i);
  const bodyFont = fontMatch ? fontMatch[1].trim() : null;

  // Inject override block into target.
  const head = tgt.document.querySelector('head') || tgt.document.documentElement.appendChild(tgt.document.createElement('head'));
  const declarations = Object.entries(tokens).map(([k, v]) => `  ${k}: ${v};`).join('\n');
  const override = tgt.document.createElement('style');
  override.setAttribute('data-uncraft', 'token-swap');
  override.textContent = `:root {\n${declarations}\n}\n${bodyFont ? `body { font-family: ${bodyFont}; }` : ''}`;
  head.appendChild(override);

  return serialize(tgt.document);
}

export async function applyReskin({ sourceHtml, targetHtml, model }) {
  // In our model: target = source-of-content, source (the EDGE source node) = chassis.
  // The user's mental model is "node A donates style/chunks to node B" — the edge points
  // from A (source / chassis) to B (target / content host). So Demarcelizer's
  // "reference template" is the edge's source node, "target copy" is the edge's target node.
  return demarReskin({ targetHtml, referenceHtml: sourceHtml, model });
}
