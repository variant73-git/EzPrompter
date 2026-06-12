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
