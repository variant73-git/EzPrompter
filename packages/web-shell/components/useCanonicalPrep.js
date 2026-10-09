'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createCanonicalPoller } from '../lib/canonical/poller.js';
import { capturePhasePct, monotonicPct } from '../lib/canonical/progress.js';

// Estado da preparação da cópia por node (spec 2026-10-09 §0/§4.3): o número que o node mostra e, em falha,
// o código para as duas escolhas. O número nunca volta.
export function useCanonicalPrep({ api }) {
  const [prep, setPrep] = useState(() => new Map());
  const pollers = useRef(new Map());

  const patch = useCallback((nodeId, next) => {
    setPrep((prev) => {
      const map = new Map(prev);
      if (next == null) { map.delete(nodeId); return map; }
      const cur = map.get(nodeId);
      map.set(nodeId, { ...cur, ...next, pct: monotonicPct(cur?.pct, next.pct ?? cur?.pct) });
      return map;
    });
  }, []);

  useEffect(() => () => { for (const p of pollers.current.values()) p.stop(); }, []);

  const run = useCallback(async (nodeId, { capture = null } = {}) => {
    patch(nodeId, { status: 'running', pct: capture ? 0 : 10, errorCode: null });
    try {
      if (capture) {
        const t0 = Date.now();
        const tick = setInterval(() => patch(nodeId, { pct: capturePhasePct(Date.now() - t0) }), 500);
        try { await capture(); } finally { clearInterval(tick); }
        patch(nodeId, { pct: 10 });
      }
      const started = await api.startCanonicalJob(nodeId);
      patch(nodeId, { pct: started?.job?.progressPct });
      const poller = createCanonicalPoller({
        advance: api.advanceCanonicalJob,
        onUpdate: (job) => patch(nodeId, { pct: job.progressPct }),
      });
      pollers.current.set(nodeId, poller);
      try {
        const outcome = await poller.run(started.job.id);
        if (!outcome.ok && outcome.code !== 'cancelled') patch(nodeId, { status: 'failed', errorCode: outcome.code });
        return outcome;
      } finally {
        pollers.current.delete(nodeId);
      }
    } catch (error) {
      patch(nodeId, null);
      throw error;
    }
  }, [api, patch]);

  const dismiss = useCallback((nodeId) => {
    pollers.current.get(nodeId)?.stop();
    patch(nodeId, null);
  }, [patch]);

  return { prep, run, dismiss };
}
