'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ListTree, Search } from 'lucide-react';
import { nodeOrigin, originColor } from '../lib/node-origin.js';

// The 5173 reference card was 145×95. This version keeps the same nested
// rounded-frame construction at 85% scale: 123px outer card, 115×53 map.
const CARD_W = 123;
const MAP_W = 115;
const MAP_H = 53;

// Icons for the frame-toggle button. `next` icon = what'll happen on
// the NEXT click (matches the frameMode state in CanvasClient). Phosphor-
// stroke family, 1.6px weight, currentColor — sits next to the rest of
// the canvas chrome (ZoomControls, CategoryCounts) tonally.
const FrameIcon = {
  // "Frame selected" — outer frame + one inner block with a hairline
  // crosshair, reads as "target this one".
  selected: () => (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 8V5a1 1 0 0 1 1-1h3"/>
      <path d="M16 4h3a1 1 0 0 1 1 1v3"/>
      <path d="M20 16v3a1 1 0 0 1-1 1h-3"/>
      <path d="M8 20H5a1 1 0 0 1-1-1v-3"/>
      <rect x="9" y="9" width="6" height="6" rx="1"/>
    </svg>
  ),
  // "Fit all" — outer frame + 3 inner blocks, reads as "fit everything".
  all: () => (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 8V5a1 1 0 0 1 1-1h3"/>
      <path d="M16 4h3a1 1 0 0 1 1 1v3"/>
      <path d="M20 16v3a1 1 0 0 1-1 1h-3"/>
      <path d="M8 20H5a1 1 0 0 1-1-1v-3"/>
      <rect x="7"  y="7"  width="4" height="4" rx="0.8"/>
      <rect x="13" y="7"  width="4" height="4" rx="0.8"/>
      <rect x="7"  y="13" width="10" height="4" rx="0.8"/>
    </svg>
  )
};

const ORIGIN_LABELS = {
  url: 'Site',
  html: 'HTML',
  md: 'design.md',
  screenshot: 'Image',
  prompt: 'Prompt',
  skill: 'Code',
  blank: 'Site',
  unknown: 'Node',
};

function nodeLabel(node) {
  return node?.meta?.name || node?.origin_url || `${ORIGIN_LABELS[nodeOrigin(node)] || 'Node'} node`;
}

