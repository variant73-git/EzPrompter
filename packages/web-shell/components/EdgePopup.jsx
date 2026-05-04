'use client';

import { useState, useEffect } from 'react';
import { api } from '../lib/canvas-api.js';

const KIND_OPTS = [
  { v: 'transplant', label: 'Transplant — DOM swap section X → section Y' },
  { v: 'token-swap', label: 'Token swap — colors + fonts of source apply to target' },
  { v: 'reskin',     label: 'Reskin — target content into source\'s chassis (LLM)' }
];

export default function EdgePopup({ edge, nodes, position, onUpdate, onApply, onDelete, onClose }) {
  const [kind, setKind] = useState(edge.kind);
  const [sourceSel, setSourceSel] = useState(edge.payload?.sourceSelector || 'body');
  const [targetSel, setTargetSel] = useState(edge.payload?.targetSelector || 'body');
  const [busy, setBusy] = useState(false);
  const sourceNode = nodes.find((n) => n.id === edge.source_node_id);
  const targetNode = nodes.find((n) => n.id === edge.target_node_id);

  useEffect(() => {
    setKind(edge.kind);
    setSourceSel(edge.payload?.sourceSelector || 'body');
    setTargetSel(edge.payload?.targetSelector || 'body');
  }, [edge.id]);

  async function persistAndApply() {
    setBusy(true);
    try {
      const payload = kind === 'transplant'
        ? { sourceSelector: sourceSel, targetSelector: targetSel }
        : {};
      await api.updateEdge(edge.id, { kind, payload, status: 'pending' });
      await onUpdate(edge, payload);
      await onApply({ ...edge, payload, kind });
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="edge-popup" style={{ left: clamp(position.x + 12, 12, window.innerWidth - 300), top: clamp(position.y + 12, 12, window.innerHeight - 320) }}>
      <h4>Edge configuration</h4>
      <div style={{ color: '#94a3b8', fontSize: '0.75rem', marginBottom: '0.5rem' }}>
        <div><strong style={{color:'#c4b5fd'}}>From:</strong> {sourceNode?.origin_url || sourceNode?.meta?.name || sourceNode?.id?.slice(0,8) || '?'}</div>
        <div><strong style={{color:'#c4b5fd'}}>To:</strong> {targetNode?.origin_url || targetNode?.meta?.name || targetNode?.id?.slice(0,8) || '?'}</div>
      </div>

      <label style={{color:'#94a3b8',fontSize:'0.75rem'}}>Kind</label>
      <select value={kind} onChange={(e) => setKind(e.target.value)}>
        {KIND_OPTS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
      </select>

      {kind === 'transplant' && (
        <>
          <label style={{color:'#94a3b8',fontSize:'0.75rem'}}>Source selector</label>
          <input value={sourceSel} onChange={(e) => setSourceSel(e.target.value)} placeholder="e.g. header, .hero, #pricing" />
          <label style={{color:'#94a3b8',fontSize:'0.75rem'}}>Target selector (replaced by source)</label>
          <input value={targetSel} onChange={(e) => setTargetSel(e.target.value)} placeholder="e.g. header" />
        </>
      )}

      <div style={{ color: '#475569', fontSize: '0.7rem', marginTop: '0.5rem' }}>
        Status: <span style={{color: edge.status === 'applied' ? '#10b981' : edge.status === 'failed' ? '#f87171' : '#a78bfa'}}>{edge.status || 'pending'}</span>
        {edge.last_error && <div style={{color:'#fca5a5', marginTop:'0.25rem'}}>{edge.last_error}</div>}
      </div>

      <div className="row">
        <button className="apply" disabled={busy} onClick={persistAndApply}>{busy ? 'Applying…' : 'Apply →'}</button>
        <button className="delete" onClick={() => onDelete(edge)}>Delete</button>
      </div>
    </div>
  );
}

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
