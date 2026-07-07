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
 * Terminal nodes of a section's chain — the members that receive edges
 * from other members and don't fan out to another member. A chain may
 * legitimately end in SEVERAL results (one source → N derived terminals,
 * first-class since anchored chains, 2026-07-06): the section run
 * executes every runnable terminal, not just a unique one.
 */
import { BLANK_SITE_HTML } from './blank-site-html.js';

export const RERUNNABLE_TERMINAL_KINDS = new Set(['asset', 'site']);

export function findSectionTerminals(section, nodes, edges) {
  const memberSet = new Set(section.memberIds);
  const endpoints = section.memberIds
    .map((id) => nodes.find((n) => n.id === id))
    .filter(Boolean)
    .filter((node) => {
      const hasIncomingFromMember = edges.some((e) => e.target_node_id === node.id && memberSet.has(e.source_node_id));
      const hasOutgoingToMember   = edges.some((e) => e.source_node_id === node.id && memberSet.has(e.target_node_id));
      return hasIncomingFromMember && !hasOutgoingToMember;
    });

  // Temp nodes only live in local state — the server can't run them.
  const terminals = endpoints.filter(
    (n) => RERUNNABLE_TERMINAL_KINDS.has(n.kind) && !String(n.id).startsWith('temp-')
  );

  return {
    terminals,
    count: terminals.length,
    // When the chain DOES end somewhere but that kind can't be re-run
    // (a .md or prompt terminal), report it so the caller can say
    // "not supported yet" instead of "no terminal found".
    unsupportedKind: terminals.length === 0 && endpoints.length > 0 ? endpoints[0].kind : null,
  };
}

// Legacy single-terminal view — kept for call sites that only make sense
// with a unique result. Multiple runnable terminals → null (ambiguous).
export function findSectionTerminal(section, nodes, edges) {
  const { terminals, count, unsupportedKind } = findSectionTerminals(section, nodes, edges);
  return {
    terminal: count === 1 ? terminals[0] : null,
    terminalId: count === 1 ? terminals[0].id : null,
    count,
    unsupportedKind,
  };
}