export default function Minimap({ nodes, transformRef, frameMode = 'all', hasSelection = false, onToggleFrame, onSelectNode }) {
  const [tick, setTick] = useState(0);
  const [heights, setHeights] = useState(() => new Map());
  const [nodeMenuOpen, setNodeMenuOpen] = useState(false);
  const [nodeQuery, setNodeQuery] = useState('');
  const rootRef = useRef(null);
  // The minimap's bbox depends on `window.innerWidth/Height`,
  // `transformRef.current.transformState`, AND live-measured node
  // heights — none of which exist on the server. Rather than guarding
  // every numeric output, gate the entire SVG until after mount.
  // Both SSR + client first render return null (identical), then
  // mount flips the flag and we render the live values. No hydration
  // mismatch by construction.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!nodeMenuOpen) return;
    function closeOnOutside(event) {
      if (!rootRef.current?.contains(event.target)) setNodeMenuOpen(false);
    }
    function closeOnEscape(event) {
      if (event.key === 'Escape') setNodeMenuOpen(false);
    }
    document.addEventListener('mousedown', closeOnOutside, true);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutside, true);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [nodeMenuOpen]);

  const filteredNodes = useMemo(() => {
    const query = nodeQuery.trim().toLowerCase();
    if (!query) return nodes;
    return nodes.filter((node) => {
      const origin = nodeOrigin(node);
      return `${nodeLabel(node)} ${ORIGIN_LABELS[origin] || origin}`.toLowerCase().includes(query);
    });
  }, [nodeQuery, nodes]);

  // Poll the transform state on each animation frame so the viewport
  // rect stays in sync with pan/zoom. react-zoom-pan-pinch's
  // `onTransformed` only fires at gesture boundaries, but the minimap
  // looks dead without per-frame updates during a continuous drag.
  // The same loop refreshes measured node heights so iframe auto-size
  // changes are reflected too.
  useEffect(() => {
    if (!mounted) return;
    let raf = 0;
    let alive = true;
    function loop() {
      if (!alive) return;
      // Re-read heights — only commit if anything actually changed so
      // we don't trigger superfluous re-renders.
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
      setTick((t) => (t + 1) % 1e6);
      raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);
    return () => { alive = false; cancelAnimationFrame(raf); };
  }, [nodes, mounted]);

  if (!mounted) return null;

  const state = transformRef?.current?.instance?.transformState;
  const scale = state?.scale ?? 1;
  const panX = state?.positionX ?? 0;
  const panY = state?.positionY ?? 0;

  // Viewport rect in WORLD coords. The transform applied by
  // react-zoom-pan-pinch is `screen = world * scale + pan`.
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const viewWorldX = -panX / scale;
  const viewWorldY = -panY / scale;
  const viewWorldW = vw / scale;
  const viewWorldH = vh / scale;

  // First render (SSR + initial client hydration): use n.height from
  // props for deterministic output. After the RAF loop fills `heights`
  // we switch to live measurements (and then clamp below).
  function nodeHeight(n) {
    return heights.get(n.id) ?? (n.height || 800);
  }

  // ── Compute the world bbox actually in use ─────────────────────────
  // Covers every node's frame + the current viewport, so nothing the
  // user could see ever falls outside the minimap. Maps onto MAP_W /
  // MAP_H with uniform aspect (letterboxed). Earlier static
  // WORLD_WIDTH/WORLD_HEIGHT mapping caused two bugs the user saw:
  //  - URL nodes auto-grow their iframe past the world height (cnode
  //    can be 5000+ world-px tall) → rect overflowed the minimap.
  //  - Negative pos_x / large pos_y put nodes outside (0,0)→(8000,6000)
  //    → those nodes were silently clipped.
  let minX = viewWorldX;
  let minY = viewWorldY;
  let maxX = viewWorldX + viewWorldW;
  let maxY = viewWorldY + viewWorldH;
  for (const n of nodes) {
    const h = nodeHeight(n);
    if (n.pos_x < minX) minX = n.pos_x;
    if (n.pos_y < minY) minY = n.pos_y;
    if (n.pos_x + n.width > maxX) maxX = n.pos_x + n.width;
    if (n.pos_y + h > maxY) maxY = n.pos_y + h;
  }
  // Margin so node frames don't kiss the minimap edge.
  const WORLD_PAD = 200;
  minX -= WORLD_PAD; minY -= WORLD_PAD;
  maxX += WORLD_PAD; maxY += WORLD_PAD;
  const worldW = Math.max(1, maxX - minX);
  const worldH = Math.max(1, maxY - minY);
  // Uniform fit (preserve aspect — letterbox the shorter axis).
  const fitScale = Math.min(MAP_W / worldW, MAP_H / worldH);
  const renderW = worldW * fitScale;
  const renderH = worldH * fitScale;
  const offsetX = (MAP_W - renderW) / 2;
  const offsetY = (MAP_H - renderH) / 2;
  function w2mX(x) { return (x - minX) * fitScale + offsetX; }
  function w2mY(y) { return (y - minY) * fitScale + offsetY; }

  // Clamp the viewport rect to a 3px inset so it never touches the
  // minimap frame. Always rendered with rounded corners.
  const PAD = 3;
  const vx0 = Math.max(PAD, Math.min(MAP_W - PAD, w2mX(viewWorldX)));
  const vy0 = Math.max(PAD, Math.min(MAP_H - PAD, w2mY(viewWorldY)));
  const vx1 = Math.max(PAD, Math.min(MAP_W - PAD, w2mX(viewWorldX + viewWorldW)));
  const vy1 = Math.max(PAD, Math.min(MAP_H - PAD, w2mY(viewWorldY + viewWorldH)));
  const vRectW = Math.max(0, vx1 - vx0);
  const vRectH = Math.max(0, vy1 - vy0);

  return (
    <div ref={rootRef} className="canvas-minimap" style={{ width: CARD_W }}>
      <svg width={MAP_W} height={MAP_H} viewBox={`0 0 ${MAP_W} ${MAP_H}`} className="canvas-minimap-svg">
        {/* World background — same dot grid feel as the canvas. */}
        <rect x={0} y={0} width={MAP_W} height={MAP_H} className="minimap-world" />
        {nodes.map((n) => {
          const x = w2mX(n.pos_x);
          const y = w2mY(n.pos_y);
          const w = Math.max(2, n.width * fitScale);
          const h = Math.max(2, nodeHeight(n) * fitScale);
          const colour = originColor(n);
          return (
            <g key={n.id}>
              <rect
                x={x} y={y} width={w} height={h}
                fill={colour}
                fillOpacity={0.95}
                rx={1.5}
                className="minimap-node-stroke"
              />
              <rect
                x={x}
                y={y}
                width={w}
                height={Math.max(0.8, h * 0.12)}
                fill={colour}
                fillOpacity={1}
                rx={1.2}
              />
            </g>
          );
        })}
        <rect
          x={vx0} y={vy0}
          width={vRectW} height={vRectH}
          rx={4} ry={4}
          className="minimap-viewport"
        />
      </svg>
      <div className="canvas-minimap-footer">
        <button
          type="button"
          className={`minimap-node-toggle${nodeMenuOpen ? ' active' : ''}`}
          onMouseDown={(e) => { e.stopPropagation(); }}
          onClick={(e) => {
            e.stopPropagation();
            setNodeMenuOpen((open) => !open);
          }}
          aria-label="Browse nodes"
          aria-expanded={nodeMenuOpen}
          title="Browse nodes"
        >
          <ListTree aria-hidden="true" />
          <span>Nodes</span>
        </button>
        {/* Framing lives in its own aligned footer row, matching the compact
            reference instead of floating over the map. */}
        {onToggleFrame && (
          <button
            type="button"
            className="minimap-frame-toggle"
            onMouseDown={(e) => { e.stopPropagation(); }}
            onClick={(e) => { e.stopPropagation(); onToggleFrame(); }}
            aria-label={
              !hasSelection ? 'Fit all nodes to view'
                : frameMode === 'selected' ? 'Frame the selected node'
                : 'Fit all nodes to view'
            }
            title={
              !hasSelection ? 'Fit all nodes'
                : frameMode === 'selected' ? 'Frame selected node'
                : 'Fit all nodes'
            }
          >
            {(!hasSelection || frameMode === 'all')
              ? <FrameIcon.all />
              : <FrameIcon.selected />}
            <span>{hasSelection && frameMode === 'selected' ? 'Selected' : 'All'}</span>
          </button>
        )}
      </div>
      {nodeMenuOpen && (
        <div className="minimap-node-menu" role="dialog" aria-label="Canvas nodes">
          <div className="minimap-node-menu-head">
            <b>Nodes</b>
            <span>{nodes.length}</span>
          </div>
          {nodes.length > 7 && (
            <label className="minimap-node-search">
              <Search aria-hidden="true" />
              <input
                value={nodeQuery}
                onChange={(event) => setNodeQuery(event.target.value)}
                placeholder="Find a node"
                autoFocus
              />
            </label>
          )}
          <div className="minimap-node-list">
            {filteredNodes.length ? filteredNodes.map((node) => {
              const origin = nodeOrigin(node);
              return (
                <button
                  key={node.id}
                  type="button"
                  className="minimap-node-row"
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelectNode?.(node.id);
                    setNodeMenuOpen(false);
                    setNodeQuery('');
                  }}
                >
                  <i style={{ background: originColor(node) }} aria-hidden="true" />
                  <span className="minimap-node-row-name">{nodeLabel(node)}</span>
                  <small>{ORIGIN_LABELS[origin] || 'Node'}</small>
                </button>
              );
            }) : (
              <div className="minimap-node-empty">No matching nodes</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
