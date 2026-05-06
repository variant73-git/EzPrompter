'use client';

// Edge cord color — matches the node's teal accent (.cnode.selected ring +
// .cnode.is-main glow in globals.css). Single color across all node origins
// so the cord visually reads as part of the same node frame, not a separate
// system. Originally per-origin via originColor(node) — replaced after user
// feedback that the cord should match the border in the case they observed.
const CORD_COLOR = '#0095FF';

const WORLD_WIDTH = 8000;
const WORLD_HEIGHT = 6000;

// Port positions match the .cnode-port-right / .cnode-port-left CSS:
// both ports sit on the node's vertical mid-line, right on the border.
// `n.height` is the server-side capture height, which becomes stale when
// CanvasNode re-measures the iframe scrollHeight on load — so we read
// the live rendered .cnode height from the DOM. EdgeLayer and the cnode
// share the same TransformComponent parent, so offsetHeight is already
// in world (pre-scale) coords.
function renderedHeight(n) {
  if (typeof document !== 'undefined') {
    const el = document.querySelector(`[data-node-id="${n.id}"]`);
    if (el && el.offsetHeight) return el.offsetHeight;
  }
  return n.height;
}

function nodePort(n, side) {
  const h = renderedHeight(n);
  return {
    x: n.pos_x + (side === 'right' ? n.width : 0),
    y: n.pos_y + h / 2
  };
}

function edgePath(a, b) {
  // Smooth cubic bezier between port positions with horizontal-ish bias.
  const dx = Math.abs(b.x - a.x);
  const cp1x = a.x + dx * 0.3 * Math.sign(b.x - a.x || 1);
  const cp2x = b.x - dx * 0.3 * Math.sign(b.x - a.x || 1);
  return `M ${a.x} ${a.y} C ${cp1x} ${a.y}, ${cp2x} ${b.y}, ${b.x} ${b.y}`;
}

export default function EdgeLayer({ nodes, edges, draftEdge, selectedEdgeId, onSelectEdge }) {
  const byId = new Map(nodes.map((n) => [n.id, n]));

  let draftPath = null;
  if (draftEdge) {
    const src = byId.get(draftEdge.sourceNodeId);
    if (src) draftPath = edgePath(nodePort(src, 'right'), { x: draftEdge.x2, y: draftEdge.y2 });
  }

  return (
    <svg
      width={WORLD_WIDTH} height={WORLD_HEIGHT}
      style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}
    >
      {edges.map((e, idx) => {
        const a = byId.get(e.source_node_id);
        const b = byId.get(e.target_node_id);
        if (!a || !b) return null;
        const ca = nodePort(a, 'right');
        const cb = nodePort(b, 'left');
        // Stagger overlapping labels so multiple edges between same nodes don't fully overlap.
        const stagger = (idx % 3 - 1) * 28;
        const mid = { x: (ca.x + cb.x) / 2, y: (ca.y + cb.y) / 2 + stagger };
        const labelText = `${e.kind}${e.status === 'applied' ? ' ✓' : e.status === 'failed' ? ' ✗' : ''}`;
        const stroke = CORD_COLOR;
        return (
          <g key={e.id}>
            <path
              d={edgePath(ca, cb)}
              stroke={stroke}
              className={`edge-line${selectedEdgeId === e.id ? ' selected' : ''} ${e.status || ''}`.trim()}
              onMouseDown={(evt) => { evt.stopPropagation(); onSelectEdge(e, evt); }}
            />
            <text x={mid.x} y={mid.y + 4} className="edge-label" pointerEvents="none">
              {labelText}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// Separate top-layer SVG so the draft edge renders ABOVE node iframes (which
// otherwise would visually cover the dashed line during drag).
export function DraftEdgeLayer({ nodes, draftEdge }) {
  if (!draftEdge) return null;
  const src = nodes.find((n) => n.id === draftEdge.sourceNodeId);
  if (!src) return null;
  const path = edgePath(nodePort(src, 'right'), { x: draftEdge.x2, y: draftEdge.y2 });
  return (
    <svg
      width={WORLD_WIDTH} height={WORLD_HEIGHT}
      style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none', zIndex: 50 }}
    >
      <path
        d={path}
        stroke={CORD_COLOR}
        className="draft-edge-line"
        strokeLinecap="round"
        strokeDasharray="8 6"
        fill="none"
      />
    </svg>
  );
}
