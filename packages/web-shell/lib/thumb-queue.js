// Tiny concurrency-limited fetch queue for node thumbnails (perf phase 3b).
//
// When a zoom-out crosses the live-iframe threshold, MANY nodes want a
// thumbnail at once. Uncached ones cost a headless render server-side
// (seconds each) — firing them all in parallel would stampede the server
// with simultaneous browser launches. This queue runs at most
// CONCURRENCY fetches at a time, resolves each caller with the dataUrl
// (or null on failure), and dedups concurrent requests for the same key.
const CONCURRENCY = 2;

const pending = new Map(); // key -> Promise<string|null>
let active = 0;
const waiters = [];

function pump() {
  while (active < CONCURRENCY && waiters.length) {
    const next = waiters.shift();
    next();
  }
}

export function fetchThumb(key, url) {
  if (pending.has(key)) return pending.get(key);
  const p = new Promise((resolve) => {
    const run = async () => {
      active += 1;
      try {
        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok) { resolve(null); return; }
        const data = await res.json().catch(() => null);
        resolve(typeof data?.dataUrl === 'string' ? data.dataUrl : null);
      } catch {
        resolve(null);
      } finally {
        active -= 1;
        pending.delete(key);
        pump();
      }
    };
    waiters.push(run);
  });
  pending.set(key, p);
  pump();
  return p;
}

// Test hook — resets module state between tests.
export function _resetThumbQueue() {
  pending.clear();
  waiters.length = 0;
  active = 0;
}
