'use client';

// A rede de segurança PERMANENTE do runtime (decisão de produto 2026-08-26):
// falha em edição ativa nunca desmonta o editor — escurece o palco, diz que o
// trabalho está salvo (o rascunho é server-side) e oferece Reload no lugar.
// O tom substitui o antigo "This website couldn't be opened for editing.",
// que era um teardown com toast — agressivo demais para uma falha recuperável.
export default function RuntimeMask({ onReload, reloading = false }) {
  return (
    <div
      role="alertdialog"
      aria-label="Runtime disconnected"
      style={{
        position: 'absolute',
        inset: 0,
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        textAlign: 'center',
        background: 'rgba(15, 15, 14, 0.86)',
        color: '#F1F0EB',
        zIndex: 4,
      }}
    >
      <div style={{ display: 'grid', gap: 10, maxWidth: 320, justifyItems: 'center' }}>
        <strong style={{ font: '600 14px/1.4 var(--font-inter), Inter, sans-serif' }}>
          This clone lost its connection.
        </strong>
        <p style={{ margin: 0, font: '500 13px/1.5 var(--font-inter), Inter, sans-serif', color: '#B5B3AC' }}>
          Your edits are safe. Reload to keep editing.
        </p>
        <button
          type="button"
          disabled={reloading}
          onClick={onReload}
          style={{
            marginTop: 6,
            padding: '7px 18px',
            borderRadius: 8,
            border: '1px solid rgba(241, 240, 235, 0.22)',
            background: reloading ? 'rgba(241, 240, 235, 0.08)' : 'rgba(241, 240, 235, 0.14)',
            color: '#F1F0EB',
            font: '600 13px/1 var(--font-inter), Inter, sans-serif',
            cursor: reloading ? 'default' : 'pointer',
          }}
        >
          {reloading ? 'Reloading…' : 'Reload'}
        </button>
      </div>
    </div>
  );
}
