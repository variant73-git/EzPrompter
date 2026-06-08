'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { nodeOrigin, originColor, ORIGIN_COLORS } from '../lib/node-origin.js';

const CATEGORY_ORDER = ['url', 'html', 'md', 'screenshot'];

const CategoryIcon = {
  url: () => (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9"/><path d="M3 12h18"/>
      <path d="M12 3a13 13 0 0 1 4 9 13 13 0 0 1-4 9 13 13 0 0 1-4-9 13 13 0 0 1 4-9z"/>
    </svg>
  ),
  html: () => (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/>
      <path d="M14 3v5h5"/><path d="m9 14-1.5 2L9 18"/><path d="m13.5 14 1.5 2-1.5 2"/>
    </svg>
  ),
  md: () => (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2C6.48 2 2 6.48 2 12c0 5.52 4.48 10 10 10 1.66 0 3-1.34 3-3 0-.78-.29-1.49-.78-2.04-.17-.19-.32-.41-.32-.66 0-.55.45-1 1-1H17c2.76 0 5-2.24 5-5 0-4.98-4.48-9-10-9z"/>
      <circle cx="6.5"  cy="11.5" r="1.4" fill="currentColor" stroke="none"/>
      <circle cx="9.5"  cy="7.5"  r="1.4" fill="currentColor" stroke="none"/>
      <circle cx="14.5" cy="7.5"  r="1.4" fill="currentColor" stroke="none"/>
      <circle cx="17.5" cy="11.5" r="1.4" fill="currentColor" stroke="none"/>
    </svg>
  ),
  screenshot: () => (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2"/>
      <circle cx="9" cy="10.5" r="1.5"/><path d="m21 16-5-5L5 19"/>
    </svg>
  ),
  prompt: () => (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      <path d="M8 10h8M8 13h5"/>
    </svg>
  ),
  skill: () => (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m12 3 2.5 5 5.5.8-4 3.9.95 5.5L12 15.6 7.05 18.2 8 12.7 4 8.8 9.5 8z"/>
    </svg>
  )
};

// Single-source chain: simple horizontal line with dot endpoints, gradient
// matching the cord's source→target colour.
function ChainConnectorSingle({ fromColor, toColor, id }) {
  const gradId = `chain-grad-${id}`;
  return (
    <svg
      width="44" height="14" viewBox="0 0 44 14"
      style={{ flexShrink: 0 }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="7" x2="44" y2="7" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={fromColor} />
          <stop offset="100%" stopColor={toColor} />
        </linearGradient>
      </defs>
      <line x1="4" y1="7" x2="40" y2="7" stroke={`url(#${gradId})`} strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="4"  cy="7" r="3" fill={fromColor} />
      <circle cx="40" cy="7" r="3" fill={toColor} />
    </svg>
  );
}

// Multi-source chain: pills stacked vertically on the left, each with a
// curve that converges into a single point, then a straight line out to
// the target. Reads as a horizontal-Y. Each input curve carries the
// source's origin colour; the trunk to the target uses target colour.
function ChainConnectorY({ sources, targetColor, id }) {
  // Layout constants — must match the pill height + flex gap in CSS.
  const PILL_H = 22;       // pill outer height (incl. border)
  const ROW_GAP = 4;       // gap between stacked source pills
  const W = 64;            // total connector width
  const FORK_X = 36;       // x of the convergence point
  const PAD_LEFT = 4;      // left start of input curves
  const PAD_RIGHT = 4;     // right end of trunk (away from target pill)
  const N = sources.length;
  const H = N * PILL_H + Math.max(0, N - 1) * ROW_GAP;
  const midY = H / 2;
  const lastSourceColor = sources[sources.length - 1].color;

  return (
    <svg
      width={W} height={H} viewBox={`0 0 ${W} ${H}`}
      style={{ flexShrink: 0 }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`yt-${id}`} x1={FORK_X} y1={midY} x2={W} y2={midY} gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={lastSourceColor} />
          <stop offset="100%" stopColor={targetColor} />
        </linearGradient>
      </defs>
      {sources.map((s, i) => {
        const y = i * (PILL_H + ROW_GAP) + PILL_H / 2;
        // Cubic curve from (PAD_LEFT, y) to (FORK_X, midY) — leans right
        // before converging to keep the bend smooth.
        const d = `M ${PAD_LEFT} ${y} C ${FORK_X * 0.45} ${y}, ${FORK_X * 0.7} ${midY}, ${FORK_X} ${midY}`;
        return (
          <path
            key={i}
            d={d}
            stroke={s.color}
            strokeWidth="1.5"
            fill="none"
            strokeLinecap="round"
          />
        );
      })}
      {/* Trunk — fork point → near-target */}
      <line
        x1={FORK_X} y1={midY}
        x2={W - PAD_RIGHT} y2={midY}
        stroke={`url(#yt-${id})`}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {/* Endpoint dots */}
      {sources.map((s, i) => (
        <circle
          key={`d-${i}`}
          cx={PAD_LEFT}
          cy={i * (PILL_H + ROW_GAP) + PILL_H / 2}
          r="3"
          fill={s.color}
        />
      ))}
      <circle cx={W - PAD_RIGHT} cy={midY} r="3" fill={targetColor} />
    </svg>
  );
}

function ChainPill({ origin, label }) {
  const Icon = CategoryIcon[origin] || (() => null);
  const colour = ORIGIN_COLORS[origin] || ORIGIN_COLORS.unknown;
  return (
    <span className="cat-chain-pill" style={{ '--pill-colour': colour }}>
      <Icon />
      <span className="cat-chain-pill-lbl">{label}</span>
    </span>
  );
}

// Group edges by target → array of incoming sources. Each group is a chain
// the user can frame in the viewport.
function buildChains(nodes, edges) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const grouped = new Map();
  for (const e of edges) {
    const list = grouped.get(e.target_node_id) || [];
    list.push(e);
    grouped.set(e.target_node_id, list);
  }
  const chains = [];
  for (const [targetId, eList] of grouped) {
    const target = byId.get(targetId);
    if (!target) continue;
    const sources = eList
      .map((e) => byId.get(e.source_node_id))
      .filter(Boolean);
    if (sources.length === 0) continue;
    chains.push({
      id: targetId,
      sources,
      target,
      nodeIds: [...sources.map((n) => n.id), targetId]
    });
  }
  return chains;
}

