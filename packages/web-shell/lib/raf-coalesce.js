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
