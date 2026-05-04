'use client';

const WORLD_WIDTH = 8000;
const WORLD_HEIGHT = 6000;

function nodeCenter(n) {
  return { x: n.pos_x + n.width / 2, y: n.pos_y + n.height / 2 };
}

function edgePath(a, b) {
  // Smooth cubic bezier between centers, with horizontal-ish bias.
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
    if (src) draftPath = edgePath(nodeCenter(src), { x: draftEdge.x2, y: draftEdge.y2 });
  }

  return (
    <svg
      width={WORLD_WIDTH} height={WORLD_HEIGHT}
      style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}
    >
      {edges.map((e) => {
        const a = byId.get(e.source_node_id);
        const b = byId.get(e.target_node_id);
        if (!a || !b) return null;
        const ca = nodeCenter(a);
        const cb = nodeCenter(b);
        const mid = { x: (ca.x + cb.x) / 2, y: (ca.y + cb.y) / 2 };
        return (
          <g key={e.id}>
            <path
              d={edgePath(ca, cb)}
              className={`edge-line${selectedEdgeId === e.id ? ' selected' : ''} ${e.status || ''}`.trim()}
              onMouseDown={(evt) => { evt.stopPropagation(); onSelectEdge(e, evt); }}
            />
            <text x={mid.x} y={mid.y - 6} className="edge-label" pointerEvents="none">
              {e.kind}{e.status === 'applied' ? ' ✓' : e.status === 'failed' ? ' ✗' : ''}
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
  const path = edgePath(nodeCenter(src), { x: draftEdge.x2, y: draftEdge.y2 });
  return (
    <svg
      width={WORLD_WIDTH} height={WORLD_HEIGHT}
      style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none', zIndex: 50 }}
    >
      <path d={path} stroke="#a78bfa" strokeWidth="2" strokeDasharray="6 6" fill="none" opacity="0.9" />
    </svg>
  );
}
