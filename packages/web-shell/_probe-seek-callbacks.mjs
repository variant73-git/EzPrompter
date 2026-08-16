// REPRODUÇÃO do defeito do seek (fase 1 do systematic-debugging).
//
// Claim a verificar: `seekTimeline` (runtime-bridge-source.js:7475) é a ÚNICA
// escrita de relógio do bridge que passa `suppressEvents: false` — as outras 22
// passam `true` — e por isso DISPARA os callbacks do site clonado durante o
// scrub e durante o replay de recuperação.
//
// ⚠️ NÃO confiar em memória sobre o default de cada método do GSAP: medir.
// Mede também `pause()` sozinho (o seek chama pause antes) pra não atribuir ao
// seek um disparo que é de outro passo.
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const gsapSrc = readFileSync('/Users/adilsonporto/Desktop/IA/Unspirit-Clone-1to1/site/assets/gsap/3.15.0/gsap.min.js', 'utf8');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.setContent('<div id="a"></div><div id="r1"></div><div id="r2"></div>');
await page.addScriptTag({ content: gsapSrc });

const r = await page.evaluate(() => {
  const mk = () => {
    const fires = { onStart: 0, onUpdate: 0, onComplete: 0 };
    const tw = gsap.to('#a', {
      x: 100, duration: 1, ease: 'none', paused: true,
      onStart: () => fires.onStart++,
      onUpdate: () => fires.onUpdate++,
      onComplete: () => fires.onComplete++,
    });
    return { tw, fires };
  };
  const zero = (f) => f.onStart === 0 && f.onUpdate === 0 && f.onComplete === 0;

  // (1) pause() sozinho — para não atribuir ao seek o que é do pause
  const a = mk();
  a.tw.pause();
  const soPause = { ...a.fires };

  // (2) o caminho ATUAL do bridge: pause() + time(v, false)
  const b = mk();
  b.tw.pause();
  b.tw.time(0.5, false);
  const atual = { ...b.fires };

  // (3) o caminho PROPOSTO: pause() + time(v, true)
  const c = mk();
  c.tw.pause();
  c.tw.time(0.5, true);
  const proposto = { ...c.fires };

  // (4) scrub REPETIDO como o usuário faz (arrastar o playhead)
  const d = mk();
  d.tw.pause();
  for (let i = 1; i <= 10; i += 1) d.tw.time(i / 10, false);
  const scrubAtual = { ...d.fires };

  const e = mk();
  e.tw.pause();
  for (let i = 1; i <= 10; i += 1) e.tw.time(i / 10, true);
  const scrubProposto = { ...e.fires };

  // (5) CONTROLE de sensibilidade: os callbacks REALMENTE existem e disparam
  // por um caminho conhecido (render natural até o fim). Sem isto, "0 disparos"
  // no caso (3) poderia ser callback que nunca funciona.
  const f = mk();
  f.tw.progress(1);          // avanço natural, sem supressão
  const controle = { ...f.fires };

  // (6) o valor RENDERIZADO é o mesmo nos dois caminhos? (o fix não pode
  // mudar o que o usuário vê ao arrastar)
  // ⚠️ elementos PRÓPRIOS por caso: os tweens acima deixaram #a em x=100, e um
  // tween novo sobre ele animaria 100→100 — a 1ª versão comparou 100 com 100 e
  // "passou" sem nada se mover (verde vácuo).
  const mkOn = (sel) => gsap.to(sel, { x: 100, duration: 1, ease: 'none', paused: true });
  const g = mkOn('#r1'); g.pause(); g.time(0.37, false);
  const xFalse = Number(gsap.getProperty('#r1', 'x'));
  const h = mkOn('#r2'); h.pause(); h.time(0.37, true);
  const xTrue = Number(gsap.getProperty('#r2', 'x'));

  return {
    soPause, atual, proposto, scrubAtual, scrubProposto, controle,
      render: { xFalse, xTrue, iguais: xFalse === xTrue, moveu: xFalse > 0 && xFalse < 100 },
    zeros: { soPause: zero(soPause), proposto: zero(proposto), scrubProposto: zero(scrubProposto) },
  };
});

await browser.close();
console.log(JSON.stringify(r, null, 2));

const falhas = [];
if (!r.zeros.soPause) falhas.push('pause() sozinho já dispara — o defeito não é atribuível só ao seek');
if (r.controle.onUpdate === 0 && r.controle.onComplete === 0) falhas.push('CONTROLE: callbacks nunca disparam nem no caminho natural — instrumento cego');
if (r.atual.onUpdate === 0 && r.atual.onComplete === 0) falhas.push('DEFEITO NÃO REPRODUZIDO: time(v,false) não disparou callback nenhum');
if (!r.zeros.proposto) falhas.push('FIX NÃO FUNCIONA: time(v,true) ainda dispara');
if (!r.zeros.scrubProposto) falhas.push('FIX NÃO FUNCIONA no scrub repetido');
if (!r.render.moveu) falhas.push(`CONTROLE do render: o alvo não estava em voo (x=${r.render.xFalse}) — comparação seria vácua`);
if (!r.render.iguais) falhas.push(`FIX MUDA O RENDER: ${r.render.xFalse} vs ${r.render.xTrue}`);
console.log(falhas.length ? `\n${falhas.length} PROBLEMA(S):\n- ${falhas.join('\n- ')}` : '\nreprodução OK: defeito confirmado e fix válido');
process.exit(falhas.length ? 1 : 0);
