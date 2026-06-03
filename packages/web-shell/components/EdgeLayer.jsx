'use client';

import { useEffect, useState, useMemo } from 'react';
import { originColor } from '../lib/node-origin.js';

const WORLD_WIDTH = 8000;
const WORLD_HEIGHT = 6000;

// Port positions match the .cnode-port-right / .cnode-port-stack-left CSS:
// the right port sits on the node's vertical mid-line. The left side is a
// vertical stack of input slots — slotIndex picks WHICH slot in the stack.
// SLOT_SIZE/SLOT_GAP mirror the globals.css numbers but in *screen* px;
// the CSS divides by --canvas-scale so the rendered circles stay the same
// on-screen size at any zoom. nodePort applies the same inverse-scale to
// place its endpoint at the actual circle centre — without this, at low
// zoom the cord landed between slots instead of in their middles.
const SLOT_SIZE = 19;
const SLOT_GAP = 6;

function nodePort(n, side, measuredH, slotIndex = 0, slotCount = 1, scale = 1) {
  const h = measuredH ?? n.height ?? 800;
  const midY = n.pos_y + h / 2;
  if (side === 'right') {
    return { x: n.pos_x + n.width, y: midY };
  }
  const slotSize = SLOT_SIZE / scale;
  const slotGap = SLOT_GAP / scale;
  const totalH = slotCount * slotSize + Math.max(0, slotCount - 1) * slotGap;
  const stackTop = midY - totalH / 2;
  return {
    x: n.pos_x,
    y: stackTop + slotIndex * (slotSize + slotGap) + slotSize / 2
  };
}

function edgePath(a, b) {
  // Smooth cubic bezier between port positions with horizontal-ish bias.
  const dx = Math.abs(b.x - a.x);
  const cp1x = a.x + dx * 0.3 * Math.sign(b.x - a.x || 1);
  const cp2x = b.x - dx * 0.3 * Math.sign(b.x - a.x || 1);
  return `M ${a.x} ${a.y} C ${cp1x} ${a.y}, ${cp2x} ${b.y}, ${b.x} ${b.y}`;
}

// Hook: tracks the live offsetHeight of every node by polling on the next
// frame and again on a ResizeObserver tick. Returns a Map<id, height>.
// Skipping during SSR (typeof document === 'undefined') keeps the first
// render deterministic.
function useMeasuredHeights(nodes) {
  const [heights, setHeights] = useState(() => new Map());
  useEffect(() => {
    if (typeof document === 'undefined') return;
    function measure() {
      const next = new Map();
      for (const n of nodes) {
        const el = document.querySelector(`[data-node-id="${n.id}"]`);
        if (el && el.offsetHeight) next.set(n.id, el.offsetHeight);
      }
      setHeights((prev) => {
        if (prev.size !== next.size) return next;
        for (const [k, v] of next) if (prev.get(k) !== v) return next;
        return prev;
      });
    }
    measure();
    const observers = [];
    for (const n of nodes) {
      const el = document.querySelector(`[data-node-id="${n.id}"]`);
      if (!el) continue;
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      observers.push(ro);
    }
    return () => observers.forEach((ro) => ro.disconnect());
  }, [nodes]);
  return heights;
}

// Mousedown on an edge starts a click-vs-drag race. If the cursor moves
// more than DRAG_THRESHOLD before mouseup, treat the gesture as a drag and
// hand off to onEdgeDragStart (re-routing). Otherwise it's a plain click
// → onSelectEdge.
const EDGE_DRAG_THRESHOLD = 5;

function bindEdgeMouseDown(edge, evt, onSelectEdge, onEdgeDragStart) {
  evt.stopPropagation();
  const startX = evt.clientX, startY = evt.clientY;
  let started = false;
  function move(ev) {
    if (started) return;
    if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > EDGE_DRAG_THRESHOLD) {
      started = true;
      cleanup();
      onEdgeDragStart?.(edge, ev);
    }
  }
  function up() {
    if (!started) onSelectEdge?.(edge, evt);
    cleanup();
  }
  function cleanup() {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
  }
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
}

