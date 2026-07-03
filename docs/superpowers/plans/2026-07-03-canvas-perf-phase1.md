# Canvas Performance Phase 1 (Motor) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the per-mousemove full-board re-render storm (drag/resize micro-lag) without changing ANY visible behavior.

**Architecture:** Four surgical changes, ordered by risk (safest first): (1) replace forced-reflow `getComputedStyle` scale reads in hot paths with a cheap read of the live zoom API; (2) coalesce drag/resize mousemove → at most one React update per animation frame; (3) stop EdgeLayer from recreating N ResizeObservers per drag frame + memoize it; (4) wrap each node in a memoized `CanvasNodeItem` using the latest-ref idiom so a drag re-renders ONLY the dragged node. No CSS changes, no new dependencies, no visual changes.

**Tech Stack:** React 19, Next.js 15, Vitest 4 + jsdom (run with bun), plain JavaScript (no TypeScript — project decision 2026-06-08).

## Global Constraints

- Plain JavaScript only — NO TypeScript syntax anywhere.
- web-shell files ONLY (`packages/web-shell/`). Do NOT touch `packages/editor-core/`, `editor/`, or `globals.css`.
- Every task ends with the FULL test suite green: `cd packages/web-shell && bun run test` (baseline recorded in Task 0; expect ≥521 passing, 0 failing).
- One commit per task, `git add` ONLY the files listed in that task (never `git add -A` — `.firecrawl/variant/` is untracked and contains pseudo-secrets; never stage it).
- Zero behavior change: same gestures, same visuals, same persistence timing. Only render frequency and layout-read frequency change.
- All user-facing text in English (there is none in this plan — no UI strings change).
- Package manager is bun (`bun.lock` is source of truth). No new dependencies.

## Risk Register (read before executing)

