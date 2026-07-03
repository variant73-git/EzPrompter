/**
 * Section play (▶) routing — pure helpers, no React.
 *
 * The vision (user, 2026-06-11): the section play button executes
 * WHATEVER chain lives in the section, not just image workflows. We
 * find the chain's terminal node and route by its kind:
 *   - asset → deterministic image re-run (POST /api/sections/rerun)
 *   - site  → compose engine (POST /api/nodes/[id]/run), same call the
 *             PromptDock arrow makes — works even on a blank scaffold
 *   - designmd / others → not supported yet, surfaced honestly
 *
 * Terminal node of a section's chain — the member that receives edges
 * from other members and doesn't fan out to another member. For typical
 * workflows (sources → result) there is exactly one; zero/multiple
 * runnable terminals means the chain shape isn't re-runnable.
 */
import { BLANK_SITE_HTML } from './blank-site-html.js';

export const RERUNNABLE_TERMINAL_KINDS = new Set(['asset', 'site']);

export function findSectionTerminal(section, nodes, edges) {
  const memberSet = new Set(section.memberIds);
  const terminals = section.memberIds
    .map((id) => nodes.find((n) => n.id === id))
    .filter(Boolean)
    .filter((node) => {
      const hasIncomingFromMember = edges.some((e) => e.target_node_id === node.id && memberSet.has(e.source_node_id));
      const hasOutgoingToMember   = edges.some((e) => e.source_node_id === node.id && memberSet.has(e.target_node_id));
      return hasIncomingFromMember && !hasOutgoingToMember;
    });

  // Temp nodes only live in local state — the server can't run them.
  const runnable = terminals.filter(
    (n) => RERUNNABLE_TERMINAL_KINDS.has(n.kind) && !String(n.id).startsWith('temp-')
  );

  return {
    terminal: runnable.length === 1 ? runnable[0] : null,
    terminalId: runnable.length === 1 ? runnable[0].id : null,
    count: runnable.length,
    // When the chain DOES end somewhere but that kind can't be re-run
    // (a .md or prompt terminal), report it so the caller can say
    // "not supported yet" instead of "no terminal found".
    unsupportedKind: runnable.length === 0 && terminals.length > 0 ? terminals[0].kind : null,
  };
}

// ── Clean / dirty gating ────────────────────────────────────────────────
// A workflow that just ran shouldn't be re-runnable until something about
// it actually CHANGES — otherwise the user burns credits regenerating an
// identical result. `chainSignature` fingerprints the CONTENT of a section's
// chain (node content fields + edge wiring) while deliberately ignoring
// canvas position/size, selection, and transient flags. Moving nodes around
// the canvas leaves the signature untouched; editing a prompt, swapping an
// image, rewiring an edge, or regenerating the output all change it.
//
// The caller stores the signature at the moment a run completes; the section
// stays "clean" (run buttons disabled) as long as the live signature equals
// the stored one.

// Cheap, allocation-light string fingerprint. Content fields can be large
// (a 70KB site HTML), and this runs on every nodes change (including drag
// frames), so we sample length + head + tail rather than hashing the whole
// string. Good enough to catch any real content edit.
function fingerprint(str) {
  if (!str) return '0';
  const s = String(str);
  const n = s.length;
  let h = 5381;
  const head = s.slice(0, 256);
  const tail = s.slice(-256);
  for (let i = 0; i < head.length; i++) h = ((h << 5) + h + head.charCodeAt(i)) | 0;
  for (let i = 0; i < tail.length; i++) h = ((h << 5) + h + tail.charCodeAt(i)) | 0;
  return `${n}:${h >>> 0}`;
}

// The content field that matters per node kind. Everything else (position,
// size, selection) is intentionally excluded.
function nodeContentFingerprint(node) {
  if (!node) return '∅';
  const meta = node.meta || {};
  let content = '';
  switch (node.kind) {
    case 'site':
    case 'html':
      content = node.current_html || '';
      break;
    case 'asset':
    case 'image':
      content = meta.dataUrl || node.screenshot_url || '';
      break;
    case 'prompt':
      content = meta.prompt || node.current_html || '';
      break;
    case 'designmd':
      content = node.design_md || meta.designMd || node.current_html || '';
      break;
    default:
      content = node.current_html || meta.prompt || node.design_md || '';
  }
  return `${node.kind || '?'}|${(node.name || '').trim()}|${fingerprint(content)}`;
}

export function chainSignature(section, nodes, edges) {
  if (!section || !Array.isArray(section.memberIds)) return '';
  const memberSet = new Set(section.memberIds);
  // Member content, ordered by id so the signature is stable regardless of
  // array order.
  const memberSig = [...section.memberIds]
    .sort()
    .map((id) => `${id}=${nodeContentFingerprint(nodes.find((n) => n.id === id))}`)
    .join(';');
  // Wiring INSIDE the section — adding/removing an edge between members is a
  // structural change that should re-enable the run.
  const edgeSig = (edges || [])
    .filter((e) => memberSet.has(e.source_node_id) && memberSet.has(e.target_node_id))
    .map((e) => `${e.source_node_id}>${e.target_node_id}`)
    .sort()
    .join(',');
  return `${memberSig}#${edgeSig}`;
}

// The re-run confirm only earns its interruption when there's a
// GENERATED RESULT about to be overwritten. First runs (image terminal
// still empty, site terminal still on the blank scaffold) fire straight
// away.
export function sectionRerunWouldOverwrite(section, nodes, edges) {
  const { terminal } = findSectionTerminal(section, nodes, edges);
  if (!terminal) return false;
  if (terminal.kind === 'asset') return !!terminal.meta?.dataUrl;
  if (terminal.kind === 'site') {
    const html = terminal.current_html || '';
    return !!html && html !== BLANK_SITE_HTML;
  }
  return false;
}

// ── Billing estimates (Task 18) ─────────────────────────────────────────
// Map a section's runnable chain to billing op ids so the UI can show a
// pre-flight `≈ N cr` estimate (lib/billing/pricing.js estimateChain).
// One terminal = one operation: site → compose, asset → image regen.
export function sectionOps(section, nodes, edges) {
  const { terminal } = findSectionTerminal(section, nodes, edges);
  if (!terminal) return [];
  return terminal.kind === 'asset' ? ['image.generate'] : ['compose'];
}