export default function EdgeLayer({ nodes, edges, incomingByTarget, scale = 1, selectedEdgeId, onSelectEdge, onEdgeDragStart }) {
  const heights = useMeasuredHeights(nodes);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  // Resolve slot count + slot index from the same incomingByTarget the
  // CanvasNode used to render its left-side stack. Falls back to the
  // local edges array if no map was passed (older callers).
  function targetSlot(edgeId, targetId) {
    if (incomingByTarget) {
      const list = incomingByTarget.get(targetId);
      if (list) {
        const i = list.findIndex((x) => x.edgeId === edgeId);
        return { index: Math.max(0, i), count: list.length };
      }
    }
    const peers = edges.filter((e) => e.target_node_id === targetId);
    const i = peers.findIndex((e) => e.id === edgeId);
    return { index: Math.max(0, i), count: peers.length || 1 };
  }

  return (
    <svg
      width={WORLD_WIDTH} height={WORLD_HEIGHT}
      // overflow:visible so cord paths drawn beyond the declared SVG box
      // (e.g. when a node sits past world (8000, 6000) or the cursor goes
      // off the canvas during drag) still render. Without this, segments
      // outside the SVG viewport were clipped — the user saw a "cut" cord.
      style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none', overflow: 'visible' }}
    >
      {edges.map((e, idx) => {
        const a = byId.get(e.source_node_id);
        const b = byId.get(e.target_node_id);
        if (!a || !b) return null;
        const slot = targetSlot(e.id, b.id);
        const ca = nodePort(a, 'right', heights.get(a.id));
        const cb = nodePort(b, 'left',  heights.get(b.id), slot.index, slot.count, scale);
        const stagger = (idx % 3 - 1) * 28;
        const mid = { x: (ca.x + cb.x) / 2, y: (ca.y + cb.y) / 2 + stagger };
        const sourceColor = originColor(a);
        const targetColor = originColor(b);
        const gradId = `edge-grad-${e.id}`;
        const labelText = `${e.kind}${e.status === 'applied' ? ' ✓' : e.status === 'failed' ? ' ✗' : ''}`;
        const d = edgePath(ca, cb);
        const isSelected = selectedEdgeId === e.id;
        // Pill geometry: same inverse-scale trick as the ports — kept in
        // 1/scale world units so it renders at constant on-screen size.
        // Width is a char-count estimate (good enough for short labels).
        const charW = 6.4, padX = 12, fontSize = 11;
        const pillW = (labelText.length * charW + padX * 2) / scale;
        const pillH = 22 / scale;
        return (
          <g key={e.id} pointerEvents="visiblePainted">
            <defs>
              <linearGradient id={gradId} x1={ca.x} y1={ca.y} x2={cb.x} y2={cb.y} gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor={sourceColor} />
                <stop offset="100%" stopColor={targetColor} />
              </linearGradient>
            </defs>
            {/* Solid underlay — gives the cord visual continuity even when
                the marching dashes are mid-gap. Same path, no dasharray. */}
            <path
              d={d}
              stroke={`url(#${gradId})`}
              className={`edge-line-base${isSelected ? ' selected' : ''} ${e.status || ''}`.trim()}
            />
            {/* Marching-dot overlay — directional indicator. */}
            <path
              d={d}
              stroke={`url(#${gradId})`}
              className={`edge-line${isSelected ? ' selected' : ''} ${e.status || ''}`.trim()}
              onMouseDown={(evt) => bindEdgeMouseDown(e, evt, onSelectEdge, onEdgeDragStart)}
            />
            {/* Edge-kind label pill removed — was visual noise on every cord
                and conveyed implementation detail the user doesn't reason
                about. The colour-coded gradient already encodes provenance. */}
          </g>
        );
      })}
    </svg>
  );
}

// Separate top-layer SVG so the draft edge renders ABOVE node iframes (which
// otherwise would visually cover the dashed line during drag).
export function DraftEdgeLayer({ nodes, draftEdge, scale = 1 }) {
  const heights = useMeasuredHeights(nodes);
  if (!draftEdge) return null;
  const src = nodes.find((n) => n.id === draftEdge.sourceNodeId);
  if (!src) return null;
  const side = draftEdge.sourceSide || 'right';
  const a = nodePort(src, side, heights.get(src.id), 0, 1, scale);
  // Snap target wins — when the cursor is within snap radius of an input
  // slot, the cord endpoint locks to the slot's exact world coord so the
  // user gets clear "this drop will land" feedback.
  const endX = draftEdge.snapTo ? draftEdge.snapTo.x : draftEdge.x2;
  const endY = draftEdge.snapTo ? draftEdge.snapTo.y : draftEdge.y2;
  const path = edgePath(a, { x: endX, y: endY });
  const stroke = originColor(src);
  return (
    <svg
      width={WORLD_WIDTH} height={WORLD_HEIGHT}
      style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none', zIndex: 50, overflow: 'visible' }}
    >
      {/* Solid underlay — keeps the cord continuous even when the
          marching dashes are mid-gap. Slightly translucent so the
          directional dashes still pop on top. */}
      <path
        d={path}
        stroke={stroke}
        className="draft-edge-line-base"
        fill="none"
      />
      <path
        d={path}
        stroke={stroke}
        className={`draft-edge-line${draftEdge.snapTo ? ' snapped' : ''}`}
        strokeLinecap="round"
        fill="none"
      />
      {draftEdge.snapTo && (
        <circle
          cx={endX} cy={endY}
          r={14}
          fill="none"
          stroke={stroke}
          className="draft-edge-snap-ring"
        />
      )}
    </svg>
  );
}
