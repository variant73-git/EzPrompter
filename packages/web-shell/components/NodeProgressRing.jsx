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

// Pure render: an SVG outline that hugs the node frame and fills clockwise
// to `pct` from 12 o'clock, plus the centered percentage. Color comes from
// the parent's --cnode-port-fill via CSS (.cnode-progress-arc); the number
// + track are solid dark grey. viewBox = node dimensions so the path maps
// 1:1 to node pixels with no aspect distortion.
const CORNER_R = 10;

export function NodeProgressRing({ pct, width, height }) {
  const d = buildPerimeterPath(width, height, CORNER_R);
  return (
    <div className="cnode-progress" aria-hidden="true">
      <svg className="cnode-progress-svg" viewBox={`0 0 ${width} ${height}`}>
        <path className="cnode-progress-track" d={d} pathLength="100" />
        <path
          className="cnode-progress-arc"
          d={d}
          pathLength="100"
          strokeDasharray="100"
          strokeDashoffset={100 - pct}
        />
      </svg>
      <span className="cnode-progress-num">{pct}%</span>
    </div>
  );
}
