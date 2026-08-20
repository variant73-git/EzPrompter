// lib/dev-clock.js — wall-clock DO USUÁRIO por operação de clone (client-side).
/**
 * O tempo que o Adilson pediu para medir (2026-08-20) é o que a PESSOA sente:
 * do disparo no canvas até a resposta chegar — fila, rede e servidor juntos.
 * O servidor grava as etapas dele em node.meta.cloneTelemetry; este módulo
 * mede a ponta do cliente e alimenta o widget Dev. Memória volátil por aba
 * (cap 50): telemetria de sessão, não histórico — o histórico vive no meta.
 */
const records = [];
const listeners = new Set();

function notify() { for (const fn of listeners) { try { fn(); } catch {} } }

export function devClockAll() { return [...records]; }

export function onDevClock(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function devClockRecord(rec) {
  records.unshift({ at: Date.now(), ...rec });
  if (records.length > 50) records.length = 50;
  notify();
}

// Envolve uma promise de operação de clone e registra o wall-clock, com o
// nodeId que a resposta trouxer. Fail-open: medir nunca muda o resultado.
export async function devClockTime(kind, label, fn) {
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const done = (extra) => {
    const t1 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    try { devClockRecord({ kind, label, wallMs: Math.round(t1 - t0), ...extra }); } catch {}
  };
  try {
    const result = await fn();
    done({ ok: true, nodeId: result?.node?.id || result?.nodeId || null });
    return result;
  } catch (e) {
    done({ ok: false, error: String(e?.message || e).slice(0, 80) });
    throw e;
  }
}
