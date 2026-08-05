// FASE 0 — harness de escrita REAL do bridge (P3 do plano
// docs/superpowers/plans/2026-08-05-fase0-provas-override-per-target.md).
//
// Extraído da mecânica provada do `_probe-detach-witness.mjs` (que NÃO é
// tocado — é baseline tracked): captura de postMessage, eval do bridge real,
// seleção por CLIQUE (como a UI) e patch por MessageEvent com o protocolo
// `uncraft-motion-editor/v1`. Erro reportado é o que o BRIDGE emitiu
// (patch-rejected/error) — o harness não valida nada por conta própria; é
// isso que o self-test de sensibilidade prova.
//
// Uso como módulo:
//   import { launch, openCase, closeBrowser } from './_probe-fase0-harness.mjs';
//   const kase = await openCase({ setup: `...cria tweens na página...` });
//   const sel = await kase.select('a');
//   const r = await kase.applyPatch({ elementId: sel.elementId, kind: 'motion',
//     motionId: sel.motionIds[0], property: 'retarget.final', before: null,
//     value: { schemaVersion: 2, runtimeProperty: 'x', value: 160, affectedTargetCount: 1 } });
//   const out = await kase.evalInPage(`return gsap.getProperty(document.getElementById('a'), 'x')`);
//   await kase.close();
//
// Self-test: node _probe-fase0-harness.mjs   → "HARNESS OK (2/2)"
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { getRuntimeBridgeSource } from './lib/motion-editor/runtime-bridge-source.js';

const GSAP = '/Users/adilsonporto/Desktop/IA/Unspirit-Clone-1to1/site/assets/gsap/3.15.0/gsap.min.js';
export const FIXTURE_ROOT = '/Users/adilsonporto/Desktop/IA/Unspirit-Clone-1to1/site/assets/gsap/3.15.0';
const gsapSrc = readFileSync(GSAP, 'utf8');
const bridgeSrc = getRuntimeBridgeSource();

let browser = null;
export async function launch() {
  if (!browser) browser = await chromium.launch({ headless: true });
  return browser;
}
export async function closeBrowser() {
  if (browser) { await browser.close(); browser = null; }
}

const DEFAULT_HTML = ['a', 'b', 'c', 'd']
  .map((id) => `<div id="${id}" style="width:40px;height:40px"></div>`)
  .join('');

// `setup` roda NA PÁGINA depois do bridge (cria tweens etc.); `extraScripts`
// são fontes adicionais (ex.: SplitText) injetadas depois do GSAP.
export async function openCase({ html, setup, extraScripts = [] } = {}) {
  await launch();
  const page = await browser.newPage();
  await page.setContent(html || DEFAULT_HTML);
  await page.addScriptTag({ content: gsapSrc });
  for (const src of extraScripts) await page.addScriptTag({ content: src });
  await page.evaluate(([bridge, setupBody]) => {
    /* eslint-disable no-undef */
    window.__fase0msgs = [];
    window.postMessage = (m) => window.__fase0msgs.push(m);
    window.eval(bridge);
    if (setupBody) new Function(setupBody)();
  }, [bridgeSrc, setup || '']);

  const kase = {
    page,
    // Seleção pelo caminho da UI (clique real). Separada do patch porque a
    // seleção SOZINHA já rebobina o tween (lição do witness do detach).
    async select(domId) {
      return page.evaluate((id) => {
        const el = document.getElementById(id);
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        const sel = window.__fase0msgs.filter((m) => m.type === 'selection-changed').pop();
        return {
          elementId: sel?.payload?.element?.id || null,
          motionIds: (sel?.payload?.element?.motion || []).map((m) => m.id),
          motion: JSON.parse(JSON.stringify(sel?.payload?.element?.motion || [])),
        };
      }, domId);
    },
    // Patch pelo MESMO seam da UI. `ok:false` + `erro` vêm do bridge.
    async applyPatch(patch) {
      return page.evaluate((p) => {
        const marca = window.__fase0msgs.length;
        window.dispatchEvent(new MessageEvent('message', {
          source: window,
          data: {
            protocol: 'uncraft-motion-editor/v1', source: 'host', type: 'apply-patch',
            payload: { patch: p },
          },
        }));
        const err = window.__fase0msgs.slice(marca)
          .filter((m) => m.type === 'patch-rejected' || m.type === 'error').pop();
        return { ok: !err, erro: err ? (err.payload?.message || err.type) : null };
      }, patch);
    },
    // Escape hatch pra medição específica do caso (corpo de função, na página).
    async evalInPage(body, arg) {
      return page.evaluate(([b, a]) => new Function('arg', b)(a), [body, arg ?? null]);
    },
    async close() { await page.close(); },
  };
  return kase;
}

// ---------------------------------------------------------------------------
// Self-test (P3): prova que o driver alcança o VALIDADOR do bridge (não é
// atalho) e que um patch válido muda o DOM renderizando DO INÍCIO.
// ---------------------------------------------------------------------------
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) {
  const falhas = [];

  // Caso 1 — SENSIBILIDADE: patch estruturalmente inválido tem que voltar com
  // o erro DO BRIDGE (`invalid_value` de retarget.final sem schemaVersion).
  // Se o harness "aplicasse" por atalho, isso passaria silencioso.
  {
    const kase = await openCase({
      setup: `window.__tw = gsap.to('#a', { x: 100, duration: 1, paused: true });
              window.__tw.progress(0.5, true);`,
    });
    const sel = await kase.select('a');
    const r = await kase.applyPatch({
      elementId: sel.elementId, kind: 'motion', motionId: sel.motionIds[0],
      property: 'retarget.final', before: null, value: {},
    });
    if (r.ok !== false || !r.erro) falhas.push(`caso1: esperado erro do bridge, veio ${JSON.stringify(r)}`);
    if (!sel.elementId || sel.motionIds.length !== 1) falhas.push(`caso1: seleção incompleta ${JSON.stringify(sel)}`);
    await kase.close();
  }

  // Caso 2 — patch VÁLIDO muda o DOM renderizando do início: retarget do end
  // de x pra 160 num tween single-target; render 0→1 tem que dar 160.
  {
    const kase = await openCase({
      setup: `window.__tw = gsap.to('#a', { x: 100, duration: 1, paused: true });
              window.__tw.progress(0.5, true);`,
    });
    const sel = await kase.select('a');
    const r = await kase.applyPatch({
      elementId: sel.elementId, kind: 'motion', motionId: sel.motionIds[0],
      property: 'retarget.final', before: null,
      value: { schemaVersion: 2, runtimeProperty: 'x', value: 160, affectedTargetCount: 1 },
    });
    const fim = await kase.evalInPage(`
      window.__tw.progress(0, true); window.__tw.progress(1, true);
      return Number(gsap.getProperty(document.getElementById('a'), 'x'));
    `);
    if (!r.ok) falhas.push(`caso2: patch válido rejeitado: ${r.erro}`);
    if (fim !== 160) falhas.push(`caso2: end esperado 160, veio ${fim}`);
    await kase.close();
  }

  await closeBrowser();
  if (falhas.length) {
    console.error(`HARNESS FALHOU:\n${falhas.map((f) => `  - ${f}`).join('\n')}`);
    process.exit(1);
  }
  console.log('HARNESS OK (2/2)');
}