// ── Whole-graph run plan (cascade executor, 2026-07-06) ─────────────────
// The section ▶ executes the ENTIRE graph, whatever its shape — no
// assumptions about chain form. Every member with at least one incoming
// member-edge is PRODUCIBLE (it composes from its sources); this orders
// them into dependency stages (Kahn over the member subgraph, longest-path
// depth): sources first, derivations after, so results CASCADE — a
// multi-stage chain (prompt → site A → site B) re-produces A before B
// composes from it. Nodes in the same stage are independent → run in
// parallel. Only runnable kinds (asset/site, non-temp) execute; members
// caught in a cycle never resolve a depth and are left out (never run).
export function planSectionRun(section, nodes, edges) {
  const memberSet = new Set(section.memberIds);
  const memberEdges = (edges || []).filter(
    (e) => memberSet.has(e.source_node_id) && memberSet.has(e.target_node_id)
  );
  const members = section.memberIds
    .map((id) => nodes.find((n) => n.id === id))
    .filter(Boolean);

  // Depth via Kahn: a node's stage is 1 past its deepest source.
  const indegree = new Map(members.map((n) => [n.id, 0]));
  for (const e of memberEdges) indegree.set(e.target_node_id, (indegree.get(e.target_node_id) || 0) + 1);
  const depth = new Map();
  const remaining = new Map(indegree);
  const queue = members.filter((n) => (indegree.get(n.id) || 0) === 0).map((n) => n.id);
  queue.forEach((id) => depth.set(id, 0));
  while (queue.length) {
    const id = queue.shift();
    for (const e of memberEdges) {
      if (e.source_node_id !== id) continue;
      const t = e.target_node_id;
      depth.set(t, Math.max(depth.get(t) ?? 0, (depth.get(id) ?? 0) + 1));
      remaining.set(t, remaining.get(t) - 1);
      if (remaining.get(t) === 0) queue.push(t);
    }
  }

  const producible = members.filter((n) => memberEdges.some((e) => e.target_node_id === n.id));
  const staged = producible.filter(
    (n) => depth.has(n.id) && RERUNNABLE_TERMINAL_KINDS.has(n.kind) && !String(n.id).startsWith('temp-')
  );
  const byDepth = new Map();
  for (const n of staged) {
    const d = depth.get(n.id);
    if (!byDepth.has(d)) byDepth.set(d, []);
    byDepth.get(d).push(n);
  }
  const stages = [...byDepth.keys()].sort((a, b) => a - b).map((d) => byDepth.get(d));

  return {
    stages,
    runnable: stages.flat(),
    // The graph ends somewhere we can't produce (a .md or prompt with
    // inputs and nothing runnable at all) → report the kind so the caller
    // says "not supported yet" instead of "nothing to run".
    unsupportedKind:
      stages.length === 0 && producible.length > 0 && producible.every((n) => !RERUNNABLE_TERMINAL_KINDS.has(n.kind))
        ? producible[0].kind
        : null,
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
// A node's produced result exists (asset: image data; site: real html
// beyond the blank scaffold).
export function nodeHasResult(node) {
  if (!node) return false;
  if (node.kind === 'asset') return !!node.meta?.dataUrl;
  if (node.kind === 'site') {
    const html = node.current_html || '';
    return !!html && html !== BLANK_SITE_HTML;
  }
  return false;
}

// Fingerprint of everything a node composes FROM: the content of every
// incoming edge's source, ordered by id. If this matches the signature
// captured when the node last ran, its inputs haven't changed — re-running
// it would burn credits to produce the same thing.
export function nodeInputSignature(nodeId, nodes, edges) {
  const sources = (edges || [])
    .filter((e) => e.target_node_id === nodeId)
    .map((e) => e.source_node_id)
    .sort();
  return sources
    .map((sid) => `${sid}=${nodeContentFingerprint(nodes.find((n) => n.id === sid))}`)
    .join(';');
}

// ── Incremental cascade (2026-07-06) ────────────────────────────────────
// Filter the full run plan down to what actually NEEDS to run. A node runs
// when: it has no result yet, OR its input signature no longer matches the
// stored one (something upstream was edited), OR any of its direct sources
// is itself going to run (its inputs are ABOUT to change — propagates down
// the stages). Everything else is skipped and its current result reused.
// storedSigs = null/undefined → force mode (Reroll): the full plan runs.
export function planIncrementalRun(section, nodes, edges, storedSigs = null) {
  const base = planSectionRun(section, nodes, edges);
  if (!storedSigs) return { ...base, skipped: [] };

  const willRun = new Set();
  const stages = [];
  const skipped = [];
  for (const stage of base.stages) {
    const runStage = [];
    for (const n of stage) {
      const upstreamRuns = (edges || []).some(
        (e) => e.target_node_id === n.id && willRun.has(e.source_node_id)
      );
      const dirty =
        upstreamRuns ||
        !nodeHasResult(n) ||
        storedSigs[n.id] !== nodeInputSignature(n.id, nodes, edges);
      if (dirty) { willRun.add(n.id); runStage.push(n); }
      else skipped.push(n);
    }
    if (runStage.length) stages.push(runStage);
  }
  return { stages, runnable: stages.flat(), skipped, unsupportedKind: base.unsupportedKind };
}

// ── Run from here (2026-07-06) ──────────────────────────────────────────
// Surgical scope: the pointed node runs FORCED (the user explicitly chose
// it) and the cascade continues only through its descendants — everything
// upstream and in sibling branches is untouched and costs nothing. The
// node itself is included only when it's producible (a source prompt/asset
// can't run, but its descendants can).
export function planRunFromNode(nodeId, section, nodes, edges) {
  const memberSet = new Set(section.memberIds);
  const memberEdges = (edges || []).filter(
    (e) => memberSet.has(e.source_node_id) && memberSet.has(e.target_node_id)
  );
  // Descendant closure of the pointed node (BFS over member edges).
  const targets = new Set([nodeId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const e of memberEdges) {
      if (targets.has(e.source_node_id) && !targets.has(e.target_node_id)) {
        targets.add(e.target_node_id);
        grew = true;
      }
    }
  }
  const base = planSectionRun(section, nodes, edges);
  const stages = base.stages
    .map((st) => st.filter((n) => targets.has(n.id)))
    .filter((st) => st.length);
  return { stages, runnable: stages.flat() };
}

export function sectionRerunWouldOverwrite(section, nodes, edges, storedSigs = null) {
  const { runnable } = planIncrementalRun(section, nodes, edges, storedSigs);
  return runnable.some(nodeHasResult);
}

// ── Billing estimates (Task 18) ─────────────────────────────────────────
// Map a section's runnable graph to billing op ids so the UI can show a
// pre-flight `≈ N cr` estimate (lib/billing/pricing.js estimateChain).
// One op per node that will ACTUALLY run: with storedSigs the estimate is
// incremental (skipped nodes cost nothing); without, the full cascade.
export function sectionOps(section, nodes, edges, storedSigs = null) {
  const { runnable } = planIncrementalRun(section, nodes, edges, storedSigs);
  return runnable.map((t) => (t.kind === 'asset' ? 'image.generate' : 'compose'));
}
