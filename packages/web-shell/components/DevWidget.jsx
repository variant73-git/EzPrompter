'use client';
// Console — per-clone metrics + switches (Adilson, 2026-08-20/21). Toggle: ⌥D.
//
// Merges two sources per clone:
//  · client wall-clock (lib/dev-clock.js) — what the USER actually waited;
//  · server telemetry persisted on the node meta (cloneTelemetry from
//    reconstructSiteNode; timings/cloneCost/similarity from extract.clone).
// Read-only metering — renders nothing unless opened.
import { useEffect, useMemo, useState } from 'react';
import { devClockAll, onDevClock } from '../lib/dev-clock.js';
import { HARNESSES, HARNESS_COOKIE, DEFAULT_HARNESS_ID } from '../lib/harness.js';
import { resolvePreviewMode, DEFAULT_PREVIEW_MODE } from '../lib/preview-video.js';

function readHarnessCookie() {
  try {
    const m = new RegExp(`(?:^|;\\s*)${HARNESS_COOKIE}=([^;]+)`).exec(document.cookie);
    const id = m ? decodeURIComponent(m[1]) : null;
    return HARNESSES[id] ? id : DEFAULT_HARNESS_ID;
  } catch { return DEFAULT_HARNESS_ID; }
}

const LS_KEY = 'uncraft-dev-widget-open';
export const PREVIEW_LS_KEY = 'uncraft-preview-mode';

function fmtS(ms) {
  if (ms == null || !Number.isFinite(Number(ms))) return '—';
  return `${(Number(ms) / 1000).toFixed(1)}s`;
}
function fmtUsd(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return `$${Number(v).toFixed(3)}`;
}
function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url || ''; }
}

// One row per clone event, newest first: wall records enriched with node meta,
// plus telemetry-carrying nodes that have no wall record (older sessions).
export function buildRows(nodes, wall) {
  const byId = new Map((nodes || []).map((n) => [n.id, n]));
  const rows = [];
  const seenNodes = new Set();
  for (const w of wall || []) {
    const node = w.nodeId ? byId.get(w.nodeId) : null;
    if (node) seenNodes.add(node.id);
    const meta = node?.meta || {};
    const tel = meta.cloneTelemetry || null;
    rows.push({
      key: `w-${w.at}-${w.nodeId || w.label}`,
      at: w.at,
      kind: tel?.engine || w.kind,
      label: hostOf(tel?.url || meta.originUrl || w.label || ''),
      ok: w.ok !== false,
      error: w.error || null,
      wallMs: w.wallMs ?? null,
      serverMs: tel?.totalMs ?? (meta.timings ? (meta.timings.visaoMs || 0) + (meta.timings.recorteMs || 0) : null),
      stages: tel?.stages || (meta.timings ? { vision: meta.timings.visaoMs, crop: meta.timings.recorteMs } : null),
      harness: tel?.harness ?? meta.cloneCost?.harness ?? null,
      credits: tel?.credits ?? meta.cloneCost?.credits ?? null,
      costUsd: tel?.costUsd ?? meta.cloneCost?.costUsd ?? null,
      ssim: meta.similarity?.ssim ?? null,
    });
  }
  for (const n of nodes || []) {
    const tel = n.meta?.cloneTelemetry;
    if (!tel || seenNodes.has(n.id)) continue;
    rows.push({
      key: `n-${n.id}`, at: Date.parse(tel.at) || 0, kind: tel.engine, label: hostOf(tel.url || ''),
      ok: true, error: null, wallMs: null, serverMs: tel.totalMs, stages: tel.stages, harness: tel.harness ?? null,
      credits: tel.credits, costUsd: tel.costUsd, ssim: n.meta?.similarity?.ssim ?? null,
    });
  }
  rows.sort((a, b) => b.at - a.at);
  return rows.slice(0, 20);
}

