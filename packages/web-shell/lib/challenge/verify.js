import { detectChallengePage } from '../snapshot.js';

// Veredito sobre o alvo numa página já aberta (spec 2026-09-08 §4.1). Modo
// ESTRITO do detector: null = olhei e está limpo; objeto = challenge;
// undefined = não consegui olhar (NÃO libera — lição 186, Astra r2 #1).
// Só um documento CARREGADO e limpo libera.
export async function verifyTarget({ page, url, toleranceMs = 40_000, cancelled = () => false }) {
  await page.goto(url, { waitUntil: 'load', timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const limite = Date.now() + toleranceMs;
  let ultimo = null;
  for (;;) {
    const carregou = await page.waitForLoadState('load', { timeout: 2000 }).then(() => true, () => false);
    const v = carregou ? await detectChallengePage(page, { strict: true }) : undefined;
    if (v === null) return { verdict: 'clean' };
    if (v) ultimo = v;
    if (Date.now() >= limite || cancelled()) break;
    await page.waitForTimeout(500);
  }
  const kind = ultimo?.kind || 'generic_challenge';
  const signals = ultimo?.signals || ['uninspectable'];
  // Bloqueio DURO: não há captcha para resolver ('Access denied', 'Attention
  // Required', Akamai/PerimeterX sem widget). O que sobra é challenge
  // acionável → humano.
  const hard = signals.some((s) => /^title:(Access denied|Attention Required)/i.test(s))
    || kind === 'akamai' || kind === 'perimeterx';
  return { verdict: hard ? 'unsupported' : 'needs_human', kind, signals };
}
