'use client';

import { useEffect, useState, useMemo, memo } from 'react';
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
// Ports sit this many SCREEN px OUTSIDE the node edge (a short gap so the
// dots float just off the frame). Cord endpoints shift out by the same amount
// so they meet the dots. MUST match the CSS port offsets (.cnode-port-right /
// .cnode-port-stack-left) and CanvasClient.findSnapTarget's PORT_GAP.
const PORT_GAP = 11.385;

function nodePort(n, side, measuredH, slotIndex = 0, slotCount = 1, scale = 1) {
  const h = measuredH ?? n.height ?? 800;
  const midY = n.pos_y + h / 2;
  // 0.4 floor mirrors the CSS counter-scale clamp (2026-07-03 rule:
  // below 40% zoom the chrome stops compensating and scales with the
  // world) — endpoints must land where the CSS-positioned circles are.
  const s = Math.max(0.4, scale);
  const gap = PORT_GAP / s;   // screen-constant outward offset → world
  if (side === 'right') {
    return { x: n.pos_x + n.width + gap, y: midY };
  }
  const slotSize = SLOT_SIZE / s;
  const slotGap = SLOT_GAP / s;
  const totalH = slotCount * slotSize + Math.max(0, slotCount - 1) * slotGap;
  const stackTop = midY - totalH / 2;
  return {
    x: n.pos_x - gap,
    y: stackTop + slotIndex * (slotSize + slotGap) + slotSize / 2
  };
}

function edgePath(a, b, scale = 1) {
  // Smooth cubic bezier between port positions. Control points ALWAYS
  // point outward — right of the emitter, left of the receiver — so the
  // cord exits past the port circle and hooks back into the other one,
  // even when the target sits LEFT of the source. (The old sign-following
  // control points flipped inward in that case and the cord dove "behind"
  // both nodes, surfacing only at the port.) Minimum bow is WORLD-fixed
  // (2026-07-03): the old screen-stable 48/scale made the curve's SHAPE a
  // function of the zoom, so every zoom gesture visibly re-bent the cords.
  // 80 world px ≈ the previous look at the 0.6 default zoom; the shape now
  // never changes as you zoom. Large spans still get a proportional,
  // capped bow to avoid balloon loops.
  const dx = Math.abs(b.x - a.x);
  const minBow = 80;
  const k = Math.max(minBow, Math.min(420, dx * 0.35));
  const cp1x = a.x + k;
  const cp2x = b.x - k;
  return `M ${a.x} ${a.y} C ${cp1x} ${a.y}, ${cp2x} ${b.y}, ${b.x} ${b.y}`;
}

// Hook: tracks the live offsetHeight of every node, re-measuring on
// ResizeObserver ticks. Returns a Map<id, height>.
//
// Keyed on node MEMBERSHIP (ids), NOT the nodes array identity: during a
// drag the array is recreated on every frame, and re-running this effect
// then would disconnect + recreate N ResizeObservers and force a layout
// read (offsetHeight) per node per frame. Position changes don't affect
// offsetHeight — the observers report real height changes in between.
// Skipping during SSR (typeof document === 'undefined') keeps the first
// render deterministic.
function useMeasuredHeights(nodes) {
  const [heights, setHeights] = useState(() => new Map());
  const idsKey = nodes.map((n) => n.id).join('|');
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const ids = idsKey ? idsKey.split('|') : [];
    function measure() {
      const next = new Map();
      for (const id of ids) {
        const el = document.querySelector(`[data-node-id="${id}"]`);
        if (el && el.offsetHeight) next.set(id, el.offsetHeight);
      }
      setHeights((prev) => {
        if (prev.size !== next.size) return next;
        for (const [k, v] of next) if (prev.get(k) !== v) return next;
        return prev;
      });
    }
    measure();
    const observers = [];
    for (const id of ids) {
      const el = document.querySelector(`[data-node-id="${id}"]`);
      if (!el) continue;
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      observers.push(ro);
    }
    return () => observers.forEach((ro) => ro.disconnect());
  }, [idsKey]);
  return heights;
}

