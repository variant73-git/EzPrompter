# Node Progress Ring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the multicolor Uiverse spin border (and the 3-step text chip) on every generating canvas node with a single calm affordance — a category-colored progress arc filling the node's own rounded-rectangle border clockwise from 12 o'clock, plus a large grey percentage in the center.

**Architecture:** Two isolated, testable units. A pure-logic layer in `lib/generation-progress.js` (`estimatedDurationMs(node)` picks a typical duration per generation path; `progressAt(elapsedMs, durationMs)` is the eased 0→95 curve). A view layer in `components/NodeProgressRing.jsx` (the `useGenerationProgress` hook drives the climb over time; the `NodeProgressRing` component renders an inline SVG arc + number). `CanvasNode.jsx` swaps the old spin/chip for these. Color is delivered by the existing `--cnode-port-fill` CSS variable (no color prop, no new colors).

**Tech Stack:** React 18, Next.js 15, Vitest 4 + @testing-library/react + jsdom (run via `vitest run`), inline SVG `stroke-dashoffset` with `vector-effect: non-scaling-stroke`.

---

## File Structure

- **Create** `packages/web-shell/lib/generation-progress.js` — pure functions: `estimatedDurationMs(node)`, `progressAt(elapsedMs, durationMs)`. No React, no DOM.
- **Create** `packages/web-shell/lib/generation-progress.test.js` — unit tests for both pure functions.
- **Create** `packages/web-shell/components/NodeProgressRing.jsx` — `useGenerationProgress(active, durationMs)` hook + `NodeProgressRing({ pct })` component.
- **Create** `packages/web-shell/components/NodeProgressRing.test.jsx` — render tests for the component + hook.
- **Modify** `packages/web-shell/components/CanvasNode.jsx` — swap the `cnode-gen-border` body for `<NodeProgressRing>`; remove the `cnode-run-status` chip JSX (keep `runStatus` as a render trigger).
- **Modify** `packages/web-shell/app/globals.css` — add `.cnode-progress-*` rules; remove the now-dead `.cnode-spin*`, `.cnode-gen-face`, `@keyframes cnode-speen`, and `.cnode-run-*` rules.
- **Modify** `packages/web-shell/components/CanvasClient.jsx` — remove the now-unused `#uncraft-unopaq{,2,3}` SVG filter defs.

All paths below are relative to the repo root `/Users/adilsonporto/Desktop/IA/Uncraft`. The test command runs from `packages/web-shell`.

---

## Task 1: Pure progress functions

**Files:**
- Create: `packages/web-shell/lib/generation-progress.js`
- Test: `packages/web-shell/lib/generation-progress.test.js`

- [ ] **Step 1: Write the failing test**

Create `packages/web-shell/lib/generation-progress.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { estimatedDurationMs, progressAt } from './generation-progress.js';

describe('estimatedDurationMs', () => {
  it('returns ~150s for a cloned URL site', () => {
    expect(estimatedDurationMs({ kind: 'site', origin_url: 'https://x.com' })).toBe(150000);
  });
  it('returns ~45s for a blank composition site', () => {
    expect(estimatedDurationMs({ kind: 'site', meta: { source: 'blank' } })).toBe(45000);
  });
  it('returns ~25s for image / asset nodes', () => {
    expect(estimatedDurationMs({ kind: 'image' })).toBe(25000);
    expect(estimatedDurationMs({ kind: 'asset' })).toBe(25000);
  });
  it('falls back to 45s for anything else or null', () => {
    expect(estimatedDurationMs({ kind: 'prompt' })).toBe(45000);
    expect(estimatedDurationMs(null)).toBe(45000);
  });
});

describe('progressAt', () => {
  it('is 0 at t=0', () => {
    expect(progressAt(0, 45000)).toBe(0);
  });
  it('climbs but never reaches or exceeds 95', () => {
    const mid = progressAt(45000, 45000);   // t = duration = 3τ
    expect(mid).toBeGreaterThan(80);
    expect(mid).toBeLessThan(95);
    expect(progressAt(10_000_000, 45000)).toBeLessThanOrEqual(95);
  });
  it('rises monotonically', () => {
    expect(progressAt(2000, 45000)).toBeGreaterThan(progressAt(1000, 45000));
  });
  it('a shorter duration climbs faster at the same elapsed time', () => {
    expect(progressAt(5000, 25000)).toBeGreaterThan(progressAt(5000, 150000));
  });
  it('returns an integer', () => {
    expect(Number.isInteger(progressAt(3333, 45000))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/web-shell && npx vitest run lib/generation-progress.test.js`