- **Pre-existing uncommitted work** in the working tree (CanvasClient.jsx, CanvasNode.jsx, globals.css, WorkingIndicator, prompts.js, tools/*, canvas-layout.*, untracked create-workflow.*). Task 0 commits it FIRST as its own checkpoint so Phase 1 diffs are isolated and independently revertible.
- **Stale-closure hazard** (Task 4): callbacks captured by a memoized component keep old state. The latest-ref idiom (`handlersRef.current.fn(...)` resolved AT EVENT TIME) is the mandatory pattern — never pass a raw handler through a memo boundary.
- **Gesture-end ordering** (Task 2): the coalescer MUST `flush()` before `onMoveEnd` fires, otherwise drop-commit logic (section adopt/tear-out) reads a position one frame stale.
- **Rollback:** each task is one commit; `git revert <sha>` of any single task restores the previous behavior without touching the others.

---

### Task 0: Baseline + safety checkpoint

**Files:**
- No source changes. Git + test baseline only.

**Interfaces:**
- Produces: a green baseline test count and a `wip:` checkpoint commit isolating pre-existing work from Phase 1.

- [ ] **Step 1: Run the full test suite and record the baseline**

Run: `cd /Users/adilsonporto/Desktop/IA/Uncraft/packages/web-shell && bun run test 2>&1 | tail -5`
Expected: all tests passing (≥521), 0 failures. Record the exact count — every later task must match or exceed it.

If ANY test fails at baseline: STOP. Report to the user before touching anything (the failure predates Phase 1 and must not be blamed on it or silently fixed).

- [ ] **Step 2: Commit the pre-existing uncommitted work as its own checkpoint**

```bash
cd /Users/adilsonporto/Desktop/IA/Uncraft
git add packages/web-shell/app/globals.css \
  packages/web-shell/components/CanvasClient.jsx \
  packages/web-shell/components/CanvasNode.jsx \
  packages/web-shell/components/chat/WorkingIndicator.jsx \
  packages/web-shell/components/chat/WorkingIndicator.test.jsx \
  packages/web-shell/components/node-bodies/PromptBody.jsx \
  packages/web-shell/lib/agent/prompts.js \
  packages/web-shell/lib/agent/tools/add-edge.js \
  packages/web-shell/lib/agent/tools/create-node.js \
  packages/web-shell/lib/agent/tools/index.js \
  packages/web-shell/lib/agent/tools/index.test.js \
  packages/web-shell/lib/canvas-layout.js \
  packages/web-shell/lib/canvas-layout.test.js \
  packages/web-shell/lib/agent/tools/create-workflow.js \
  packages/web-shell/lib/agent/tools/create-workflow.test.js
git commit -m "wip: checkpoint pre-existing session work before canvas perf phase 1

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Do NOT stage `.firecrawl/variant/` (untracked, contains pseudo-secrets).

- [ ] **Step 3: Verify the tree is clean (except .firecrawl/variant)**

Run: `git status --short`
Expected: only `?? .firecrawl/variant/` remains.

---

### Task 1: Cheap scale reads (`readCanvasScale`)

**Files:**
- Create: `packages/web-shell/lib/canvas-scale.js`
- Create: `packages/web-shell/lib/canvas-scale.test.js`
- Modify: `packages/web-shell/components/CanvasNode.jsx` (4 sites: lines ~557-560, ~607-610, ~692-695 — the three local `readScale` closures)
- Modify: `packages/web-shell/components/CanvasClient.jsx` (all `getComputedStyle(document.documentElement).getPropertyValue('--canvas-scale')` occurrences — lines ~895, ~2668, ~3095, ~4362, ~4432)

**Interfaces:**
- Produces: `readCanvasScale(): number` — current canvas zoom scale, > 0, defaults to 1. Consumed by Task 2's rewritten handlers.

**Why:** `getComputedStyle` forces a style/layout flush when the tree is dirty — which it always is mid-drag (each frame just wrote new inline styles). `window.__uncraftZoom.getScale()` (already exposed by CanvasClient at `CanvasClient.jsx:600-605`) reads react-zoom-pan-pinch's `transformState.scale` — a plain property access, no reflow, always current. The CSS-variable read stays as fallback (SSR, tests, zoom API unmounted).

- [ ] **Step 1: Write the failing test**

Create `packages/web-shell/lib/canvas-scale.test.js`:

```js
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readCanvasScale } from './canvas-scale.js';

afterEach(() => {
  delete window.__uncraftZoom;
  vi.restoreAllMocks();
});

describe('readCanvasScale', () => {
  it('prefers the live zoom API when available', () => {
    window.__uncraftZoom = { getScale: () => 0.42 };
    expect(readCanvasScale()).toBe(0.42);
  });

  it('falls back to the --canvas-scale CSS variable when the API is missing', () => {
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      getPropertyValue: () => '0.75',
    });
    expect(readCanvasScale()).toBe(0.75);
  });

  it('falls back to the CSS variable when the API returns a non-positive value', () => {
    window.__uncraftZoom = { getScale: () => 0 };
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      getPropertyValue: () => '0.5',
    });
    expect(readCanvasScale()).toBe(0.5);
  });

  it('returns 1 when nothing is available', () => {
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      getPropertyValue: () => '',
    });
    expect(readCanvasScale()).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/web-shell && bunx vitest run lib/canvas-scale.test.js`
Expected: FAIL — `Cannot find module './canvas-scale.js'` (or equivalent resolve error).

- [ ] **Step 3: Write the implementation**

Create `packages/web-shell/lib/canvas-scale.js`:

```js
// Cheap read of the current canvas zoom scale.
//
// Hot paths (drag/resize mousemove handlers, 60+ Hz) previously read the
// `--canvas-scale` CSS variable via getComputedStyle() on every event.
// getComputedStyle forces a style/layout flush when the tree is dirty —
// which it always is mid-drag (each frame just wrote new inline styles) —
// so every mousemove paid a synchronous reflow.
//
// window.__uncraftZoom.getScale() (exposed by CanvasClient) reads the
// react-zoom-pan-pinch transformState directly: a plain property access,
// no layout involvement, updated synchronously before onTransformed fires.
// The CSS-variable read stays as a fallback for contexts where the zoom
// API isn't mounted (SSR, tests, canvas unmounted).
export function readCanvasScale() {
  if (typeof window !== 'undefined') {
    const api = window.__uncraftZoom;
    if (api && typeof api.getScale === 'function') {
      const s = api.getScale();
      if (typeof s === 'number' && s > 0) return s;
    }
    if (typeof document !== 'undefined') {
      const v = parseFloat(
        window.getComputedStyle(document.documentElement).getPropertyValue('--canvas-scale')
      );
      if (v > 0) return v;
    }
  }
  return 1;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/web-shell && bunx vitest run lib/canvas-scale.test.js`
Expected: 4 passing.

- [ ] **Step 5: Swap the CanvasNode call sites**

In `packages/web-shell/components/CanvasNode.jsx`:

Add to the imports at the top of the file:
```js
import { readCanvasScale } from '../lib/canvas-scale.js';
```

Then delete each of the THREE local `readScale` closures and use `readCanvasScale()` at their call sites:

1. Inside `startDashResize` (~line 557): delete the 4-line `const readScale = () => {...}` block; in `move(ev)` change `const scale = readScale();` → `const scale = readCanvasScale();`
2. Inside the cursor-tracks-port effect (~line 607): delete the 4-line `function readScale() {...}`; in `onMove(e)` change `const scale = readScale();` → `const scale = readCanvasScale();`
3. Inside `onTopbarMouseDown` (~line 692): delete the 4-line `const readScale = () => {...}`; in `move(ev)` change `const scale = readScale();` → `const scale = readCanvasScale();`

- [ ] **Step 6: Swap the CanvasClient call sites**

In `packages/web-shell/components/CanvasClient.jsx`:

Add to the imports at the top of the file:
```js
import { readCanvasScale } from '../lib/canvas-scale.js';
```

Find EVERY occurrence of the pattern (5 expected — lines ~895, ~2668, ~3095, ~4362, ~4432):
```js
parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--canvas-scale')) || 1
```
(and variants that guard `> 0 ? v : 1`) and replace each full expression with:
```js
readCanvasScale()
```
Keep any surrounding logic (e.g. `TEAR_MARGIN / (scale > 0 ? scale : 1)` can stay as-is — `readCanvasScale()` already guarantees > 0, the extra guard is harmless).

Verify with: `grep -n "getPropertyValue('--canvas-scale')" components/CanvasClient.jsx components/CanvasNode.jsx` — Expected: no matches remain in either file.

- [ ] **Step 7: Run the FULL suite**

Run: `cd packages/web-shell && bun run test 2>&1 | tail -5`
Expected: baseline count + 4 new, 0 failures.

- [ ] **Step 8: Commit**

```bash
cd /Users/adilsonporto/Desktop/IA/Uncraft
git add packages/web-shell/lib/canvas-scale.js packages/web-shell/lib/canvas-scale.test.js \
  packages/web-shell/components/CanvasNode.jsx packages/web-shell/components/CanvasClient.jsx
git commit -m "perf(canvas): hot-path scale reads via zoom API instead of getComputedStyle

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: rAF-coalesced drag & resize

**Files:**
- Create: `packages/web-shell/lib/raf-coalesce.js`
- Create: `packages/web-shell/lib/raf-coalesce.test.js`
- Modify: `packages/web-shell/components/CanvasNode.jsx` (`startDashResize` ~line 554, `onTopbarMouseDown` ~line 676)

**Interfaces:**
- Consumes: `readCanvasScale()` from Task 1.
- Produces: `createRafCoalescer(fn) => { push(...args), flush(), cancel() }` — invokes `fn` at most once per animation frame with the LATEST pushed args. `flush()` cancels the pending frame and invokes synchronously with pending args (no-op when nothing pending). `cancel()` drops pending work.

**Why:** mousemove fires at the input-device rate (often 120–1000 Hz), and today EVERY event calls `onMove`/`onResize` → `setNodes` → full CanvasClient re-render. Screens paint at most once per frame; updates between paints are pure waste. Coalescing to one state update per frame is behavior-identical on screen.

- [ ] **Step 1: Write the failing test**

Create `packages/web-shell/lib/raf-coalesce.test.js`:

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRafCoalescer } from './raf-coalesce.js';

let frameCbs;

beforeEach(() => {
  frameCbs = new Map();
  let nextId = 1;
  vi.stubGlobal('requestAnimationFrame', (cb) => {
    const id = nextId++;
    frameCbs.set(id, cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id) => {
    frameCbs.delete(id);
  });
});

afterEach(() => vi.unstubAllGlobals());

function runFrame() {
  const cbs = [...frameCbs.values()];
  frameCbs.clear();
  cbs.forEach((cb) => cb());
}

describe('createRafCoalescer', () => {
  it('invokes once per frame with the latest args', () => {
    const fn = vi.fn();
    const c = createRafCoalescer(fn);
    c.push(1, 10);
    c.push(2, 20);
    c.push(3, 30);
    expect(fn).not.toHaveBeenCalled();
    runFrame();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(3, 30);
  });

  it('schedules a fresh frame for pushes after a fire', () => {
    const fn = vi.fn();
    const c = createRafCoalescer(fn);
    c.push(1);
    runFrame();
    c.push(2);
    runFrame();
    expect(fn.mock.calls).toEqual([[1], [2]]);
  });

  it('flush cancels the pending frame and fires synchronously', () => {
    const fn = vi.fn();
    const c = createRafCoalescer(fn);
    c.push(5, 6);
    c.flush();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(5, 6);
    runFrame(); // the cancelled frame must not double-fire
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('flush is a no-op when nothing is pending', () => {
    const fn = vi.fn();
    const c = createRafCoalescer(fn);
    c.flush();
    expect(fn).not.toHaveBeenCalled();
  });

  it('cancel drops pending work without invoking', () => {
    const fn = vi.fn();
    const c = createRafCoalescer(fn);
    c.push(9);
    c.cancel();
    runFrame();
    c.flush();
    expect(fn).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/web-shell && bunx vitest run lib/raf-coalesce.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `packages/web-shell/lib/raf-coalesce.js`:

```js
// Coalesce a high-frequency call stream (mousemove fires at the input
// device rate — often far above the display refresh rate) down to at most
// one invocation per animation frame, always with the LATEST arguments.
//
// One coalescer per gesture:
//   const emit = createRafCoalescer((x, y) => onMove(x, y));
//   emit.push(x, y);  // any number of times per frame
//   emit.flush();     // gesture end: cancel the pending frame and invoke
//                     // synchronously with the last args (no-op if none) —
//                     // MUST run before any gesture-end commit logic
//   emit.cancel();    // drop pending work without invoking
export function createRafCoalescer(fn) {
  let rafId = null;
  let lastArgs = null;

  function fire() {
    rafId = null;
    const args = lastArgs;
    lastArgs = null;
    if (args) fn(...args);
  }

  return {
    push(...args) {
      lastArgs = args;
      if (rafId == null) rafId = requestAnimationFrame(fire);
    },
    flush() {
      if (rafId != null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      if (lastArgs) {
        const args = lastArgs;
        lastArgs = null;
        fn(...args);
      }
    },
    cancel() {
      if (rafId != null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      lastArgs = null;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/web-shell && bunx vitest run lib/raf-coalesce.test.js`
Expected: 5 passing.

- [ ] **Step 5: Wire into `startDashResize` (CanvasNode.jsx ~line 554)**

Add to imports: `import { createRafCoalescer } from '../lib/raf-coalesce.js';`

Replace the body of `startDashResize` with (comments preserved from the original where still true):

```jsx
const startDashResize = useCallback((axis) => (e) => {
  e.stopPropagation();
  e.preventDefault();
  const start = {
    x: e.clientX, y: e.clientY,
    w: node.width || 1280,
    h: node.height || 800
  };
  // Coalesce to one onResize per frame — every call lands a setNodes()
  // in CanvasClient, and mousemove outpaces the display refresh.
  const emit = createRafCoalescer((w, h) => onResize?.(w, h));
  function move(ev) {
    const scale = readCanvasScale();
    const dx = (ev.clientX - start.x) / scale;
    const dy = (ev.clientY - start.y) / scale;
    const nextW = (axis === 'x' || axis === 'xy') ? Math.max(280, start.w + dx) : start.w;
    const nextH = (axis === 'y' || axis === 'xy') ? Math.max(120, start.h + dy) : start.h;
    emit.push(nextW, nextH);
  }
  function up() {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    // Final size must land before any post-gesture logic reads it.
    emit.flush();
    // Manual resize means the user moved away from the
    // "expanded" state — drop the toggle so the icon flips back
    // to Expand.
    setIsExpanded(false);
  }
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
}, [node.width, node.height, onResize]);
```

(Dep array unchanged. The pre-gesture comment block above the callback stays.)

- [ ] **Step 6: Wire into `onTopbarMouseDown` (CanvasNode.jsx ~line 676)**

Replace the drag portion (keep the Alt-duplicate branch and everything above `const start = ...` exactly as-is):

```jsx
  const start = { x: e.clientX, y: e.clientY, ox: node.pos_x, oy: node.pos_y, moved: false };
  // Coalesce to one onMove per frame (each one is a full setNodes pass in
  // CanvasClient). onMoveStart still fires synchronously at threshold-
  // crossing; flush() on mouseup guarantees onMoveEnd sees the final
  // position (adopt/tear-out commit reads drag.lastX/lastY).
  const emit = createRafCoalescer((x, y) => onMove(x, y));
  function move(ev) {
    const scale = readCanvasScale();
    const dx = (ev.clientX - start.x) / scale;
    const dy = (ev.clientY - start.y) / scale;
    if (!start.moved && Math.hypot(dx, dy) * scale < DRAG_THRESHOLD) return;
    if (!start.moved) {
      start.moved = true;
      // Fires once, before the first onMove, so the canvas can snapshot
      // pre-drag state (section frame carry + adoption preview baseline).
      onMoveStart?.();
    }
    emit.push(start.ox + dx, start.oy + dy);
  }
  function up() {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    emit.flush();
    onMoveEnd?.(start.moved);
  }
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
}, [node.pos_x, node.pos_y, onMove, onMoveStart, onMoveEnd, onSelect, onAltDuplicateDrag]);
```

**CRITICAL:** `emit.flush()` MUST precede `onMoveEnd?.(start.moved)` — `handleNodeMoveEnd` reads `looseDragRef.current.lastX/lastY`, which `maybeUpdateAdoptPreview` updates inside the coalesced `onMove`.

- [ ] **Step 7: Run the FULL suite**

Run: `cd packages/web-shell && bun run test 2>&1 | tail -5`
Expected: Task 1 count + 5 new, 0 failures.

- [ ] **Step 8: Commit**

```bash
cd /Users/adilsonporto/Desktop/IA/Uncraft
git add packages/web-shell/lib/raf-coalesce.js packages/web-shell/lib/raf-coalesce.test.js \
  packages/web-shell/components/CanvasNode.jsx
git commit -m "perf(canvas): coalesce drag/resize to one state update per frame

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: EdgeLayer — stable measured-heights + memo

**Files:**
- Modify: `packages/web-shell/components/EdgeLayer.jsx` (`useMeasuredHeights` ~line 63, export ~line 123)
- Modify: `packages/web-shell/components/CanvasClient.jsx` (EdgeLayer props ~line 4819-4830; add stable callbacks near `updateNodeLocal` ~line 693)

**Interfaces:**
- Consumes: nothing new.
- Produces: `EdgeLayer` default export is now `memo(EdgeLayer)` — same props contract. CanvasClient passes `onSelectEdgeStable`, `onEdgeDragStartStable`, `onSeverEdgeStable` (identical signatures to the previous inline arrows).

**Why (two independent fixes):**
1. `useMeasuredHeights`'s effect is keyed on the `nodes` ARRAY IDENTITY — recreated every drag frame — so every frame disconnects and recreates N ResizeObservers AND runs `measure()` (N `querySelector` + N `offsetHeight` forced-layout reads). Node position changes never change `offsetHeight`; only membership changes need new observers. Key the effect on the ids instead.
2. EdgeLayer re-renders on EVERY CanvasClient render (chat stream ticks, selection changes, run status...) even when nothing edge-related changed. `memo` fixes that — but only if the three callback props stop being fresh inline arrows each render.

- [ ] **Step 1: Rewrite `useMeasuredHeights` keyed on node ids**

In `packages/web-shell/components/EdgeLayer.jsx`, replace the whole `useMeasuredHeights` function with:

```jsx
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
```

Note: node ids are UUIDs or `temp-<n>` strings — `|` never appears in them, and map keys stay the same strings as before (`heights.get(a.id)` continues to hit).

- [ ] **Step 2: Memoize EdgeLayer**

In the same file:
- Change the react import: `import { useEffect, useState, useMemo, memo } from 'react';`
- Change `export default function EdgeLayer({ ... }) {` → `function EdgeLayer({ ... }) {`
- After the closing brace of `EdgeLayer` (before the `DraftEdgeLayer` comment), add:

```jsx
export default memo(EdgeLayer);
```

`DraftEdgeLayer` stays exactly as-is (it early-returns `null` without a draft, and during a draft its inputs legitimately change per frame).

- [ ] **Step 3: Stabilize the three EdgeLayer callbacks in CanvasClient**

In `packages/web-shell/components/CanvasClient.jsx`, directly AFTER the `updateNodeLocal` declaration (~line 695), add:

```jsx
  // EdgeLayer is memoized — its callback props must keep a stable identity
  // or the memo never hits. Latest-ref idiom: the stable wrappers resolve
  // the CURRENT implementation off edgeHandlersRef at event time (the ref
  // is re-pointed every render), so there are no stale closures.
  const edgeHandlersRef = useRef({});
  edgeHandlersRef.current = {
    selectEdge: (edge) => {
      setSelectedEdgeId(edge.id);
      setSelectedNodeId(null);
    },
    edgeDragStart: (edge, evt) => startEdgeReroute(edge, evt),
    severEdge: (edge) => handleDeleteEdge(edge),
  };
  const onSelectEdgeStable = useCallback((edge) => edgeHandlersRef.current.selectEdge(edge), []);
  const onEdgeDragStartStable = useCallback((edge, evt) => edgeHandlersRef.current.edgeDragStart(edge, evt), []);
  const onSeverEdgeStable = useCallback((edge) => edgeHandlersRef.current.severEdge(edge), []);
```

(`startEdgeReroute` and `handleDeleteEdge` are function declarations — hoisted, safe to reference here; they are only CALLED at event time.)

- [ ] **Step 4: Swap the EdgeLayer JSX props (~line 4819)**

```jsx
          <EdgeLayer
            nodes={nodes} edges={edges}
            incomingByTarget={incomingByTarget}
            scale={canvasScale}
            selectedEdgeId={selectedEdgeId}
            onSelectEdge={onSelectEdgeStable}
            onEdgeDragStart={onEdgeDragStartStable}
            onSeverEdge={onSeverEdgeStable}
          />
```

- [ ] **Step 5: Run the FULL suite**

Run: `cd packages/web-shell && bun run test 2>&1 | tail -5`
Expected: same count as after Task 2, 0 failures.

- [ ] **Step 6: Commit**

```bash
cd /Users/adilsonporto/Desktop/IA/Uncraft
git add packages/web-shell/components/EdgeLayer.jsx packages/web-shell/components/CanvasClient.jsx
git commit -m "perf(canvas): EdgeLayer memo + measured-heights keyed on ids (no observer churn per drag frame)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Memoized `CanvasNodeItem` (drag re-renders only the dragged node)

**Files:**
- Create: `packages/web-shell/components/CanvasNodeItem.jsx`
- Modify: `packages/web-shell/components/CanvasClient.jsx` (extract 4 inline handlers to named functions; add `nodeHandlersRef`; replace the `nodes.map` block ~line 4831-4938)

**Interfaces:**
- Consumes: all existing CanvasClient handlers (unchanged signatures), plus 4 extracted ones defined in this task: `handleNodeSelect(n, e)`, `handleNodeResize(n, width, height, opts)`, `handleNodeDeleteRequest(n)`, `handleNodeMetaPatch(id, metaPatch)`.
- Produces: `CanvasNodeItem` — memoized wrapper with props `{ node, scale, debit, incomingEdges, hasOutgoingEdges, selected, placing, editing, runStatus, draftActive, removing, removingOutside, removeFromMenu, inSection, handlersRef }`. Renders `CanvasNode` with the exact same prop contract CanvasNode has today.

**Why:** `updateNodeLocal` already preserves object identity for untouched nodes (`prev.map((n) => n.id === id ? {...n, ...patch} : n)`), but every node re-renders anyway because the 25 callback props are fresh inline arrows each render. Moving callback creation into a memoized wrapper that resolves handlers through a ref at event time means: drag frame → only the dragged node's `node` prop changed → only IT re-renders. N−1 nodes skip. Same for selection changes, chat ticks, run status.

**SAFETY MODEL (mandatory reading):** a memoized component skips re-renders, so anything it captured at mount can go stale. EVERY handler call goes through `handlersRef.current.<fn>` resolved AT EVENT TIME; CanvasClient re-points `handlersRef.current` on every render. Handlers are therefore always fresh. NEVER pass a raw CanvasClient function as a prop to CanvasNodeItem.

- [ ] **Step 1: Extract the four inline handler bodies in CanvasClient**

In `packages/web-shell/components/CanvasClient.jsx`, add these as component-scope function declarations, directly BEFORE `function handleNodeMove(node, posX, posY)` (~line 965). The bodies are MOVED VERBATIM from the current inline props in the `nodes.map` (lines ~4842-4926) — including comments:

```jsx
  function handleNodeSelect(n, e) {
    const shift = !!e?.shiftKey;
    if (shift) {
      // Shift-click toggles this node in the multi-select set —
      // add if absent, remove if already there. Matches Figma /
      // Linear additive selection convention.
      //
      // Important: when toggling OFF, do NOT promote this node
      // to selectedNodeId. The `selected` prop on CanvasNode
      // is the OR of (selectedNodeId === id, selectedNodeIds
      // has id), so setting selectedNodeId to a node we just
      // removed from the set keeps it visually selected on
      // half the clicks. Only set selectedNodeId when adding.
      const alreadyIn = selectedNodeIds.has(n.id) || selectedNodeId === n.id;
      if (alreadyIn) {
        setSelectedNodeIds((s) => {
          if (!s.has(n.id)) return s;
          const next = new Set(s);
          next.delete(n.id);
          return next;
        });
        if (selectedNodeId === n.id) setSelectedNodeId(null);
      } else {
        setSelectedNodeIds((s) => {
          const next = new Set(s);
          next.add(n.id);
          return next;
        });
        setSelectedNodeId(n.id);
      }
    } else {
      setSelectedNodeId(n.id);
      // Single-click clears any prior marquee selection so the
      // click is unambiguous.
      setSelectedNodeIds((s) => (s.size ? new Set() : s));
    }
    setSelectedEdgeId(null);
    setSelectedSectionId(null);
    setPopupPos(null);
    // Steal focus from any text input (notably the PromptDock
    // textarea) so a follow-up Delete keypress reaches the
    // canvas keydown handler instead of falling through to a
    // character delete inside the input. Matches Figma /
    // Linear behaviour where clicking a node moves keyboard
    // focus to the canvas.
    if (typeof document !== 'undefined') {
      const ae = document.activeElement;
      if (ae && (ae.tagName === 'TEXTAREA' || ae.tagName === 'INPUT') && typeof ae.blur === 'function') {
        ae.blur();
      }
    }
  }

  function handleNodeResize(n, width, height, opts) {
    const patch = { width };
    if (typeof height === 'number' && height > 0) patch.height = height;
    updateNodeLocal(n.id, patch);
    if (!String(n.id).startsWith('temp-')) {
      api.updateNode(n.id, patch).catch(console.warn);
    }
    // Cascade flag is set by the Expand floater so that
    // expanding a node into another node's space pushes the
    // neighbour out (donors → left, receivers → right). Drag
    // resize doesn't cascade — that would feel jittery.
    if (opts?.cascade) cascadeOverlapShift(n.id, width, patch.height ?? n.height);
  }

  function handleNodeDeleteRequest(n) {
    setNodeDelete({ id: n.id, name: (n.name || '').trim() });
  }

  function handleNodeMetaPatch(id, metaPatch) {
    setNodes((prev) => prev.map((nn) => (
      nn.id === id ? { ...nn, meta: { ...(nn.meta || {}), ...metaPatch } } : nn
    )));
  }
```

- [ ] **Step 2: Add the node handlers ref**

Near the other refs at the top of CanvasClient (right after `const edgeHandlersRef` block from Task 3), add the DECLARATION only:

```jsx
  // Handler table for the memoized CanvasNodeItem wrappers. Re-pointed on
  // every render (assignment lives right before the JSX return, after all
  // handler consts are initialized); items resolve handlers through it at
  // event time, so memoized nodes never hold stale logic.
  const nodeHandlersRef = useRef({});
```

Then, immediately BEFORE the component's main `return (` statement, add the assignment:

```jsx
  nodeHandlersRef.current = {
    handleEditingToggle,
    handleNodeSelect,
    handleNodeMove,
    handleNodeMoveStart,
    handleNodeMoveEnd,
    startAltDuplicateDrag,
    handleNodeResize,
    handleNodeDeleteRequest,
    handleResetNode,
    handleRestoreVersion,
    handleSaveNodeEdit,
    handleDiscardNodeEdit,
    handleDuplicateNode,
    handleDownloadNode,
    startEdgeFromNode,
    onSlotMouseDown,
    handlePromptTextChange,
    handleNodeMetaPatch,
    handleReplaceContent,
    handlePopulateNode,
    zoomToNode,
    armNodeRemoval,
    cancelNodeRemoval,
  };
```

If any of these names is not defined in CanvasClient (signature drift since this plan was written), STOP and re-check the `nodes.map` block — the table must contain exactly the handlers the current inline props call.

- [ ] **Step 3: Create the memoized wrapper**

Create `packages/web-shell/components/CanvasNodeItem.jsx`:

```jsx
'use client';

import { memo } from 'react';
import CanvasNode from './CanvasNode.jsx';

// Memoized per-node wrapper. CanvasClient re-renders on every canvas-wide
// state change (drag frames, chat stream ticks, selection, run status) and
// previously re-rendered ALL CanvasNode subtrees each time — the callback
// props were fresh inline arrows every render, so no memo could ever hit.
// This wrapper owns the per-node callback creation; CanvasClient passes
// only data props (updateNodeLocal preserves object identity for untouched
// nodes), so React.memo skips every node whose own data didn't change —
// during a drag, all but the dragged one.
//
// SAFETY MODEL — no stale closures: every callback resolves the CURRENT
// handler through handlersRef.current AT EVENT TIME. CanvasClient
// re-points handlersRef.current on every render, so handlers always see
// fresh state; the ref object identity itself never changes, so it never
// breaks memoization. Never pass a raw CanvasClient function directly.
function CanvasNodeItem({
  node, scale, debit, incomingEdges, hasOutgoingEdges, selected, placing,
  editing, runStatus, draftActive, removing, removingOutside, removeFromMenu,
  inSection, handlersRef,
}) {
  const h = () => handlersRef.current;
  return (
    <CanvasNode
      node={node}
      scale={scale}
      debit={debit}
      incomingEdges={incomingEdges}
      hasOutgoingEdges={hasOutgoingEdges}
      selected={selected}
      placing={placing}
      editing={editing}
      runStatus={runStatus}
      draftActive={draftActive}
      removing={removing}
      removingOutside={removingOutside}
      removeFromMenu={removeFromMenu}
      inSection={inSection}
      onEditingChange={(willEdit) => h().handleEditingToggle(node.id, willEdit)}
      onSelect={(e) => h().handleNodeSelect(node, e)}
      onMove={(posX, posY) => h().handleNodeMove(node, posX, posY)}
      onMoveStart={() => h().handleNodeMoveStart(node)}
      onMoveEnd={(moved) => h().handleNodeMoveEnd(node, moved)}
      onAltDuplicateDrag={(e) => h().startAltDuplicateDrag(node, e)}
      onResize={(width, height, opts) => h().handleNodeResize(node, width, height, opts)}
      onDelete={() => h().handleNodeDeleteRequest(node)}
      onReset={() => h().handleResetNode(node.id)}
      onVersionRestore={(snapshotId) => h().handleRestoreVersion(node.id, snapshotId)}
      onSaveEdit={(html) => h().handleSaveNodeEdit(node.id, html)}
      onDiscardEdit={() => h().handleDiscardNodeEdit(node.id)}
      onDuplicate={() => h().handleDuplicateNode(node.id)}
      onDownload={() => h().handleDownloadNode(node.id)}
      onStartEdge={(e, side) => h().startEdgeFromNode(node.id, e, side)}
      onSlotMouseDown={(...args) => h().onSlotMouseDown(...args)}
      onPromptTextChange={(value) => h().handlePromptTextChange(node.id, value)}
      onMetaPatch={(metaPatch) => h().handleNodeMetaPatch(node.id, metaPatch)}
      onReplaceContent={(...args) => h().handleReplaceContent(...args)}
      onRequestUpload={() => h().handlePopulateNode(node)}
      onFrameZoom={() => h().zoomToNode(node, 350, 1)}
      onRemoveFromSection={() => h().armNodeRemoval(node)}
      onCancelRemove={(...args) => h().cancelNodeRemoval(...args)}
    />
  );
}

export default memo(CanvasNodeItem);
```

Before writing this file, cross-check every `onX` prop and its call shape against the CURRENT `nodes.map` block in CanvasClient — the mapping above mirrors lines ~4831-4937 as of plan-writing. Any drift (new prop, changed args) must be mirrored, not guessed.

- [ ] **Step 4: Replace the `nodes.map` block in CanvasClient**

Add the import at the top of CanvasClient.jsx:
```js
import CanvasNodeItem from './CanvasNodeItem.jsx';
```

Add near the other module-level constants (top of file, outside the component):
```js
// Stable empty array for nodes without incoming edges — a fresh [] per
// render would defeat CanvasNodeItem's memo for every edge-less node.
const EMPTY_EDGES = [];
```

Replace the ENTIRE `{nodes.map((n) => ( <CanvasNode ... /> ))}` block (~lines 4831-4938) with:

```jsx
          {nodes.map((n) => (
            <CanvasNodeItem
              key={n.id}
              node={n}
              scale={canvasScale}
              debit={nodeDebits.get(n.id)}
              incomingEdges={incomingByTarget.get(n.id) || EMPTY_EDGES}
              hasOutgoingEdges={hasOutgoingBySource.has(n.id)}
              selected={selectedNodeId === n.id || selectedNodeIds.has(n.id)}
              placing={placingNodeId === n.id || altDupGhostId === n.id}
              editing={editingNodeId === n.id}
              runStatus={runStatus.get(n.id) || null}
              draftActive={!!draftEdge && draftEdge.sourceNodeId !== n.id}
              removing={removing?.nodeId === n.id}
              removingOutside={removing?.nodeId === n.id && removingOutside}
              removeFromMenu={removing?.nodeId === n.id && !!removing.fromMenu}
              inSection={sectionMemberIds.has(n.id)}
              handlersRef={nodeHandlersRef}
            />
          ))}
```

- [ ] **Step 5: Run the FULL suite**

Run: `cd packages/web-shell && bun run test 2>&1 | tail -5`
Expected: same count as after Task 3 (no new tests in this task — the wrapper is exercised by the manual smoke in Task 5), 0 failures.

- [ ] **Step 6: Commit**

```bash
cd /Users/adilsonporto/Desktop/IA/Uncraft
git add packages/web-shell/components/CanvasNodeItem.jsx packages/web-shell/components/CanvasClient.jsx
git commit -m "perf(canvas): memoized CanvasNodeItem — drag re-renders only the dragged node

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Verification — full suite + browser smoke checklist

**Files:**
- No source changes.

- [ ] **Step 1: Full suite one last time**

Run: `cd packages/web-shell && bun run test 2>&1 | tail -5`
Expected: baseline + 9 new tests, 0 failures.

- [ ] **Step 2: Start the dev server**

Run: `cd packages/web-shell && bun run dev` (port 3030). No API keys needed — the smoke below avoids LLM/credit operations.

- [ ] **Step 3: Browser smoke checklist (every routed handler must be exercised)**

Feel checks (the point of Phase 1):
- [ ] Drag a node continuously for 5+ seconds on a board with several nodes — cursor tracking should feel tighter than before; edges follow the node live.
- [ ] Resize via bottom / right / corner dash handles — live feedback, no jump on release.
- [ ] Wheel-zoom in/out across 10%–250% — no regression vs before (zoom path is Phase 2; it must simply not get worse).

Correctness checks (each maps to a handler routed through `handlersRef` / stable callbacks):
- [ ] Click-select a node; shift-click a second (both ringed); shift-click again to untoggle.
- [ ] Drag a node INTO a section frame → adopt preview appears → drop commits adoption.
- [ ] Drag a member OUT of its section past the tear margin → removal arms (amber) → drop outside commits, drop back inside cancels.
- [ ] Alt+drag a node → ghost duplicate follows cursor → drops as a copy.
- [ ] Drag a cord from a right port to another node's left slot → edge created. Click mid-cord → scissors severs it. Click a cord → selects it. Drag a cord end → re-routes.
- [ ] Edit mode: Edit → type in the site → Done saves; Edit → Cancel → Discard reverts.
- [ ] Node context menu: Duplicate, Download, Reset (confirm modal), Delete (confirm chip shows the node name).
- [ ] Version floater: restore an older snapshot.
- [ ] Prompt node: type text (persists), resize via corner handle.
- [ ] Asset node: hover shows Replace content overlay; upload replaces.
- [ ] Frame-zoom button zooms to the node.
- [ ] Cursor over a tall node: right-port ball slides with cursor (cursor-tracks-port).
- [ ] Reload the page after dragging — position persisted (the 250ms debounced PATCH still fires).

If ANY check fails: `git revert` the most recent task commit, re-run the checklist to confirm the failure disappears, and report which task caused it. Do not stack fixes on top of an unverified regression.

- [ ] **Step 4: Report results to the user**

Summarize: what changed, test counts, which smoke items passed, any item needing their eyes.

---

## Explicitly OUT of scope for Phase 1 (do not touch)

- Zoom-tick re-render cost (`setCanvasScale` → full render) and the 220 counter-scale CSS `calc()`s — Phase 2 (jitter/tremor).
- Iframe freezing/screenshot swap, `image-rendering`, backdrop-filter inside the canvas — Phases 2/3 (crispness).
- Section-move, marquee, and alt-dup-ghost mousemove paths — candidates for the same rAF coalescer later; not part of the reported symptom's hot path.
- `editor-core` / extension shell — nothing here syncs to it.
