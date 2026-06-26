'use client';

import { useEffect, useRef, useState } from 'react';
import { progressAt } from '../lib/generation-progress.js';

// How often the estimate advances. 120ms is smooth to the eye and cheap.
const TICK_MS = 120;

// Drives the reassurance percentage from 0 toward ~95 over `durationMs`
// while `active`. Elapsed time is accumulated from the tick count, so the
// climb is fully deterministic under fake timers (no Date/rAF dependency).
// Resets to 0 whenever `active` goes false.
export function useGenerationProgress(active, durationMs) {
  const [pct, setPct] = useState(0);
  const elapsedRef = useRef(0);
  // Hold the latest durationMs in a ref so the interval picks up changes
  // WITHOUT restarting the clock (which would jump the % back to 0 mid-run).
  const durationRef = useRef(durationMs);
  durationRef.current = durationMs;

  useEffect(() => {
    // Reset on every active transition: 0 when inactive, fresh clock when a
    // run starts. Depending only on `active` means a durationMs change while
    // running keeps the elapsed clock intact.
    elapsedRef.current = 0;
    setPct(0);
    if (!active) return undefined;
    const id = setInterval(() => {
      elapsedRef.current += TICK_MS;
      setPct(progressAt(elapsedRef.current, durationRef.current));
    }, TICK_MS);
    return () => clearInterval(id);
  }, [active]);

  return pct;
}

// Rounded-rectangle perimeter, authored to START at top-center (w/2, 0) and
// travel CLOCKWISE, with corner radius `r`. Coordinates are node-local
// pixels (the SVG viewBox is the node's real dimensions). Closing with Z
// completes the loop along the top edge for the dash math.
export function buildPerimeterPath(width, height, r) {
  return [
    `M${width / 2},0`,
    `H${width - r}`,
    `A${r},${r} 0 0 1 ${width},${r}`,
    `V${height - r}`,
    `A${r},${r} 0 0 1 ${width - r},${height}`,
    `H${r}`,
    `A${r},${r} 0 0 1 0,${height - r}`,
    `V${r}`,
    `A${r},${r} 0 0 1 ${r},0`,
    'Z',
  ].join(' ');
}

// On-screen corner radius the card uses (.cnode border-radius: 10px / scale).
const CORNER_PX = 10;

function readCanvasScale() {
  if (typeof document === 'undefined') return 1;
  const v = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--canvas-scale')
  );
  return v > 0 ? v : 1;
}

// Pure render: an SVG outline that hugs the node frame and fills clockwise
// to `pct` from 12 o'clock. Color comes from the parent's --cnode-port-fill
// via CSS (.cnode-progress-arc); the track is solid dark grey. (The numeric
// percentage was removed by design — the arc alone signals progress.)
//
// `preserveAspectRatio="none"` stretches the viewBox to fill the SVG element
// box EXACTLY — so the ring always lands on the real rendered card edges no
// matter how the measured width/height relate to the element's own box
// (border inset, fixed-height loading body, stale measurement). Without it
// the default `meet` letterboxed the path, making the ring narrower than the
// node — the "width desencontrado" the user saw.
//
// Corner radius matches the card's `10px / scale`: in node-local units (the
// viewBox space) that's CORNER_PX / scale, so the ring corners trace the same
// curve the card uses at every zoom level.
export function NodeProgressRing({ pct, width, height }) {
  const scale = readCanvasScale();
  // Floor at 0.15 to mirror the card's `border-radius: 10px / max(0.15, scale)`
  // so the ring corners track the node's corners at every zoom level.
  const r = Math.min(CORNER_PX / Math.max(0.15, scale), width / 2, height / 2);
  const d = buildPerimeterPath(width, height, r);

  // Tip glow: a soft white radial fade at the LEADING edge of the filling
  // stroke. We read the point at pct% along the live path (same coordinate
  // space as the stroke, so it stays glued to the tip through the stretch).
  const arcRef = useRef(null);
  const [tip, setTip] = useState(null);
  useEffect(() => {
    const p = arcRef.current;
    if (!p || pct <= 0) { setTip(null); return; }
    try {
      const total = p.getTotalLength();
      const pt = p.getPointAtLength(total * (pct / 100));
      setTip({ x: pt.x, y: pt.y });
    } catch { setTip(null); }
  }, [pct, width, height, d]);
  const tipR = Math.max(width, height) * 0.06;

  return (
    <div className="cnode-progress" aria-hidden="true">
      <svg
        className="cnode-progress-svg"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
      >
        <defs>
          <radialGradient id="cnode-progress-tip-grad">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
        </defs>
        <path className="cnode-progress-track" d={d} pathLength="100" />
        <path
          ref={arcRef}
          className="cnode-progress-arc"
          d={d}
          pathLength="100"
          strokeDasharray="100"
          strokeDashoffset={100 - pct}
        />
        {tip && (
          <circle
            className="cnode-progress-tip"
            cx={tip.x}
            cy={tip.y}
            r={tipR}
            fill="url(#cnode-progress-tip-grad)"
          />
        )}
      </svg>
    </div>
  );
}
