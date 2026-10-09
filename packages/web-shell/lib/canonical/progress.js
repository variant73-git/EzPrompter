// Porcentagem da preparação da cópia (spec 2026-10-09 §4.3). Pesos fixos por etapa; a gravação é a fração
// de paradas feitas. O número NUNCA volta: se a página cresce, o total sobe e ele só desacelera.
export const PCT = Object.freeze({
  captureCap: 9,
  queued: 10,
  created: 11,
  files: 13,
  started: 14,
  installing: 15,
  recordingStart: 15,
  recordingEnd: 85,
  assembling: 88,
  packaging: 95,
  ready: 100,
});

export function parseProgressLog(text) {
  if (typeof text !== 'string' || !text) return null;
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      const entry = JSON.parse(line);
      if (entry && typeof entry.fase === 'string') return entry;
    } catch { /* linha cortada no meio da escrita */ }
  }
  return null;
}

export function pctFromVm(entry) {
  if (!entry) return null;
  if (entry.fase === 'instalando') return PCT.installing;
  if (entry.fase === 'montando') return PCT.assembling;
  if (entry.fase === 'gravando') {
    const total = Number(entry.total);
    const feitas = Number(entry.feitas);
    if (!(total > 0) || !(feitas >= 0)) return PCT.recordingStart;
    const frac = Math.min(1, feitas / total);
    return Math.round(PCT.recordingStart + (PCT.recordingEnd - PCT.recordingStart) * frac);
  }
  return null;
}

export function monotonicPct(prev, next) {
  const base = Number.isFinite(prev) ? prev : 0;
  if (!Number.isFinite(next)) return base;
  return Math.max(base, Math.min(100, Math.round(next)));
}

export function capturePhasePct(elapsedMs, expectedMs = 25_000) {
  if (!(elapsedMs > 0)) return 0;
  return Math.min(PCT.captureCap, Math.floor((elapsedMs / expectedMs) * (PCT.captureCap + 1)));
}