// Live canvas scale at the QUANTIZED cadence (the same ~90ms/1% steps the
// CSS chrome follows). CanvasClient dispatches `uncraft:canvas-scale` on
// every quantized --canvas-scale write and at gesture settle. Port balls
// are sized/offset by that CSS var, and cord endpoints must move in
// LOCKSTEP with them — driving edges from the React scale prop (which now
// only updates at settle) left the cord frozen mid-gesture while the balls
// stepped away, then visibly "re-attaching" on release. Falls back to the
// prop between events. Only this layer re-renders on the event — the rest
// of the board stays untouched mid-gesture.
function useLiveCanvasScale(propScale) {
  const [scale, setScale] = useState(propScale);
  useEffect(() => { setScale(propScale); }, [propScale]);
  useEffect(() => {
    function onScale(e) {
      const s = e?.detail;
      if (typeof s === 'number' && s > 0) setScale(s);
    }
    window.addEventListener('uncraft:canvas-scale', onScale);
    return () => window.removeEventListener('uncraft:canvas-scale', onScale);
  }, []);
  return scale;
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

function EdgeLayer({ nodes, edges, dyingEdges, incomingByTarget, scale: scaleProp = 1, selectedEdgeId, onSelectEdge, onEdgeDragStart, onSeverEdge }) {
  const scale = useLiveCanvasScale(scaleProp);
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
        const ca = nodePort(a, 'right', heights.get(a.id), 0, 1, scale);
        const cb = nodePort(b, 'left',  heights.get(b.id), slot.index, slot.count, scale);
        const stagger = (idx % 3 - 1) * 28;
        const mid = { x: (ca.x + cb.x) / 2, y: (ca.y + cb.y) / 2 + stagger };
        const sourceColor = originColor(a);
        const targetColor = originColor(b);
        const gradId = `edge-grad-${e.id}`;
        const labelText = `${e.kind}${e.status === 'applied' ? ' ✓' : e.status === 'failed' ? ' ✗' : ''}`;
        const d = edgePath(ca, cb, scale);
        const isSelected = selectedEdgeId === e.id;
        // Pill geometry: same inverse-scale trick as the ports — kept in
        // 1/scale world units so it renders at constant on-screen size.
        // Width is a char-count estimate (good enough for short labels).
        const charW = 6.4, padX = 12, fontSize = 11;
        const sClamped = Math.max(0.4, scale);
        const pillW = (labelText.length * charW + padX * 2) / sClamped;
        const pillH = 22 / sClamped;
        return (
          <g key={e.id} className="edge-group" pointerEvents="visiblePainted">
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
            {/* Marching-dot overlay — directional indicator (visual only). */}
            <path
              d={d}
              stroke={`url(#${gradId})`}
              className={`edge-line${isSelected ? ' selected' : ''} ${e.status || ''}`.trim()}
            />
            {/* Wide invisible hit path — the real grab target for select /
                re-route. Stroke width is inverse-scaled so it stays a
                comfortable ~22px on screen at any zoom (the thin visible cord
                was nearly impossible to grab when zoomed out). */}
            <path
              d={d}
              stroke="transparent"
              strokeWidth={22 / Math.max(0.4, scale)}
              fill="none"
              pointerEvents="stroke"
              style={{ cursor: 'grab' }}
              onMouseDown={(evt) => bindEdgeMouseDown(e, evt, onSelectEdge, onEdgeDragStart)}
            />
            {/* Cut hotspot — the MIDDLE of the cord shows a scissors cursor and
                a plain click severs the connection. Sits ON TOP of the hit path
                so the middle reads as "cut", the rest as "select / re-route".
                Inverse-scaled so the target stays grabbable when zoomed out. */}
            <circle
              /* True bezier midpoint (t=0.5) — sits ON the cord. NOT `mid`,
                 which carries a legacy `stagger` the cord path doesn't use. */
              cx={(ca.x + cb.x) / 2} cy={(ca.y + cb.y) / 2}
              r={48 / Math.max(0.4, scale)}
              fill="transparent"
              className="edge-cut-zone"
              pointerEvents="all"
              onMouseDown={(evt) => evt.stopPropagation()}
              onClick={(evt) => { evt.stopPropagation(); onSeverEdge?.(e); }}
            />
          </g>
        );
      })}
      {/* Severed cords retracting — rendered from CanvasClient's transient
          dyingEdges list (they're already gone from `edges`). A single
          normalized path (pathLength=1) retracts INTO the source port via
          the stroke-dash keyframes in globals.css, then the list entry
          expires (~260ms) and the element unmounts. Flat source colour —
          the live gradient defs died with the real edge. */}
      {(dyingEdges || []).map((e) => {
        const a = byId.get(e.source_node_id);
        const b = byId.get(e.target_node_id);
        if (!a || !b) return null;
        const slot = targetSlot(e.id, b.id);
        const ca = nodePort(a, 'right', heights.get(a.id), 0, 1, scale);
        const cb = nodePort(b, 'left', heights.get(b.id), slot.index, slot.count, scale);
        return (
          <path
            key={`dying-${e.id}`}
            d={edgePath(ca, cb, scale)}
            stroke={originColor(a)}
            fill="none"
            pathLength="1"
            className="edge-dying-line"
            pointerEvents="none"
          />
        );
      })}
    </svg>
  );
}

export default memo(EdgeLayer);

// Separate top-layer SVG so the draft edge renders ABOVE node iframes (which
// otherwise would visually cover the dashed line during drag).
export function DraftEdgeLayer({ nodes, draftEdge, scale: scaleProp = 1 }) {
  const scale = useLiveCanvasScale(scaleProp);
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
  const path = edgePath(a, { x: endX, y: endY }, scale);
  const stroke = originColor(src);
  return (
    <svg
      width={WORLD_WIDTH} height={WORLD_HEIGHT}
      style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none', zIndex: 50, overflow: 'visible', opacity: 0.5 }}
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