export default function DevWidget({ nodes }) {
  const [open, setOpen] = useState(false);
  const [harnessId, setHarnessId] = useState(DEFAULT_HARNESS_ID);
  const [previewMode, setPreviewMode] = useState(DEFAULT_PREVIEW_MODE);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    try { setOpen(localStorage.getItem(LS_KEY) === '1'); } catch {}
    setHarnessId(readHarnessCookie());
    try { setPreviewMode(resolvePreviewMode(localStorage.getItem(PREVIEW_LS_KEY))); } catch {}
    const onKey = (e) => {
      if (e.altKey && (e.code === 'KeyD') && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setOpen((v) => {
          try { localStorage.setItem(LS_KEY, v ? '0' : '1'); } catch {}
          return !v;
        });
      }
    };
    window.addEventListener('keydown', onKey);
    const off = onDevClock(() => setTick((t) => t + 1));
    return () => { window.removeEventListener('keydown', onKey); off(); };
  }, []);

  const rows = useMemo(() => buildRows(nodes, devClockAll()), [nodes, open, tick]);

  if (!open) return null;
  return (
    <div className="dev-widget" data-testid="dev-widget">
      <div className="dev-widget-head">
        <span className="dev-widget-title">Console</span>
        <span className="dev-widget-hint">⌥D to close</span>
      </div>
      <div className="dev-widget-harness" role="group" aria-label="Node preview">
        <span className="dev-widget-harness-label">Preview</span>
        {[['video', 'Video'], ['static', 'Static']].map(([id, rotulo]) => (
          <button
            key={id}
            type="button"
            className={`dev-widget-harness-btn${id === previewMode ? ' is-active' : ''}`}
            title={id === 'video' ? 'Node mostra o clone em movimento' : 'Node mostra o PNG estático (mais leve)'}
            onClick={() => {
              try { localStorage.setItem(PREVIEW_LS_KEY, id); } catch {}
              setPreviewMode(id);
              // O node lê o modo no render; avisa quem já está montado.
              window.dispatchEvent(new CustomEvent('uncraft-preview-mode', { detail: id }));
            }}
          >{rotulo}</button>
        ))}
      </div>
      <div className="dev-widget-harness" role="group" aria-label="Model harness">
        <span className="dev-widget-harness-label">Harness</span>
        {Object.values(HARNESSES).map((hz) => (
          <button
            key={hz.id}
            type="button"
            className={`dev-widget-harness-btn${hz.id === harnessId ? ' is-active' : ''}`}
            title={`cloneVision: ${hz.cloneVision}`}
            onClick={() => {
              try { document.cookie = `${HARNESS_COOKIE}=${hz.id}; path=/; max-age=31536000; samesite=lax`; } catch {}
              setHarnessId(hz.id);
            }}
          >{hz.label}</button>
        ))}
      </div>
      {rows.length === 0 && <div className="dev-widget-empty">No clones this session yet. Clone a site and the numbers land here.</div>}
      {rows.map((r) => (
        <div key={r.key} className={`dev-widget-row${r.ok ? '' : ' is-error'}`}>
          <div className="dev-widget-line1">
            <span className={`dev-widget-badge b-${String(r.kind).replace(/[^a-z0-9-]/gi, '')}`}>{r.kind}</span>
            <span className="dev-widget-label" title={r.label}>{r.label || '—'}</span>
            {r.harness && <span className="dev-widget-harness-tag">{r.harness}</span>}
            <span className="dev-widget-wall">{fmtS(r.wallMs)}</span>
          </div>
          <div className="dev-widget-line2">
            <span>server {fmtS(r.serverMs)}</span>
            <span>{fmtUsd(r.costUsd)}</span>
            <span>{r.credits != null ? `${r.credits} cr` : '—'}</span>
            <span>{r.ssim != null ? `SSIM ${Number(r.ssim).toFixed(3)}` : ''}</span>
          </div>
          {r.stages && (
            <div className="dev-widget-stages">
              {Object.entries(r.stages).map(([k, v]) => (
                <span key={k} className="dev-widget-stage">{k} {fmtS(v)}</span>
              ))}
            </div>
          )}
          {r.error && <div className="dev-widget-err">{r.error}</div>}
        </div>
      ))}
    </div>
  );
}