Expected: FAIL — `Failed to resolve import "./generation-progress.js"`.

- [ ] **Step 3: Write the implementation**

Create `packages/web-shell/lib/generation-progress.js`:

```js
// Pure helpers for the node generation progress ring. No React, no DOM.
//
// The percentage is a reassurance ESTIMATE, not real progress: the backend
// emits discrete stages (and image generation emits nothing), so a true
// 0–100 does not exist. The curve climbs toward an asymptote of 95 and is
// replaced wholesale by the real result the instant generation finishes —
// at whatever number it was on. There is no "100% / done" state.

const ASYMPTOTE = 95;

// Typical wall-clock duration per generation path, in ms. `3τ ≈ duration`,
// so the curve reaches ~95% of the asymptote at roughly the typical time.
// Tune these with real telemetry later — they only affect pacing, never
// correctness (the ring is swapped out on the real `done`).
const DURATIONS_MS = {
  clone: 150000,   // site captured from a URL
  compose: 45000,  // blank site assembled from connected inputs
  image: 25000,    // createImage / asset generation
};

export function estimatedDurationMs(node) {
  if (!node) return DURATIONS_MS.compose;
  if (node.kind === 'image' || node.kind === 'asset') return DURATIONS_MS.image;
  if (node.kind === 'site' && node.origin_url) return DURATIONS_MS.clone;
  return DURATIONS_MS.compose;
}

// Eased exponential climb: pct = 95 · (1 − e^(−t/τ)), τ = duration / 3.
// Fast at first, decelerating, asymptotic at 95, never reaching 100.
export function progressAt(elapsedMs, durationMs) {
  const tau = durationMs / 3;
  const pct = ASYMPTOTE * (1 - Math.exp(-elapsedMs / tau));
  return Math.min(ASYMPTOTE, Math.round(pct));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/web-shell && npx vitest run lib/generation-progress.test.js`
Expected: PASS — all cases green.

- [ ] **Step 5: Commit**

```bash
git add packages/web-shell/lib/generation-progress.js packages/web-shell/lib/generation-progress.test.js
git commit -m "feat(canvas): pure progress-estimate helpers for node ring"
```

---

## Task 2: NodeProgressRing component + hook

**Files:**
- Create: `packages/web-shell/components/NodeProgressRing.jsx`
- Test: `packages/web-shell/components/NodeProgressRing.test.jsx`

