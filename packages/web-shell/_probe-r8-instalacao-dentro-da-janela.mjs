// PROBE r8 — bloqueador do Sol: o `onUpdate` do site, vivo DENTRO da janela,
// pode INSTALAR um `onComplete` novo (via `eventCallback`), e como o GSAP relê
// `vars` na hora do disparo (N3), essa função nova pode rodar no MESMO seek,
// antes do `finally`. Se isso acontecer, a supressão não é completa.
//
// O D1 anterior só olhava QUEM sobrou depois da janela — não se a nova DISPAROU
// dentro dela. Aqui instalação e disparo são contados SEPARADAMENTE.
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const g = readFileSync('/Users/adilsonporto/Desktop/IA/Unspirit-Clone-1to1/site/assets/gsap/3.15.0/gsap.min.js', 'utf8');
const b = await chromium.launch({ headless: true }); const p = await b.newPage();
await p.setContent(['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8'].map((i) => `<div id="${i}"></div>`).join(''));
await p.addScriptTag({ content: g });

const r = await p.evaluate(() => {
  const LIFECYCLE = ['onStart', 'onComplete', 'onRepeat'];
  const janela = (an, body) => {
    const saved = LIFECYCLE.map((k) => [k, Object.prototype.hasOwnProperty.call(an.vars, k), an.vars[k]]);
    LIFECYCLE.forEach((k) => { if (Object.prototype.hasOwnProperty.call(an.vars, k)) an.vars[k] = undefined; });
    try { body(); } finally { saved.forEach(([k, tinha, v]) => { if (tinha) an.vars[k] = v; }); }
  };

  const monta = (sel) => {
    const f = { instalou: 0, novaDisparou: 0, originalDisparou: 0, u: 0 };
    const tw = gsap.to(sel, {
      x: 100, duration: 1, ease: 'none', paused: true,
      onComplete: () => { f.originalDisparou += 1; },
      onUpdate: () => {
        f.u += 1;
        if (f.instalou) return;
        f.instalou = 1;
        // o site instala um onComplete NOVO de dentro do próprio render
        tw.eventCallback('onComplete', () => { f.novaDisparou += 1; });
      },
    });
    return { tw, f };
  };

  // CONTROLE (sem janela): a função instalada dentro do render dispara no MESMO
  // seek que cruza a conclusão? Se não disparar nem aqui, o teste seria vácuo.
  const a = monta('#q1');
  a.tw.pause(); a.tw.time(0.05, true);            // pré-render (inicializa, não roda onUpdate)
  a.tw.time(1, false);                            // cruza a conclusão
  const controle = { ...a.f };

  // TESTE: com a janela aberta, a nova instalada lá dentro dispara?
  const c = monta('#q2');
  c.tw.pause(); c.tw.time(0.05, true);
  const base = { ...c.f };
  janela(c.tw, () => { c.tw.time(1, false); });
  const teste = {
    instalou: c.f.instalou - base.instalou,
    novaDisparou: c.f.novaDisparou - base.novaDisparou,
    originalDisparou: c.f.originalDisparou - base.originalDisparou,
  };
  const depoisDaJanela = typeof c.tw.vars.onComplete === 'function'
    ? (c.tw.vars.onComplete.toString().includes('novaDisparou') ? 'a nova do site' : 'a original')
    : String(c.tw.vars.onComplete);

  // ---- r9 — o site REINSTALA a função ORIGINAL dentro da janela -----------
  // O escopo "callbacks presentes na entrada" ainda seria falso: a função é a
  // MESMA que estava lá, e mesmo assim dispara, porque o slot foi reescrito.
  // O limite real é o SLOT ter permanecido anulado — não a identidade.
  const montaReinstala = (sel) => {
    const f = { original: 0, reinstalou: 0 };
    const original = () => { f.original += 1; };
    const tw = gsap.to(sel, {
      x: 100, duration: 1, ease: 'none', paused: true,
      onComplete: original,
      onUpdate: () => {
        if (f.reinstalou) return;
        f.reinstalou = 1;
        tw.vars.onComplete = original;      // exatamente a MESMA função da entrada
      },
    });
    return { tw, f, original };
  };
  const e = montaReinstala('#q3');
  e.tw.pause(); e.tw.time(0.05, true);
  const baseR = { ...e.f };
  janela(e.tw, () => { e.tw.time(1, false); });
  const reinstalaOriginal = {
    reinstalou: e.f.reinstalou - baseR.reinstalou,
    originalDisparouNaJanela: e.f.original - baseR.original,
    mesmaFuncaoNoFim: e.tw.vars.onComplete === e.original,
  };

  // ---- r10/r11 — a FRONTEIRA, agora com OPORTUNIDADE DE DESPACHO real -----
  // A 1ª versão deste braço deu zero VÁCUO (bloqueador r11 do Sol): o tween era
  // pré-renderizado para 0.05 e o seek ia 0.05 → 0.5, então o `onStart` não tinha
  // ponto de despacho nenhum e o `onComplete` nunca cruzava o fim. Zero ali é
  // compatível com "não havia callback devido", não com "foi suprimido".
  // Agora cada braço tem CONTROLE que confirma o disparo antes de acreditar no zero.

  // (i) onStart: seek 0 → 0.5 numa animação já inicializada e devolvida ao início
  // ⚠️ SEM `invalidate()`. A versão anterior o chamava ao devolver o tween a
  // zero, o que REINICIALIZA — então o controle media um caminho de lazy-init,
  // não "animação já inicializada devolvida ao início" (bloqueador r12 do Sol).
  const mkStart = (sel, reinstala) => {
    const f = { s: 0, u: 0, reinstalou: 0 };
    const original = () => { f.s += 1; };
    const tw = gsap.to(sel, {
      x: 100, duration: 1, ease: 'none', paused: true,
      onStart: original,
      onUpdate: () => { f.u += 1; if (reinstala) { f.reinstalou += 1; tw.vars.onStart = original; } },
    });
    tw.pause(); tw.time(0.4, false); tw.time(0, true);   // inicializa e volta em silêncio
    return { tw, f };
  };
  const sCtl = mkStart('#q4', false);                       // CONTROLE: sem janela
  const baseSC = sCtl.f.s; sCtl.tw.time(0.5, false);
  const startControle = sCtl.f.s - baseSC;

  const sTest = mkStart('#q5', true);                       // janela + reinstalação
  const baseST = sTest.f.s;
  janela(sTest.tw, () => { sTest.tw.time(0.5, false); });
  const startComJanelaEReinstalacao = sTest.f.s - baseST;
  const startReinstalou = sTest.f.reinstalou;

  // (ii) onComplete cruzando a conclusão: controle, braço POSITIVO (reescreve o
  //      próprio slot) e braço NEGATIVO (escreve só uma chave que não é callback)
  const mkComplete = (sel, modo) => {
    const f = { c: 0, u: 0 };
    const original = () => { f.c += 1; };
    const tw = gsap.to(sel, {
      x: 100, duration: 1, ease: 'none', paused: true,
      onComplete: original,
      onUpdate: () => {
        f.u += 1;
        if (modo === 'reescreve') tw.vars.onComplete = original;
        if (modo === 'outraChave') tw.vars.id = 'mexido-dentro-da-janela';
      },
    });
    tw.pause(); tw.time(0.05, true);
    return { tw, f };
  };
  const cCtl = mkComplete('#q6', 'nada');                   // CONTROLE: sem janela
  const baseCC = cCtl.f.c; cCtl.tw.time(1, false);
  const completeControle = cCtl.f.c - baseCC;

  const cPos = mkComplete('#q7', 'reescreve');              // POSITIVO
  const baseCP = cPos.f.c;
  janela(cPos.tw, () => { cPos.tw.time(1, false); });
  const completePositivo = cPos.f.c - baseCP;

  const cNeg = mkComplete('#q8', 'outraChave');             // NEGATIVO
  const baseCN = cNeg.f.c;
  janela(cNeg.tw, () => { cNeg.tw.time(1, false); });
  const completeNegativo = cNeg.f.c - baseCN;

  const fronteira = {
    startControle, startComJanelaEReinstalacao, startReinstalou, rodouUpdateStart: sTest.f.u,
    completeControle, completePositivo, completeNegativo, rodouUpdateNeg: cNeg.f.u,
  };

  return { controle, teste, depoisDaJanela, reinstalaOriginal, fronteira };
});
await b.close();
console.log(JSON.stringify(r, null, 2));
const f = [];
if (!r.controle.instalou) f.push('CONTROLE VÁCUO: o site não chegou a instalar o callback novo');
if (r.controle.novaDisparou === 0) f.push('CONTROLE VÁCUO: nem sem janela a função instalada dentro do render dispara no mesmo seek — o hazard não é montável assim');
console.log('\n--- LEITURA ---');
console.log(`CONTROLE (sem janela): instalou=${r.controle.instalou}, a NOVA disparou=${r.controle.novaDisparou}, a original disparou=${r.controle.originalDisparou}`);
console.log(`TESTE (com janela): instalou=${r.teste.instalou}, a NOVA disparou DENTRO da janela=${r.teste.novaDisparou}, a original=${r.teste.originalDisparou}`);
console.log(`quem ficou em vars depois da janela: ${r.depoisDaJanela}`);
if (r.teste.novaDisparou > 0) console.log('\n→ BLOQUEADOR REPRODUZIDO: a supressão TEM furo — o site consegue disparar dentro da janela instalando de dentro do onUpdate');
else console.log('\n→ o bloqueador NÃO se reproduz nesta construção: a função instalada dentro da janela não disparou');
const q = r.reinstalaOriginal;
console.log(`\n--- r9 (o site REINSTALA a função ORIGINAL dentro da janela) ---`);
console.log(`reinstalou=${q.reinstalou}, a ORIGINAL disparou dentro da janela=${q.originalDisparouNaJanela}, mesma função no fim=${q.mesmaFuncaoNoFim}`);
if (!q.reinstalou) f.push('r9 VÁCUO: o site não chegou a reinstalar');
else if (q.originalDisparouNaJanela > 0) console.log('→ CONFIRMADO: o limite NÃO é a identidade do callback, é o slot ter ficado anulado — a MESMA função da entrada dispara se for reescrita');
else console.log('→ o braço r9 NÃO reproduz: reinstalar a mesma função não fez disparar');
const fr = r.fronteira;
console.log(`\n--- r10/r11 (FRONTEIRA, com oportunidade de despacho e controle por braço) ---`);
console.log(`onStart  → controle=${fr.startControle} | janela + REINSTALAÇÃO depois do despacho=${fr.startComJanelaEReinstalacao} (onUpdate rodou ${fr.rodouUpdateStart}×, reinstalou ${fr.startReinstalou}×)`);
console.log(`onComplete → controle=${fr.completeControle} | POSITIVO (reescreve o próprio slot)=${fr.completePositivo} | NEGATIVO (escreve só outra chave)=${fr.completeNegativo} (onUpdate rodou ${fr.rodouUpdateNeg}×)`);
if (fr.startControle === 0) f.push('FRONTEIRA VÁCUA (onStart): o controle não disparou — sem oportunidade de despacho, o zero do teste não prova nada');
if (fr.startReinstalou === 0) f.push('FRONTEIRA VÁCUA (onStart): a reinstalação não chegou a acontecer dentro da janela');
if (fr.completeControle === 0) f.push('FRONTEIRA VÁCUA (onComplete): o controle não disparou');
if (fr.rodouUpdateNeg === 0) f.push('FRONTEIRA VÁCUA: o onUpdate do braço negativo não rodou, então a escrita nem aconteceu');
if (fr.completePositivo === 0) f.push('braço POSITIVO não reproduziu o escape — a fronteira perde o lado de cá');
if (fr.startControle > 0 && fr.completeControle > 0 && fr.rodouUpdateNeg > 0) {
  console.log(`→ fronteira sustentada: reescrever o slot ANTES do despacho reabre (${fr.completePositivo}); reinstalar DEPOIS do despacho (${fr.startComJanelaEReinstalacao}) e escrever outra chave (${fr.completeNegativo}) não reabrem`);
}
console.log(f.length ? `\n${f.length} PROBLEMA(S):\n- ${f.join('\n- ')}` : '');
process.exit(f.length ? 1 : 0);
