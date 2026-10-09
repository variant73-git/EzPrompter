'use client';

import { canonicalErrorCopy } from '../lib/canonical/error-copy.js';

// O que o node mostra enquanto a cópia editável é preparada (spec 2026-10-09 §0): número grande no centro sobre
// o site borrado (o borrado é a classe `.canonical-prep` na raiz do node); em falha, motivo + duas escolhas.
// Botões param o mousedown para não arrastar o node.
const stop = (e) => e.stopPropagation();

export default function CanonicalPrepOverlay({ prep, onRetry, onOpenLive }) {
  if (!prep) return null;
  if (prep.status === 'failed') {
    const copy = canonicalErrorCopy(prep.errorCode);
    return (
      <div className="cnode-canonical cnode-canonical-failed" role="alert">
        <strong className="cnode-canonical-title">{copy.title}</strong>
        <span className="cnode-canonical-detail">{copy.detail}</span>
        <div className="cnode-canonical-actions">
          <button type="button" className="popup-btn popup-btn-primary" onMouseDown={stop} onClick={(e) => { e.stopPropagation(); onRetry?.(); }}>
            Try again
          </button>
          <button type="button" className="popup-btn popup-btn-outline" onMouseDown={stop} onClick={(e) => { e.stopPropagation(); onOpenLive?.(); }}>
            Open live clone instead
          </button>
        </div>
      </div>
    );
  }
  const pct = Math.max(0, Math.min(100, Math.round(prep.pct || 0)));
  return (
    <div
      className="cnode-canonical"
      role="progressbar"
      aria-label="Preparing editable copy"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
    >
      <span className="cnode-canonical-pct">{pct}<span className="cnode-canonical-unit">%</span></span>
      <span className="cnode-canonical-label">Preparing editable copy</span>
    </div>
  );
}