Notes for the implementer:
- The arc is an SVG `<path>` with `pathLength="100"`, so `strokeDasharray="100"` and `strokeDashoffset={100 - pct}` fill the perimeter clockwise proportional to `pct`, starting from the path's first point.
- The path is authored to **begin at top-center (12 o'clock) and travel clockwise**, with rounded corners matching the node's radius. The SVG `viewBox` is set to the node's real dimensions (`0 0 {width} {height}`) so 1 viewBox unit = 1 node-local pixel and the aspect ratio matches the node exactly (no distortion). `vector-effect="non-scaling-stroke"` keeps the stroke a constant on-screen width at any zoom.
- **Corner radius:** the node's frame radius is scale-compensated (`calc(10px / --canvas-scale)`), so it is a constant 10px on screen. The arc uses a fixed `r = 10` in node-local units, which matches the node corners exactly at 100% zoom and stays visually close at other zooms — acceptable for a transient indicator, and it avoids coupling the component to the live canvas scale or re-rendering the path on every zoom. Square corners (a plain rect) would visibly mismatch the rounded node and are not used.
- `buildPerimeterPath(width, height, r)` is a small pure helper (kept inside the component file) that returns the `d` string. It is exported so it can be unit-tested.
- Color: do **not** pass a color prop. Apply CSS class `cnode-progress-arc`; its `stroke` is `var(--cnode-port-fill)`, which the parent `.cnode.origin-*` already sets. jsdom does not compute CSS vars, so tests assert the class + geometry, not the resolved color (the selected ring already proves the var cascades).

- [ ] **Step 1: Write the failing test**

Create `packages/web-shell/components/NodeProgressRing.test.jsx`:

```jsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { NodeProgressRing, useGenerationProgress, buildPerimeterPath } from './NodeProgressRing.jsx';

afterEach(() => {
  vi.useRealTimers();
});

describe('buildPerimeterPath', () => {
  it('starts at top-center (width/2, 0)', () => {
    expect(buildPerimeterPath(320, 180, 10).startsWith('M160,0')).toBe(true);
  });
  it('closes the loop', () => {
    expect(buildPerimeterPath(320, 180, 10).trim().endsWith('Z')).toBe(true);
  });
  it('uses arc commands for the rounded corners', () => {
    expect(buildPerimeterPath(320, 180, 10)).toContain('A');
  });
});

describe('NodeProgressRing', () => {
  it('renders the percentage with a % sign', () => {
    render(<NodeProgressRing pct={47} width={320} height={180} />);
    expect(screen.getByText('47%')).toBeInTheDocument();
  });

  it('sets strokeDashoffset to 100 - pct on the arc', () => {
    const { container } = render(<NodeProgressRing pct={47} width={320} height={180} />);
    const arc = container.querySelector('.cnode-progress-arc');
    expect(arc).toBeTruthy();
    expect(arc.getAttribute('stroke-dashoffset')).toBe('53');
  });

  it('renders a full-perimeter track behind the arc', () => {
    const { container } = render(<NodeProgressRing pct={10} width={320} height={180} />);
    expect(container.querySelector('.cnode-progress-track')).toBeTruthy();
  });

  it('sets the viewBox to the node dimensions', () => {
    const { container } = render(<NodeProgressRing pct={10} width={320} height={180} />);
    expect(container.querySelector('.cnode-progress-svg').getAttribute('viewBox')).toBe('0 0 320 180');
  });
});

describe('useGenerationProgress', () => {
  function Probe({ active, durationMs }) {
    const pct = useGenerationProgress(active, durationMs);
    return <span data-testid="pct">{pct}</span>;
  }

  it('starts at 0 and climbs while active', () => {
    vi.useFakeTimers();
    render(<Probe active={true} durationMs={45000} />);
    expect(screen.getByTestId('pct').textContent).toBe('0');
    act(() => { vi.advanceTimersByTime(5000); });
    expect(Number(screen.getByTestId('pct').textContent)).toBeGreaterThan(0);
  });

  it('never exceeds 95 no matter how long it runs', () => {
    vi.useFakeTimers();
    render(<Probe active={true} durationMs={25000} />);
    act(() => { vi.advanceTimersByTime(600000); });
    expect(Number(screen.getByTestId('pct').textContent)).toBeLessThanOrEqual(95);
  });

  it('stays at 0 when inactive', () => {
    vi.useFakeTimers();
    render(<Probe active={false} durationMs={45000} />);
    act(() => { vi.advanceTimersByTime(30000); });
    expect(screen.getByTestId('pct').textContent).toBe('0');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/web-shell && npx vitest run components/NodeProgressRing.test.jsx`
Expected: FAIL — `Failed to resolve import "./NodeProgressRing.jsx"`.

- [ ] **Step 3: Write the implementation**

Create `packages/web-shell/components/NodeProgressRing.jsx`:

```jsx
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

  useEffect(() => {
    if (!active) {
      elapsedRef.current = 0;
      setPct(0);
      return undefined;
    }
    elapsedRef.current = 0;
    setPct(0);
    const id = setInterval(() => {
      elapsedRef.current += TICK_MS;
      setPct(progressAt(elapsedRef.current, durationMs));
    }, TICK_MS);
    return () => clearInterval(id);
  }, [active, durationMs]);

  return pct;
}

// Rounded-rectangle perimeter, authored to START at top-center (w/2, 0) and
// travel CLOCKWISE, with corner radius `r`. Coordinates are node-local
// pixels (the SVG viewBox is the node's real dimensions). Closing with Z
// completes the loop along the top edge for the dash math.
export function buildPerimeterPath(width, height, r) {
  const w = width;
  const h = height;
  return [
    `M${w / 2},0`,
    `H${w - r}`,
    `A${r},${r} 0 0 1 ${w},${r}`,
    `V${h - r}`,
    `A${r},${r} 0 0 1 ${w - r},${h}`,
    `H${r}`,
    `A${r},${r} 0 0 1 0,${h - r}`,
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/web-shell && npx vitest run components/NodeProgressRing.test.jsx`
Expected: PASS — all cases green.

- [ ] **Step 5: Commit**

```bash
git add packages/web-shell/components/NodeProgressRing.jsx packages/web-shell/components/NodeProgressRing.test.jsx
git commit -m "feat(canvas): NodeProgressRing component + useGenerationProgress hook"
```

---

## Task 3: CSS for the ring; remove dead spin + chip styles

**Files:**
- Modify: `packages/web-shell/app/globals.css`

No automated test — this is CSS. Verified visually in Task 5.

- [ ] **Step 1: Add the ring styles**

Append to `packages/web-shell/app/globals.css` (near the old `.cnode-gen-border` block, around line 4994):

```css
/* Generation progress ring — replaces the Uiverse spin. An SVG outline
   that hugs the node frame and fills clockwise from 12 o'clock in the
   node's category colour (--cnode-port-fill), with a large grey % in the
   centre. Swapped out wholesale when the real result arrives. */
.cnode-progress {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
.cnode-progress-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
}
.cnode-progress-track {
  fill: none;
  stroke: #2a2d33;                       /* solid dark grey rail */
  stroke-width: 3px;
  vector-effect: non-scaling-stroke;     /* constant on-screen at any zoom */
}
.cnode-progress-arc {
  fill: none;
  stroke: var(--cnode-port-fill, var(--accent));
  stroke-width: 3px;
  stroke-linecap: round;
  vector-effect: non-scaling-stroke;
  transition: stroke-dashoffset 0.12s linear;  /* smooth between ticks */
}
.cnode-progress-num {
  position: relative;
  font-family: 'Aeonik', system-ui, sans-serif;
  font-weight: 500;
  /* Big and proportional to the node so it scales with zoom and always
     fits. Floored so it stays legible on small / zoomed-out nodes. */
  font-size: clamp(14px, calc(0.28 * var(--cnode-h, 120px)), 96px);
  line-height: 1;
  color: #2a2d33;                        /* same grey as the track */
  letter-spacing: -0.02em;
}
body.rb-ed-light .cnode-progress-track,
body.rb-ed-light .cnode-progress-num {
  color: #c4c4c2;
  stroke: #c4c4c2;
}
```

Note: `--cnode-h` is set in Task 4 so the number scales with node height. The `clamp()` floor (14px) keeps it readable even if that var is missing.

- [ ] **Step 2: Remove the dead Uiverse spin styles**

In `packages/web-shell/app/globals.css`, delete the entire block from `.cnode-gen-border {` through the `body.rb-ed-light .cnode-gen-face { ... }` rule (the `.cnode-gen-border`, `.cnode-spin`, `.cnode-spin::before`, `.cnode-spin-blur`, `.cnode-spin-intense`, `.cnode-spin-inside` and their `::before`, `@keyframes cnode-speen`, `.cnode-gen-face`, and its light-mode variant — originally lines ~4994–5045).

- [ ] **Step 3: Remove the dead run-status chip styles**

In `packages/web-shell/app/globals.css`, delete the `.cnode-run-status`, `.cnode-run-spin`, `.cnode-run-step`, `.cnode-run-label`, and both `body.rb-ed-light .cnode-run-status` / `.cnode-run-label` rules (originally lines ~5402–5446).

- [ ] **Step 4: Verify the app still compiles**

Run: `cd packages/web-shell && npx vitest run`
Expected: PASS — full suite still green (CSS removal does not affect tests; this confirms nothing imports the removed selectors via JS).

- [ ] **Step 5: Commit**

```bash
git add packages/web-shell/app/globals.css
git commit -m "feat(canvas): progress-ring CSS; drop dead spin + run-status styles"
```

---

## Task 4: Wire the ring into CanvasNode; drop the spin + chip JSX

**Files:**
- Modify: `packages/web-shell/components/CanvasNode.jsx`

- [ ] **Step 1: Import the ring and helpers**

At the top of `packages/web-shell/components/CanvasNode.jsx`, next to the existing `import { nodeOrigin } from '../lib/node-origin.js';` (line 6), add:

```jsx
import { NodeProgressRing, useGenerationProgress } from './NodeProgressRing.jsx';
import { estimatedDurationMs } from '../lib/generation-progress.js';
```

- [ ] **Step 2: Compute the active flag, duration, and pct**

In the `CanvasNode` component body, just after `const origin = nodeOrigin(node);` (around line 758), add:

```jsx
  // Generation feedback: the progress ring shows whenever the node is
  // producing content (capture stream, run-flow, image gen). Excludes the
  // challenge state, which is "waiting for a human", not "working".
  const generating =
    (node._loading && !node._challenge) ||
    node.meta?.status === 'generating' ||
    !!runStatus;
  const genPct = useGenerationProgress(generating, estimatedDurationMs(node));
```

- [ ] **Step 3: Replace the spin border block with the ring**

In `packages/web-shell/components/CanvasNode.jsx`, replace the entire existing block (originally lines 767–781):

```jsx
      {/* Generating border — Uiverse spin effect while content is being
          produced INTO this node (capture stream, image generation,
          run-flow). Skipped for the challenge state, which is "waiting
          for a human", not "working". */}
      {((node._loading && !node._challenge) || node.meta?.status === 'generating' || !!runStatus) && (
        <div className="cnode-gen-border" aria-hidden="true">
          <div className="cnode-spin cnode-spin-blur" />
          <div className="cnode-spin cnode-spin-intense" />
          <div className="cnode-spin cnode-spin-inside" />
          {/* Solid card face — occludes the spinning gradients inside the
              node (translucent frosted bodies would let them bleed
              through), leaving only the ring + outer halo visible. */}
          <div className="cnode-gen-face" />
        </div>
      )}
```

with (the ring needs the node's real dimensions to draw a perimeter that hugs the frame; height falls back to the 16:9 default when unset):

```jsx
      {/* Generation progress ring — category-coloured outline filling
          clockwise from 12 o'clock + a large grey % in the centre. The
          percentage is a reassurance estimate; the ring is swapped out
          for the real content the instant generation finishes. */}
      {generating && (
        <NodeProgressRing
          pct={genPct}
          width={node.width}
          height={node.height || Math.round(node.width * 9 / 16)}
        />
      )}
```

- [ ] **Step 4: Remove the run-status text chip**

In `packages/web-shell/components/CanvasNode.jsx`, delete the entire block (originally lines 790–802):

```jsx
      {/* Run-flow status chip — appears below the node while a target is
          being processed. Drives a 3-step animation so the user knows
          the system is alive during the long LLM call. */}
      {runStatus && (
        <div className="cnode-run-status" aria-live="polite">
          <svg className="cnode-run-spin" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" opacity="0.25"/>
            <path d="M21 12a9 9 0 0 1-9 9"/>
          </svg>
          <span className="cnode-run-step">{runStatus.step}/3</span>
          <span className="cnode-run-label">{runStatus.label}</span>
        </div>
      )}
```

(Leave the `runStatus` prop and the `generating` flag that reads it — only the chip's rendered markup is removed.)

- [ ] **Step 5: Feed node height to the CSS so the number scales**

In `packages/web-shell/components/CanvasNode.jsx`, find the root node `<div>` style (around line 762):

```jsx
      style={{ left: node.pos_x, top: node.pos_y, width: node.width }}
```

Replace it with (adds the `--cnode-h` custom property used by `.cnode-progress-num`):

```jsx
      style={{ left: node.pos_x, top: node.pos_y, width: node.width, '--cnode-h': `${node.height}px` }}
```

- [ ] **Step 6: Run the full test suite**

Run: `cd packages/web-shell && npx vitest run`
Expected: PASS — full suite green, including the new Task 1 + Task 2 tests.

- [ ] **Step 7: Commit**

```bash
git add packages/web-shell/components/CanvasNode.jsx
git commit -m "feat(canvas): show progress ring on generating nodes; drop spin + run chip"
```

---

## Task 5: Remove dead SVG filter defs + visual verification

**Files:**
- Modify: `packages/web-shell/components/CanvasClient.jsx`

- [ ] **Step 1: Remove the unused filter defs**

The `#uncraft-unopaq`, `#uncraft-unopaq2`, `#uncraft-unopaq3` SVG filters (originally `CanvasClient.jsx` lines ~3233–3239) were only used by the deleted `.cnode-spin*` CSS. Delete the three `<filter>` elements. If they sit inside an otherwise-empty `<svg>`/`<defs>` wrapper that exists solely for them, remove that wrapper too. Leave any filter or def used elsewhere — grep first:

Run: `cd packages/web-shell && grep -rn "uncraft-unopaq" components/ app/`
Expected after edit: no matches.

- [ ] **Step 2: Run the full test suite**

Run: `cd packages/web-shell && npx vitest run`
Expected: PASS — full suite green.

- [ ] **Step 3: Visual verification in the browser**

Start the dev server and clone a real site (or generate an image) to watch the ring live:

Run: `cd packages/web-shell && npm run dev`
Then, in the canvas, trigger a generation and confirm:
- The node's border fills clockwise from top-center in the category color (blue for a cloned URL, violet for an image).
- A large grey `NN%` sits centered, climbing then decelerating, and **never** hits 100%.
- When the result arrives, the ring vanishes and the content shows — at whatever number it was on.
- Track is solid dark grey; stroke width matches the selected-node ring; both stay constant when zooming the canvas; the number scales with the node.
- Light mode: track + number read as light grey, still legible.
- **Contrast check:** if the dark-grey number is too faint over the near-black loading body, lighten `#2a2d33` one step (e.g. `#3a3e45`) in both `.cnode-progress-track`/`.cnode-progress-num` and re-check. This is the one tuning call flagged in the spec.

- [ ] **Step 4: Commit**

```bash
git add packages/web-shell/components/CanvasClient.jsx
git commit -m "chore(canvas): drop unused uncraft-unopaq SVG filters (spin removed)"
```

---

## Self-Review notes

- **Spec coverage:** estimate-not-real-progress (Task 1 curve + comments) ✓; no-100% asymptote (Task 1 `ASYMPTOTE=95`, Task 2 hook test "never exceeds 95") ✓; no stage text / chip removed (Task 4 Step 4) ✓; unified across paths (`generating` flag covers all three triggers) ✓; arc follows rounded-rect perimeter via SVG dashoffset, not conic (Task 2) ✓; not reusing box-shadow (new SVG) ✓; category color via `--cnode-port-fill` (Task 3 `.cnode-progress-arc`) ✓; solid dark-grey track + same-grey `NN%` number (Task 3) ✓; 12 o'clock clockwise (Task 2 `buildPerimeterPath` starts at `w/2,0`, rounded corners via arc commands) ✓; 3px non-scaling stroke (Task 3) ✓; resize/zoom/light-mode/error/challenge edge cases (Task 3 light vars, Task 4 `generating` excludes challenge, error path untouched) ✓; tests for hook + ring + pure fns (Tasks 1–2) ✓.
- **Placeholder scan:** no TBD/TODO; every code step shows full code; commands have expected output.
- **Type consistency:** `estimatedDurationMs(node)` / `progressAt(elapsedMs, durationMs)` / `useGenerationProgress(active, durationMs)` / `buildPerimeterPath(width, height, r)` / `NodeProgressRing({ pct, width, height })` used identically across Tasks 1, 2, 4. CSS classes `cnode-progress`, `cnode-progress-svg`, `cnode-progress-track`, `cnode-progress-arc`, `cnode-progress-num` match between Task 2 JSX and Task 3 CSS. `--cnode-h` defined in Task 4, consumed in Task 3.
