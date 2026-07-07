/**
 * Internal node clipboard — pure helpers, no React.
 *
 * Cmd+C on a selection serializes the nodes + the cords BETWEEN them into a
 * JSON payload that rides the SYSTEM clipboard as text. That makes
 * last-copy-wins natural against external content (images/URLs) and lets a
 * copied chain paste into another board. Cmd+V detects the payload and
 * re-creates nodes + internal cords, offset from the originals.
 */

export const NODES_CLIPBOARD_TYPE = 'uncraft/nodes';

// Serialize a group of nodes + the edges among them. Edges are stored as
// item-INDEX pairs so paste can remap them onto the fresh server ids.
// Cords to nodes outside the group are deliberately dropped — a copy owns
// only its internal wiring.
export function buildNodesClipboardPayload(group, edges) {
  const real = (group || []).filter((n) => n && !String(n.id).startsWith('temp-'));
  if (!real.length) return null;
  const idx = new Map(real.map((n, i) => [n.id, i]));
  return {
    type: NODES_CLIPBOARD_TYPE,
    v: 1,
    nodes: real.map((n) => ({
      kind: n.kind,
      origin_url: n.origin_url || null,
      template_slug: n.template_slug || null,
      pos_x: n.pos_x, pos_y: n.pos_y,
      width: n.width, height: n.height,
      meta: n.meta || {},
      current_html: n.current_html || null,
      current_design_md: n.current_design_md || null,
    })),
    links: (edges || [])
      .filter((e) => idx.has(e.source_node_id) && idx.has(e.target_node_id))
      .map((e) => ({ from: idx.get(e.source_node_id), to: idx.get(e.target_node_id), kind: e.kind || 'generic' })),
  };
}

// Parse clipboard text into a payload, or null when it isn't ours.
export function parseNodesClipboardText(text) {
  const t = (text || '').trim();
  if (!t.startsWith('{')) return null;
  try {
    const p = JSON.parse(t);
    if (p && p.type === NODES_CLIPBOARD_TYPE && Array.isArray(p.nodes) && p.nodes.length) return p;
  } catch { /* not JSON */ }
  return null;
}

// Turn a payload into paste items at the given paste sequence (1st paste =
// one step from the originals, 2nd = two steps, … so copies never stack).
export function payloadToPasteItems(payload, seq = 1, step = 60) {
  const d = step * Math.max(1, seq);
  return {
    items: payload.nodes.map((data) => ({ data, x: (data.pos_x ?? 0) + d, y: (data.pos_y ?? 0) + d })),
    links: Array.isArray(payload.links) ? payload.links : [],
  };
}