function shortLabel(node) {
  if (!node) return '—';
  const origin = nodeOrigin(node);
  if (origin === 'url') {
    try {
      const u = new URL(node.origin_url);
      return u.hostname.replace(/^www\./, '');
    } catch (e) { return node.origin_url || 'url'; }
  }
  return node.meta?.name || node.template_slug || origin;
}

export default function CategoryCounts({ nodes, edges, onZoomToConnection }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const counts = useMemo(() => {
    const c = { url: 0, html: 0, md: 0, screenshot: 0 };
    for (const n of nodes) {
      const o = nodeOrigin(n);
      if (c[o] !== undefined) c[o]++;
    }
    return c;
  }, [nodes]);

  // Always render every category — categories with zero nodes appear
  // at 40% opacity via .is-zero so the user sees the full taxonomy.
  const visibleCounts = CATEGORY_ORDER;

  const chains = useMemo(() => buildChains(nodes, edges), [nodes, edges]);

  useEffect(() => {
    if (!open) return;
    function onDown(e) {
      if (!ref.current?.contains(e.target)) setOpen(false);
    }
    function onKey(e) { if (e.key === 'Escape') setOpen(false); }
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (nodes.length === 0) {
    return (
      <button className="canvas-counts" disabled>
        empty canvas
      </button>
    );
  }

  return (
    <div className="cat-counts-wrap" ref={ref}>
      <button
        type="button"
        className={`canvas-counts cat-counts-trigger${open ? ' open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title="Click to see connections"
      >
        {visibleCounts.map((k) => {
          const Icon = CategoryIcon[k];
          const isZero = counts[k] === 0;
          return (
            <span
              key={k}
              className={`cat-counts-item${isZero ? ' is-zero' : ''}`}
              style={{ '--cat-colour': ORIGIN_COLORS[k] }}
            >
              <Icon />
              <span className="cat-counts-num">{counts[k]}</span>
            </span>
          );
        })}
      </button>
      {open && (
        <div className="cat-counts-menu">
          <div className="cat-counts-menu-title">
            {chains.length === 0 ? 'No connections yet' : 'Connections'}
          </div>
          {chains.map((ch) => {
            const targetColor = originColor(ch.target);
            const sourceMeta = ch.sources.map((s) => ({
              node: s,
              color: originColor(s),
              origin: nodeOrigin(s),
              label: shortLabel(s)
            }));
            const isMulti = sourceMeta.length > 1;
            return (
              <button
                key={ch.id}
                type="button"
                className={`cat-counts-chain${isMulti ? ' multi' : ''}`}
                onClick={() => {
                  setOpen(false);
                  onZoomToConnection(ch.nodeIds);
                }}
              >
                <div className="cat-chain-sources-stack">
                  {sourceMeta.map((s) => (
                    <ChainPill key={s.node.id} origin={s.origin} label={s.label} />
                  ))}
                </div>
                {isMulti ? (
                  <ChainConnectorY
                    sources={sourceMeta}
                    targetColor={targetColor}
                    id={ch.id}
                  />
                ) : (
                  <ChainConnectorSingle
                    fromColor={sourceMeta[0].color}
                    toColor={targetColor}
                    id={ch.id}
                  />
                )}
                <ChainPill origin={nodeOrigin(ch.target)} label={shortLabel(ch.target)} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
