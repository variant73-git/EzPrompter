'use client';
// Aviso em inglês com OK (decisão de produto 2026-09-06). SEM link para o site,
// SEM extensão: a verificação acontece no NOSSO navegador remoto, dentro do node.
export default function ChallengeNotice({ host, onOk, onCancel }) {
  return (
    <div className="popup-overlay" onMouseDown={(e) => e.stopPropagation()}>
      <div className="popup-card challenge-modal-card" role="dialog" aria-modal="true" aria-labelledby="challenge-notice-title">
        <h3 id="challenge-notice-title" className="popup-title">
          <span className="popup-serif"><i>Quick</i></span> check needed
        </h3>
        <p className="popup-text">
          <strong>{host}</strong> needs a quick check before we can open it. We'll
          show it right here in the canvas — just pass the check and we'll continue
          on our own.
        </p>
        <div className="popup-actions">
          <button type="button" className="popup-btn popup-btn-outline" onClick={onCancel}>Cancel</button>
          <button type="button" className="popup-btn popup-btn-primary" onClick={onOk} autoFocus>OK</button>
        </div>
      </div>
    </div>
  );
}
