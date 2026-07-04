# Canvas Performance Phase 2 (Zoom smoothness + pixel jitter) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Checkbox steps.

**Goal:** Make wheel-zoom smooth (no per-event work storms) and stop the "pixels micro-moving" shimmer during zoom — with at most design-system-aligned visual normalization (no redesign).

**Architecture:** Five incremental changes, safest first: (1) batch wheel zoom/pan input to one transform update per frame; (2) a `canvas-interacting` gesture class that pauses in-world CSS animations/transitions while zooming/panning; (3) time-gate the React `setCanvasScale` push (CSS keeps tracking live; JS-computed chrome settles ≤140ms later); (4) remove `backdrop-filter` from elements INSIDE the zoomed world (aligned with the DESIGN.md solid-dropdown standard); (5) pixel-snap the scale-dependent border widths and shadows with CSS `round()` so fractional values stop flipping between pixel grids per tick.

**Tech Stack:** plain JS, React 19, CSS in `globals.css` (web-shell only; editor-core untouched).

## Global Constraints

- Full suite green after every task (`cd packages/web-shell && bun run test`, baseline 547).
- One commit per task; never stage `.firecrawl/variant/`.
- Zoom-out floors (`max(0.15, …)`) and all sizing formulas KEEP their values — no behavior/visual redesign. Task 4 is the only visual delta (blur → solid, sanctioned by DESIGN.md "click dropdowns are SOLID").
- CSS `round()` must ship with a plain `calc()` fallback line above it (older browsers ignore the invalid declaration).

---

### Task 1: Batch wheel zoom/pan input to one transform per frame

**Files:**
- Create: `packages/web-shell/lib/wheel-batch.js`
- Create: `packages/web-shell/lib/wheel-batch.test.js`
- Modify: `packages/web-shell/components/CanvasClient.jsx` (`onWheelCapture` effect ~line 3609-3673)

**Why:** wheel events outpace the display. Each one currently calls `zoomAtPoint`/`panBy` → `setTransform` → `onTransformed` → CSS-var write + class toggles (+ sometimes React state) synchronously. Summing deltas and applying once per frame is mathematically identical (`exp(a)·exp(b) = exp(a+b)`), and cuts the whole downstream pipeline to ≤1 run per frame.

- [ ] **Step 1: failing test** — `lib/wheel-batch.test.js`: stub rAF (same harness as raf-coalesce.test.js); assert (a) multiple `addPan` calls sum into ONE `onPan(dxSum, dySum)` per frame; (b) multiple `addZoom` sum `deltaY` and pass the LATEST `cx, cy`; (c) pan and zoom in the same frame both fire (pan first); (d) nothing pending → frame fires nothing; (e) `cancel()` drops pending.
- [ ] **Step 2: implement** `lib/wheel-batch.js`:

```js
// Batch wheel-gesture input to one transform update per animation frame.
// Wheel events fire at device rate (often 120–480 Hz); each zoom/pan apply
// runs the full downstream pipeline (setTransform → onTransformed → CSS var
// broadcast → style recalc). Deltas SUM (exp(a)·exp(b) === exp(a+b) for the
// zoom factor), the anchor point uses the latest cursor position.
export function createWheelBatcher({ onPan, onZoom }) {
  let pending = null;
  let rafId = null;
  function fire() {
    rafId = null;
    const p = pending;
    pending = null;
    if (!p) return;
    if (p.panX || p.panY) onPan(p.panX, p.panY);
    if (p.zoomDelta) onZoom(p.zoomDelta, p.cx, p.cy);
  }
  function ensure() {
    if (rafId == null) rafId = requestAnimationFrame(fire);
  }
  function blank() {
    return { panX: 0, panY: 0, zoomDelta: 0, cx: 0, cy: 0 };
  }
  return {
    addPan(dx, dy) {
      pending = pending || blank();
      pending.panX += dx;
      pending.panY += dy;
      ensure();
    },
    addZoom(deltaY, cx, cy) {
      pending = pending || blank();
      pending.zoomDelta += deltaY;
      pending.cx = cx;
      pending.cy = cy;
      ensure();
    },
    cancel() {
      if (rafId != null) cancelAnimationFrame(rafId);
      rafId = null;
      pending = null;
    },
  };
}
```

- [ ] **Step 3: wire** — in the wheel effect, create the batcher once per effect run and route the two call sites; cancel on cleanup:

```js
    const batcher = createWheelBatcher({
      onPan: (dx, dy) => window.__uncraftZoom?.panBy?.(dx, dy),
      onZoom: (dz, cx, cy) => window.__uncraftZoom?.zoomAtPoint?.(dz, cx, cy),
    });
```
`zoomAtPoint` call site → `batcher.addZoom(e.deltaY || 0, e.clientX, e.clientY);`
`panBy` call site → `batcher.addPan(-(e.deltaX || 0), -(e.deltaY || 0));`
cleanup → add `batcher.cancel();`

- [ ] **Step 4:** full suite green → commit `perf(canvas): batch wheel zoom/pan input to one transform per frame`.

---

### Task 2: `canvas-interacting` gesture class — pause in-world animations/transitions

**Files:**
- Modify: `packages/web-shell/components/CanvasClient.jsx` (`onTransformed` ~4847; add `interactingTimerRef`)
- Modify: `packages/web-shell/app/globals.css` (append rules)

**Why:** during zoom/pan, marching-ant edge animations keep repainting and any transitioned property whose value depends on `--canvas-scale` re-animates per tick. Pausing them for the duration of the gesture (+180ms trailing) removes that work with zero steady-state change.

- [ ] **Step 1:** in CanvasClient add `const interactingTimerRef = useRef(null);` near other refs. In `onTransformed`, first lines:

