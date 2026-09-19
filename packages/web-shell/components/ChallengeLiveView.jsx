'use client';
import { useEffect } from 'react';
// Visualizador ao vivo do NOSSO navegador remoto, dentro da moldura do node.
// A URL é segredo portador (spec 2026-09-08 §4.6): nunca vai para log/analytics;
// sandbox mínimo; mensagens validadas por origin.
export default function ChallengeLiveView({ url, onDisconnected }) {
  useEffect(() => {
    let origin = null;
    try { origin = new URL(url).origin; } catch { origin = null; }
    function onMsg(e) {
      if (!origin || e.origin !== origin) return;
      const disconnected = e.data === 'browserbase-disconnected' || e.data?.type === 'browserbase-disconnected';
      if (disconnected) onDisconnected?.();
    }
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [url, onDisconnected]);
  return (
    <div className="challenge-live-view">
      <div className="challenge-live-view-hint">Pass the check below — we'll continue automatically.</div>
      <iframe
        title="Site check"
        src={url}
        sandbox="allow-scripts allow-same-origin allow-pointer-lock"
        referrerPolicy="no-referrer"
        allow=""
        style={{ width: '100%', height: '100%', border: 0 }}
      />
    </div>
  );
}
