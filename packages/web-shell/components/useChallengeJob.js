'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

const POLL_MS = 3000;
const TERMINAL = new Set(['succeeded', 'failed', 'expired', 'cancelled', 'unsupported']);

// O canvas OBSERVA e DISPARA (spec 2026-09-08 §4.3): consulta o job, chama
// `check` em needs_human e `capture` em ready; nunca é dono da execução —
// reentrada é recusada pelo servidor (job_conflict) e tratada como "alguém já
// capturou". `busy` impede o polling de disparar duas capturas no mesmo node.
export function useChallengeJob({ api, onSucceeded, onFailed, onNodeState }) {
  const [jobs, setJobs] = useState(() => new Map());
  const timers = useRef(new Map());
  const busy = useRef(new Set());
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;

  const setJob = useCallback((nodeId, patch) => setJobs((prev) => {
    const next = new Map(prev);
    next.set(nodeId, { ...(prev.get(nodeId) || {}), ...patch });
    return next;
  }), []);

  const stop = useCallback((nodeId) => {
    const t = timers.current.get(nodeId);
    if (t) clearInterval(t);
    timers.current.delete(nodeId);
  }, []);

  const handle = useCallback(async function handle(nodeId, purpose, payload) {
    const { job, liveView, result } = payload;
    setJob(nodeId, { jobId: job.id, status: job.status, liveView: liveView?.url || null });
    if (job.status === 'succeeded') { stop(nodeId); onSucceeded?.(nodeId, purpose, result); return; }
    if (TERMINAL.has(job.status)) { stop(nodeId); onFailed?.(nodeId, job.errorCode || job.status); return; }
    if (job.status === 'ready' && !busy.current.has(nodeId)) {
      busy.current.add(nodeId);
      try {
        const r = await api.captureChallengeJob(job.id);
        await handle(nodeId, purpose, r);
      } catch (e) {
        if (e?.code === 'job_conflict' || e?.code === 'already_done') return; // outro controlador venceu; o polling observa
        stop(nodeId); onFailed?.(nodeId, e?.code || 'capture_failed');
      } finally {
        busy.current.delete(nodeId);
      }
      return;
    }
    onNodeState?.(nodeId, { stage: job.status });
  }, [api, onSucceeded, onFailed, onNodeState, setJob, stop]);

  const poll = useCallback((nodeId, purpose, jobId) => {
    stop(nodeId);
    const tick = async () => {
      try {
        const current = jobsRef.current.get(nodeId);
        const r = current?.status === 'needs_human'
          ? await api.checkChallengeJob(jobId)
          : await api.getChallengeJob(jobId);
        await handle(nodeId, purpose, r);
      } catch (e) {
        if (/404|not_found/i.test(String(e?.message || ''))) { stop(nodeId); onFailed?.(nodeId, 'not_found'); }
      }
    };
    timers.current.set(nodeId, setInterval(tick, POLL_MS));
  }, [api, handle, stop, onFailed]);

  const start = useCallback(async (nodeId, purpose) => {
    const r = await api.startChallenge(nodeId, { purpose });
    await handle(nodeId, purpose, r);
    if (!TERMINAL.has(r.job.status) && r.job.status !== 'succeeded') poll(nodeId, purpose, r.job.id);
  }, [api, handle, poll]);

  const cancel = useCallback(async (nodeId) => {
    const j = jobsRef.current.get(nodeId);
    stop(nodeId);
    if (j?.jobId) await api.cancelChallengeJob(j.jobId).catch(() => {});
    setJobs((prev) => { const n = new Map(prev); n.delete(nodeId); return n; });
  }, [api, stop]);

  useEffect(() => () => { for (const t of timers.current.values()) clearInterval(t); timers.current.clear(); }, []);
  return { start, cancel, jobs };
}