```js
          const html = document.documentElement;
          html.classList.add('canvas-interacting');
          clearTimeout(interactingTimerRef.current);
          interactingTimerRef.current = setTimeout(() => {
            html.classList.remove('canvas-interacting');
          }, 180);
```

- [ ] **Step 2:** globals.css (end of file):

```css
/* While the canvas transform is actively changing (wheel zoom / pan /
   programmatic frame animations), pause in-world cosmetic motion and
   transitions: marching-ant edges repaint per frame, and transitioned
   properties whose values depend on --canvas-scale would re-animate on
   every tick. Cleared 180ms after the last transform event — steady-state
   visuals are untouched. Scoped to the transformed world only; fixed
   chrome (dock, toolbars, modals) keeps its motion. */
html.canvas-interacting .react-transform-component .edge-line {
  animation-play-state: paused;
}
html.canvas-interacting .react-transform-component * {
  transition: none !important;
}
```

- [ ] **Step 3:** full suite green → commit `perf(canvas): pause in-world animations/transitions during zoom-pan gesture`.

---

### Task 3: Time-gate the React scale push (CSS stays live)

**Files:**
- Modify: `packages/web-shell/components/CanvasClient.jsx` (`onTransformed`, refs)

**Why:** every zoom tick over the 0.0005 epsilon calls `setCanvasScale` → full CanvasClient render → all node items re-render (scale is a real prop). The CSS var (set every tick) already drives all the visual chrome; the React value only feeds JS-computed geometry (edge hit-paths, pill-fit, zoom %, minimap). Pushing it at most every ~120ms during a gesture + a trailing exact commit keeps those in sync to the eye while cutting renders ~8×.

- [ ] **Step 1:** add refs near `lastAppliedScaleRef`:

```js
  const scalePushTimeRef = useRef(0);
  const scaleTrailingRef = useRef(null);
```

- [ ] **Step 2:** replace the epsilon block inside `onTransformed`:

```js
          if (Math.abs(scale - lastAppliedScaleRef.current) > 0.0005) {
            const now = performance.now();
            clearTimeout(scaleTrailingRef.current);
            if (now - scalePushTimeRef.current > 120) {
              scalePushTimeRef.current = now;
              lastAppliedScaleRef.current = scale;
              setCanvasScale(scale);
            } else {
              // Trailing commit — the LAST tick of a gesture always lands
              // exactly, so JS-computed geometry (edge hit paths, pill fit,
              // zoom %, minimap) settles on the true final scale.
              scaleTrailingRef.current = setTimeout(() => {
                lastAppliedScaleRef.current = scale;
                setCanvasScale(scale);
              }, 140);
            }
          }
```

- [ ] **Step 3:** full suite green → commit `perf(canvas): time-gate React scale pushes during zoom gesture (CSS tracks live)`.

---

### Task 4: No `backdrop-filter` inside the zoomed world

**Files:**
- Modify: `packages/web-shell/app/globals.css` (the in-world sites found by `grep -n "backdrop-filter" app/globals.css` whose selectors live inside the canvas transform: `.cnode-gen-overlay.has-content`, in-world port/edge popups, `.empty-drop-menu.cnode-topbar-menu` — read each rule before editing)

**Why:** `backdrop-filter` inside a scaled container re-rasterizes its backdrop on every zoom tick — one of the most expensive things a browser can do per frame. DESIGN.md already standardizes click-dropdowns as SOLID (`--bg-frosted-solid`, no blur, "canvas never leaks behind a data menu"). Same treatment here: swap blur for the solid frosted background. Fixed chrome (prompt dock, modals, sidebars) KEEPS its backdrop-filter.

- [ ] **Step 1:** for each in-world rule: remove the `backdrop-filter` (and `-webkit-backdrop-filter`) line, and if the background is translucent, replace with `var(--bg-frosted-solid, #0f0f0f)` (keep border/shadow as-is). Do NOT touch selectors that are viewport-fixed.
- [ ] **Step 2:** full suite green → commit `style(canvas): in-world surfaces drop backdrop-filter (solid frosted per DESIGN.md) — zoom no longer re-rasterizes backdrops`.

---

### Task 5: Pixel-snap scale-dependent borders and shadows (CSS `round()`)

**Files:**
- Modify: `packages/web-shell/app/globals.css`

**Why:** the shimmer signature: `calc(2px / var(--canvas-scale))` yields 2.86px → 2.91px → 3.02px… as the zoom animates, and the browser snaps each to a different device-pixel grid per tick. `round(nearest, <calc>, 1px)` makes the value change only at whole-pixel crossings. Keep the plain `calc()` on the line above as fallback.

- [ ] **Step 1:** apply the double-declaration pattern to the scale-divided BORDER widths and the 6 scale-aware BOX-SHADOWS (find them: `grep -n "calc(.*\/ var(--canvas-scale" app/globals.css | grep -i "border\|box-shadow"`). Pattern:

```css
  border-width: calc(2px / var(--canvas-scale, 1));
  border-width: round(nearest, calc(2px / var(--canvas-scale, 1)), 1px);
```

Do NOT round font sizes, paddings, gaps, or positions (rounding those makes text/layout visibly step).

- [ ] **Step 2:** full suite green → commit `style(canvas): pixel-snap scale-dependent borders/shadows (round()) — kills zoom shimmer`.

---

### Task 6: Verification

- [ ] Full suite (expect 547 + Task 1 tests).
- [ ] esbuild parse-check touched JSX.
- [ ] Dev server boots; `/canvas/[boardId]` compiles.
- [ ] User smoke: wheel-zoom in/out continuously — smoother, borders/corners stop "dancing"; marching edges freeze during the gesture and resume after; menus inside the canvas read solid (no blur); drag/resize unchanged from Phase 1.
