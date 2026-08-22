'use client';

import { useEffect, useState } from 'react';
import { DEV_ENGINES, getDevEngine, setDevEngine } from '../lib/dev-toggles.js';

/**
 * Developer widget (pre-launch tooling). Renders ONLY when the dev toggles
 * route answers 200 — in production the route 404s unless UNCRAFT_DEV_TOOLS=1,
 * so the widget disappears by construction (server-side gate; the client
 * carries no secret and no NEXT_PUBLIC flag).
 *
 * Levers:
 *   Engine  — which machinery produces clones on Edit (native = animated
 *             doctrine default; iter9 = historical static). localStorage.
 *   Tier    — users.plan, server-side; page reloads so every plan gate
 *             re-evaluates with the new tier.
 *   Credits — balance presets (infinite / starter / zero), server-side.
 */
export default function DevWidget() {
  const [state, setState] = useState(null);       // null until GET succeeds
  const [open, setOpen] = useState(false);
  // Espera medida no CLIENTE (do clique à resposta). O servidor grava a sua
  // telemetria no meta do node; aqui as duas se encontram.
  const [esperas, setEsperas] = useState([]);
  const [busy, setBusy] = useState(false);
  const [engine, setEngine] = useState(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/dev/toggles', { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (alive && data) { setState(data); setEngine(getDevEngine()); } })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const ler = () => setEsperas([...(globalThis.window?.__uncraftCloneWallClock || [])]);
    ler();
    window.addEventListener('uncraft:clone-wallclock', ler);
    return () => window.removeEventListener('uncraft:clone-wallclock', ler);
  }, []);

  if (!state) return null;

  async function post(patch, { reload = false } = {}) {
    setBusy(true);
    try {
      const res = await fetch('/api/dev/toggles', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        const data = await res.json();
        setState(data);
        // The header pill listens for this event — without it the balance up
        // top looks frozen and the lever reads as dead.
        window.dispatchEvent(new CustomEvent('uncraft:balance', { detail: { balance: data.credits } }));
        if (reload) window.location.reload();
      }
    } finally {
      setBusy(false);
    }
  }

  // No unselected state: the selector shows the EFFECTIVE engine (stored
  // choice or the doctrine default, native). Picking "Animated" clears the
  // override — same behavior, but something is always lit.
  const effectiveEngine = engine || 'native';
  function pickEngine(value) {
    const next = value === 'native' ? null : value;
    setDevEngine(next);
    setEngine(next);
  }

  const creditLabels = { infinite: '∞', starter: '500', zero: '0' };
  const CREDIT_VALUES = { infinite: 10_000_000, starter: 500, zero: 0 };
  // Light the preset that matches the CURRENT balance (drifts dark once an
  // operation charges — that's honest: the balance no longer IS the preset).
  const activePreset = Object.keys(CREDIT_VALUES).find((k) => CREDIT_VALUES[k] === state.credits) || null;

  return (
    <div className={`dev-widget${open ? ' open' : ''}`}>
      {open && (
        <div className="dev-widget-panel" onMouseDown={(e) => e.stopPropagation()}>
          <div className="dev-widget-row">
            <span className="dev-widget-label">Engine</span>
            <div className="dev-widget-seg">
              {DEV_ENGINES.map((value) => (
                <button
                  key={value}
                  className={effectiveEngine === value ? 'on' : ''}
                  title={value === 'native'
                    ? 'Clones run the native engine (animated). Default doctrine.'
                    : 'Clones run the historical iter9 engine (static).'}
                  onClick={() => pickEngine(value)}
                >
                  {value === 'native' ? 'Animated' : 'iter9'}
                </button>
              ))}
            </div>
          </div>
          <div className="dev-widget-row">
            <span className="dev-widget-label">Tier</span>
            <div className="dev-widget-seg">
              {state.plans.map((plan) => (
                <button
                  key={plan}
                  className={state.plan === plan ? 'on' : ''}
                  disabled={busy}
                  onClick={() => post({ plan }, { reload: true })}
                >
                  {plan}
                </button>
              ))}
            </div>
          </div>
          <div className="dev-widget-row">
            <span className="dev-widget-label">Credits</span>
            <div className="dev-widget-seg">
              {state.creditPresets.map((preset) => (
                <button
                  key={preset}
                  className={activePreset === preset ? 'on' : ''}
                  disabled={busy}
                  title={preset}
                  onClick={() => post({ credits: preset })}
                >
                  {creditLabels[preset] || preset}
                </button>
              ))}
            </div>
            <span className="dev-widget-balance">{state.credits.toLocaleString('en-US')}</span>
          </div>

          {/* ⏱️ Onde o clone gasta tempo e dinheiro. `wall` é o que a PESSOA
              esperou; `server` é o total medido no servidor; as etapas dizem
              onde ele foi. `resto` é o servidor fora das etapas nomeadas —
              sem ele a soma não fecha e ninguém sabe o que falta medir. */}
          {esperas.length > 0 && (
            <div className="dev-widget-row dev-widget-clones">
              <span className="dev-widget-label">Clones</span>
              <div className="dev-widget-clone-list">
                {esperas.map((e) => {
                  const t = e.telemetry || null;
                  const seg = (ms) => `${(ms / 1000).toFixed(1)}s`;
                  return (
                    <div key={`${e.nodeId}-${e.at}`} className="dev-widget-clone">
                      <b>{e.engine}</b>
                      <span>wall {seg(e.wallMs)}</span>
                      {t && <span>server {seg(t.totalMs)}</span>}
                      {t && Object.entries(t.stages || {}).map(([nome, ms]) => (
                        <span key={nome}>{nome} {seg(ms)}</span>
                      ))}
                      {t?.unaccountedMs > 0 && <span>resto {seg(t.unaccountedMs)}</span>}
                      {t?.credits != null && <span>{t.credits} cr</span>}
                      {t?.usd != null && <span>${t.usd.toFixed(4)}</span>}
                      {!t && <span className="dev-widget-faint">sem telemetria do servidor</span>}
                      {/* Arquivo perdido na captura só vira acionável com o
                          MOTIVO: "o site bloqueou" e "passou do tamanho" pedem
                          remédios opostos. */}
                      {e.captura?.discarded > 0 && (
                        <span title={Object.entries(e.captura.discardedReasons || {}).map(([m, n]) => `${n}× ${m}`).join(' · ')}>
                          {e.captura.discarded} perdido{e.captura.discarded > 1 ? 's' : ''}
                          {Object.keys(e.captura.discardedReasons || {}).length
                            ? `: ${Object.entries(e.captura.discardedReasons).map(([m, n]) => `${n}× ${m}`).join(', ')}`
                            : ''}
                          {e.captura.discardedReasonsPartial ? ' (amostra)' : ''}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
      <button
        className="dev-widget-pill"
        title="Developer toggles (pre-launch tooling)"
        onClick={() => setOpen((v) => !v)}
      >
        DEV
      </button>
    </div>
  );
}
