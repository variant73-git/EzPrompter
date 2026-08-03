// WITNESS COMPLETO do `link.detach` — passo 0 do handoff de 2026-08-02.
//
// Contrato declarado no código: "mint an EQUIVALENT standalone tween for this
// element" → descontinuidade é DEFEITO, não escolha.
//
// Estrutura (as três lições que custaram caro na tentativa anterior):
//   1. ⭐ CONTROLE POSITIVO — sem ele um gate que vira no-op passa a matriz
//      negativa inteira, que foi exatamente o que aconteceu.
//   2. ⭐ STAGGER — o consumidor shipado que motivou o detach.
//   3. ⭐ ALVOS PRÓPRIOS POR CASO — cada caso roda numa PÁGINA NOVA (bridge e
//      registries frescos). Alvos compartilhados contaminaram uma medição.
//
// Os negativos NÃO afirmam que o comportamento shipado é bom — afirmam que ele
// é o que é. Qualquer mudança neles = regressão em comportamento auditado.
//
// Uso:
//   node _probe-detach-witness.mjs            # assertivo (compara com BASELINE)
//   node _probe-detach-witness.mjs --record   # imprime o JSON pra congelar
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { getRuntimeBridgeSource } from './lib/motion-editor/runtime-bridge-source.js';

const GSAP = '/Users/adilsonporto/Desktop/IA/Unspirit-Clone-1to1/site/assets/gsap/3.15.0/gsap.min.js';
const gsapSrc = readFileSync(GSAP, 'utf8');
const bridgeSrc = getRuntimeBridgeSource();
const RECORD = process.argv.includes('--record');

// ---------------------------------------------------------------------------
// Casos. Cada `body` é o corpo de uma função avaliada NA PÁGINA, com acesso a:
//   E(id)          → elemento
//   X(el) / Y(el)  → gsap.getProperty numérico
//   detach(el)     → dispara o patch link.detach pelo CAMINHO REAL do bridge
//   clonOf(tw,el)  → o tween-clone recém-criado para `el`
//   traj(clone,el) → { de, ate } trajetória do clone (restaura o progresso)
// ---------------------------------------------------------------------------
const CASES = [
  // === POSITIVOS: o detach deve preservar a continuidade ===================
  ...[0, 0.5, 1].map((parked) => ({
    id: `positivo-plain-parked-${parked}`,
    kind: 'positivo',
    body: `
      const a = E('a'), b = E('b');
      const tw = gsap.to([a, b], { x: 100, duration: 1, paused: true });
      tw.progress(${parked}, true);
      const alvoAntes = X(a), irmaoAntes = X(b);
      const r = detach(a);
      const alvoDepois = X(a), irmaoDepois = X(b);
      const clone = clonOf(tw, a);
      const t = clone ? traj(clone, a) : { de: null, ate: null };
      return { erro: r.erro, alvoAntes, alvoDepois, irmaoAntes, irmaoDepois,
               achouClone: !!clone, clonePausado: clone ? clone.paused() : null,
               cloneDe: t.de, cloneAte: t.ate };
    `,
  })),
  {
    // O consumidor shipado: desacorrentar UMA barra de um stagger.
    id: 'positivo-stagger-parked-0.5',
    kind: 'positivo',
    body: `
      const a = E('a'), b = E('b'), c = E('c'), d = E('d');
      const tw = gsap.to([a, b, c, d], { x: 100, duration: 0.5, stagger: 0.15, paused: true });
      tw.progress(0.5, true);
      const alvoAntes = X(a), irmaoAntes = X(b);
      const r = detach(a);
      const alvoDepois = X(a), irmaoDepois = X(b);
      const clone = clonOf(tw, a);
      const t = clone ? traj(clone, a) : { de: null, ate: null };
      return { erro: r.erro, alvoAntes, alvoDepois, irmaoAntes, irmaoDepois,
               achouClone: !!clone, clonePausado: clone ? clone.paused() : null,
               cloneDe: t.de, cloneAte: t.ate };
    `,
  },
  {
    id: 'positivo-stagger-parked-0',
    kind: 'positivo',
    body: `
      const a = E('a'), b = E('b'), c = E('c'), d = E('d');
      const tw = gsap.to([a, b, c, d], { x: 100, duration: 0.5, stagger: 0.15, paused: true });
      tw.progress(0, true);
      const alvoAntes = X(a), irmaoAntes = X(b);
      const r = detach(a);
      const alvoDepois = X(a), irmaoDepois = X(b);
      const clone = clonOf(tw, a);
      const t = clone ? traj(clone, a) : { de: null, ate: null };
      return { erro: r.erro, alvoAntes, alvoDepois, irmaoAntes, irmaoDepois,
               achouClone: !!clone, clonePausado: clone ? clone.paused() : null,
               cloneDe: t.de, cloneAte: t.ate };
    `,
  },

  // Uma barra que NÃO é a primeira: endereçar o alvo errado passaria despercebido
  // num witness que só testa a barra 0 (achado do Sol).
  ...['b', 'c', 'd'].map((barra) => ({
    id: `positivo-stagger-barra-${barra}`,
    kind: 'positivo',
    body: `
      const alvos = ['a','b','c','d'].map(E);
      const alvo = E('${barra}'), vizinho = E('a');
      const tw = gsap.to(alvos, { x: 100, duration: 0.5, stagger: 0.15, paused: true });
      tw.progress(0.5, true);
      const alvoAntes = X(alvo), irmaoAntes = X(vizinho);
      const r = detach(alvo);
      const alvoDepois = X(alvo), irmaoDepois = X(vizinho);
      const clone = clonOf(tw, alvo);
      const t = clone ? traj(clone, alvo) : { de: null, ate: null };
      return { erro: r.erro, alvoAntes, alvoDepois, irmaoAntes, irmaoDepois,
               achouClone: !!clone, clonePausado: clone ? clone.paused() : null,
               cloneDe: t.de, cloneAte: t.ate };
    `,
  })),
  {
    // Depois do detach o elemento tem que ser MESMO independente: mexer no
    // clone não pode mover os irmãos, e vice-versa.
    // Registrado como negativo (não-pior) e não como positivo: o isolamento
    // pós-`kill` já é frágil no shipado (o alvo segue em `targets()`), então o
    // contrato aqui é "não piorou", não um ideal que eu ainda não provei.
    id: 'negativo-independencia-apos-detach',
    kind: 'negativo',
    body: `
      const a = E('a'), b = E('b'), c = E('c'), d = E('d');
      const tw = gsap.to([a, b, c, d], { x: 100, duration: 0.5, stagger: 0.15, paused: true });
      tw.progress(0.5, true);
      const r = detach(a);
      const clone = clonOf(tw, a);
      const irmaoAntes = X(b);
      clone.progress(0.25, true);                 // mexe SÓ no destacado
      const alvoAposScrub = X(a), irmaoAposScrub = X(b);
      const alvoAntesDoScrubDoPai = X(a);
      tw.progress(0.8, true);                     // mexe SÓ no compartilhado
      const alvoAposScrubDoPai = X(a), irmaoAposScrubDoPai = X(b);
      return { erro: r.erro,
               // trajetória própria: o clone move o alvo
               cloneMoveOAlvo: alvoAposScrub !== 99.75,
               irmaoImuneAoClone: irmaoAntes === irmaoAposScrub,
               alvoImuneAoCompartilhado: alvoAntesDoScrubDoPai === alvoAposScrubDoPai,
               compartilhadoAindaMoveOIrmao: irmaoAposScrub !== irmaoAposScrubDoPai };
    `,
  },
  {
    // ⭐ CONTROLE: seleção SOZINHA, sem patch nenhum. Se algo se mexe aqui, o
    // drift é da inspeção e não do detach (o shipado move o irmão no yoyoEase).
    id: 'controle-selecao-sozinha-yoyo',
    kind: 'negativo',
    body: `
      const a = E('a'), b = E('b');
      const tw = gsap.to([a, b], {
        x: 100, duration: 1, paused: true, yoyo: true, repeat: 1, yoyoEase: 'power2.in',
      });
      tw.progress(0.75, true);
      const alvoAntes = X(a), irmaoAntes = X(b);
      selecionar(a);                              // NENHUM patch
      const alvoDepois = X(a), irmaoDepois = X(b);
      return { alvoAntes, alvoDepois, irmaoAntes, irmaoDepois,
               selecaoMoveuAlgo: alvoAntes !== alvoDepois || irmaoAntes !== irmaoDepois };
    `,
  },

  // === NEGATIVOS: o comportamento tem que ficar IDÊNTICO ao shipado ========
  {
    // ⭐ Achado 1 do revisor Claude: `vars.keyframes` (forma array) cria uma
    // TIMELINE INTERNA, e um render FORÇADO obriga todos os filhos a renderizar
    // em ordem crescente — o último a escrever `x` vence e o "início" sai
    // errado. É o idioma que os itens 168b/169/171 passaram 126+42 rodadas
    // suportando, então aqui o contrato é o mais duro que existe.
    id: 'negativo-keyframes-array-rebobina-certo',
    kind: 'negativo',
    body: `
      const a = E('a'), b = E('b'), c = E('c'), d = E('d');
      const tw = gsap.to([a, b, c, d], {
        keyframes: [{ x: 100, duration: 0.5 }, { y: 50, duration: 0.5 }, { x: 0, duration: 0.5 }],
        paused: true,
      });
      tw.progress(0.15, true);
      const alvoAntes = X(a), alvoYAntes = Y(a), irmaoAntes = X(b);
      const r = detach(a);
      const alvoDepois = X(a), irmaoDepois = X(b);
      const clone = clonOf(tw, a);
      let cloneXem0 = null, cloneYem0 = null;
      if (clone) {
        const p = clone.progress();
        clone.progress(0, true); cloneXem0 = X(a); cloneYem0 = Y(a);
        clone.progress(p, true);
      }
      return { erro: r.erro, alvoAntes, alvoYAntes, alvoDepois, irmaoAntes, irmaoDepois,
               achouClone: !!clone,
               // o início verdadeiro deste keyframe é (0,0)
               cloneXem0, cloneYem0,
               saltoDoAlvo: Math.abs(alvoDepois - alvoAntes) };
    `,
  },
  {
    // ⭐ Achado 2 do revisor Claude: uma LINHA com vários alvos (fragmentos de
    // split-text). O clone mantém `vars.stagger` e vira fachada, mas o `parked`
    // vinha do progresso do FILHO — dois relógios diferentes.
    id: 'negativo-linha-multi-alvo',
    kind: 'negativo',
    html: '<div id="row" style="width:200px"><span id="f1" style="display:inline-block;width:40px">A</span>'
      + '<span id="f2" style="display:inline-block;width:40px">B</span></div>'
      + '<span id="f3" style="display:inline-block;width:40px">C</span>',
    body: `
      const f1 = E('f1'), f2 = E('f2'), f3 = E('f3'), row = E('row');
      const tw = gsap.to([f1, f2, f3], { x: 100, duration: 0.5, stagger: 0.15, paused: true });
      tw.progress(0.5, true);
      const frag1Antes = X(f1), frag2Antes = X(f2), foraAntes = X(f3);
      const r = detach(row);                      // a linha inteira: f1 E f2
      const frag1Depois = X(f1), frag2Depois = X(f2), foraDepois = X(f3);
      return { erro: r.erro,
               frag1Antes, frag1Depois, frag2Antes, frag2Depois, foraAntes, foraDepois,
               salto1: Math.abs(frag1Depois - frag1Antes),
               salto2: Math.abs(frag2Depois - frag2Antes) };
    `,
  },
  {
    // ⭐ Achado 2/3 do Sol, confirmado por probe (`_probe-detach-iteracao.mjs`):
    // `progress()` NÃO identifica a iteração. Restaurar por progress devolve o
    // tween à iteração errada, e o cssText restaurado MASCARA o dano até o
    // próximo tick. Por isso este caso mede o estado TEMPORAL e o próximo tick,
    // não a posição imediata.
    id: 'negativo-repeat-estado-temporal',
    kind: 'negativo',
    body: `
      const a = E('a'), b = E('b');
      const tw = gsap.to([a, b], { x: 100, duration: 1, repeat: 2, paused: true });
      tw.totalTime(1.5, true);                 // 2a iteração, 50%
      const r = detach(a);
      const ttDepois = Number(tw.totalTime().toFixed(6));
      const iteracaoDepois = tw.iteration();
      const revertidoDepois = tw.reversed();
      tw.totalTime(tw.totalTime() + 0.1, true);
      const irmaoNoProximoTick = X(b);
      return { erro: r.erro, ttDepois, iteracaoDepois, revertidoDepois, irmaoNoProximoTick };
    `,
  },
  {
    // O mesmo, na forma que MOSTRA o dano: um yoyo na volta restaurado errado
    // volta a andar PRA FRENTE.
    id: 'negativo-yoyo-direcao-no-proximo-tick',
    kind: 'negativo',
    body: `
      const a = E('a'), b = E('b');
      const tw = gsap.to([a, b], { x: 100, duration: 1, yoyo: true, repeat: 1, paused: true });
      tw.totalTime(1.5, true);                 // perna de volta, 50%
      const irmaoAntes = X(b);
      const r = detach(a);
      const ttDepois = Number(tw.totalTime().toFixed(6));
      tw.totalTime(tw.totalTime() + 0.1, true);
      const irmaoNoProximoTick = X(b);
      return { erro: r.erro, irmaoAntes, ttDepois, irmaoNoProximoTick,
               // na volta o irmão tem que RECUAR
               irmaoRecuou: irmaoNoProximoTick < irmaoAntes };
    `,
  },
  {
    // ⭐ Achado crítico do Sol: tween MISTO CSS + `attr`. O `cssText` vê o lado
    // CSS variar (informative=true) e ele bate nas duas pontas, mas o ATRIBUTO
    // é um canal que o instrumento não enxerga — o clone sai errado nele e
    // recebe carimbo de verificado. Com stagger, o filho compartilhado é morto
    // e o relink é recusado: falso positivo IRREVERSÍVEL.
    id: 'negativo-misto-css-e-attr',
    kind: 'negativo',
    body: `
      const a = E('a'), b = E('b'), c = E('c');
      const tw = gsap.to([a, b, c], {
        keyframes: [
          { attr: { 'data-n': 100 }, duration: 0.5, runBackwards: true },
          { x: 100, duration: 0.5 },
          { x: 200, duration: 0.5 },
        ],
        stagger: 0.15, ease: 'none', paused: true,
      });
      tw.progress(0.15, true);
      const attrAntes = a.getAttribute('data-n');
      const alvoAntes = X(a), irmaoAntes = X(b);
      const r = detach(a);
      const attrDepois = a.getAttribute('data-n');
      const alvoDepois = X(a), irmaoDepois = X(b);
      return { erro: r.erro, attrAntes, attrDepois, alvoAntes, alvoDepois, irmaoAntes, irmaoDepois,
               saltoDoAlvo: Math.abs(alvoDepois - alvoAntes),
               saltoDoAtributo: Math.abs(Number(attrDepois) - Number(attrAntes)) };
    `,
  },
  {
    // `totalDuration()` de um repeat infinito é Infinity. A busca pela ponta
    // final passa por `finite()`, que devolve 0 — as duas pontas ficam iguais,
    // a medição vira não-informativa e o caso cai no fallback. Isso é
    // raciocínio sobre o código; o caso existe pra MEDIR.
    id: 'negativo-repeat-infinito',
    kind: 'negativo',
    body: `
      const a = E('a'), b = E('b');
      const tw = gsap.to([a, b], { x: 100, duration: 1, repeat: -1, paused: true });
      tw.totalTime(0.5, true);
      const alvoAntes = X(a), irmaoAntes = X(b);
      const r = detach(a);
      const alvoDepois = X(a), irmaoDepois = X(b);
      const clone = clonOf(tw, a);
      return { erro: r.erro, alvoAntes, alvoDepois, irmaoAntes, irmaoDepois,
               achouClone: !!clone, saltoDoAlvo: Math.abs(alvoDepois - alvoAntes) };
    `,
  },
  {
    id: 'negativo-duracao-zero',
    kind: 'negativo',
    body: `
      const a = E('a'), b = E('b');
      const tw = gsap.to([a, b], { x: 100, duration: 0, paused: true });
      tw.progress(1, true);
      const alvoAntes = X(a), irmaoAntes = X(b);
      const r = detach(a);
      const alvoDepois = X(a), irmaoDepois = X(b);
      const clone = clonOf(tw, a);
      return { erro: r.erro, alvoAntes, alvoDepois, irmaoAntes, irmaoDepois,
               achouClone: !!clone, saltoDoAlvo: Math.abs(alvoDepois - alvoAntes) };
    `,
  },
  {
    // Undo do detach num tween PURO (o único caso que o shipado suporta).
    id: 'negativo-undo-relink-plain',
    kind: 'negativo',
    body: `
      const a = E('a'), b = E('b');
      const tw = gsap.to([a, b], { x: 100, duration: 1, paused: true });
      tw.progress(0.5, true);
      const r = detach(a);
      const u = relink(a, r.motionId);
      const alvoAposRelink = X(a), irmaoAposRelink = X(b);
      // O alvo voltou a ser dirigido pelo compartilhado?
      tw.progress(1, true);
      const alvoNoFim = X(a), irmaoNoFim = X(b);
      return { erroDetach: r.erro, erroRelink: u.erro,
               alvoAposRelink, irmaoAposRelink, alvoNoFim, irmaoNoFim,
               voltouAoCompartilhado: alvoNoFim === irmaoNoFim };
    `,
  },
  {
    // O shipado RECUSA re-acorrentar um stagger — a mensagem é contrato.
    id: 'negativo-undo-relink-stagger-recusa',
    kind: 'negativo',
    body: `
      const a = E('a'), b = E('b'), c = E('c'), d = E('d');
      const tw = gsap.to([a, b, c, d], { x: 100, duration: 0.5, stagger: 0.15, paused: true });
      tw.progress(0.5, true);
      const r = detach(a);
      const u = relink(a, r.motionId);
      return { erroDetach: r.erro, erroRelink: u.erro };
    `,
  },
  {
    id: 'negativo-from-parked-0.5',
    kind: 'negativo',
    body: `
      const a = E('a'), b = E('b');
      const tw = gsap.from([a, b], { x: 100, duration: 1, paused: true });
      tw.progress(0.5, true);
      const alvoAntes = X(a), irmaoAntes = X(b);
      const r = detach(a);
      const alvoDepois = X(a), irmaoDepois = X(b);
      const clone = clonOf(tw, a);
      const t = clone ? traj(clone, a) : { de: null, ate: null };
      return { erro: r.erro, alvoAntes, alvoDepois, irmaoAntes, irmaoDepois,
               achouClone: !!clone, cloneDe: t.de, cloneAte: t.ate };
    `,
  },
  {
    id: 'negativo-keyframes-runBackwards',
    kind: 'negativo',
    body: `
      const a = E('a'), b = E('b');
      const tw = gsap.to([a, b], {
        keyframes: [{ x: 100, duration: 1, runBackwards: true }],
        paused: true,
      });
      tw.progress(0.5, true);
      const alvoAntes = X(a), irmaoAntes = X(b);
      const r = detach(a);
      const alvoDepois = X(a), irmaoDepois = X(b);
      const clone = clonOf(tw, a);
      const t = clone ? traj(clone, a) : { de: null, ate: null };
      return { erro: r.erro, alvoAntes, alvoDepois, irmaoAntes, irmaoDepois,
               achouClone: !!clone, cloneDe: t.de, cloneAte: t.ate };
    `,
  },
  {
    // Regressão observada na rodada 2: o estilo que o IRMÃO recebeu DEPOIS do
    // clearProps ter disparado era apagado pelo rewind.
    id: 'negativo-clearProps-estilo-posterior-do-irmao',
    kind: 'negativo',
    body: `
      const a = E('a'), b = E('b');
      const tw = gsap.to([a, b], { x: 100, duration: 1, clearProps: 'all', paused: true });
      tw.progress(1, true);              // completa → clearProps dispara
      b.style.backgroundColor = 'rgb(1, 2, 3)';
      gsap.set(b, { y: 33 });            // estilo POSTERIOR do irmão
      const irmaoYAntes = Y(b), irmaoBgAntes = b.style.backgroundColor;
      const r = detach(a);
      const irmaoYDepois = Y(b), irmaoBgDepois = b.style.backgroundColor;
      return { erro: r.erro, irmaoYAntes, irmaoYDepois, irmaoBgAntes, irmaoBgDepois,
               estiloDoIrmaoSobreviveu: irmaoYDepois === 33 && irmaoBgDepois === 'rgb(1, 2, 3)' };
    `,
  },
  {
    id: 'negativo-duracao-funcional',
    kind: 'negativo',
    body: `
      const a = E('a'), b = E('b');
      const tw = gsap.to([a, b], { x: 100, duration: (i) => i + 1, paused: true });
      tw.progress(0.5, true);
      const alvoAntes = X(a), irmaoAntes = X(b);
      const r = detach(a);
      const alvoDepois = X(a), irmaoDepois = X(b);
      const clone = clonOf(tw, a);
      const t = clone ? traj(clone, a) : { de: null, ate: null };
      return { erro: r.erro, alvoAntes, alvoDepois, irmaoAntes, irmaoDepois,
               achouClone: !!clone, cloneDe: t.de, cloneAte: t.ate };
    `,
  },
  {
    id: 'negativo-delay-funcional',
    kind: 'negativo',
    body: `
      const a = E('a'), b = E('b');
      const tw = gsap.to([a, b], { x: 100, duration: 1, delay: (i) => i * 0.5, paused: true });
      tw.progress(0.5, true);
      const alvoAntes = X(a), irmaoAntes = X(b);
      const r = detach(a);
      const alvoDepois = X(a), irmaoDepois = X(b);
      const clone = clonOf(tw, a);
      const t = clone ? traj(clone, a) : { de: null, ate: null };
      return { erro: r.erro, alvoAntes, alvoDepois, irmaoAntes, irmaoDepois,
               achouClone: !!clone, cloneDe: t.de, cloneAte: t.ate };
    `,
  },
  {
    // Callbacks são CONTROLES FUNCIONAIS que NÃO criam timeline interna
    // (medido `inner:false`) — a guarda estrutural é cega pra eles.
    // O rewind usa progress(_, true), que suprime eventos: a PISTA a demonstrar.
    id: 'negativo-callbacks-top-level',
    kind: 'negativo',
    body: `
      const a = E('a'), b = E('b');
      window.__n = { start: 0, update: 0, complete: 0, repeat: 0 };
      const tw = gsap.to([a, b], {
        x: 100, duration: 1, paused: true,
        onStart() { window.__n.start++; },
        onUpdate() { window.__n.update++; },
        onComplete() { window.__n.complete++; },
      });
      tw.progress(0.5, true);
      const alvoAntes = X(a), irmaoAntes = X(b);
      const nAntes = { ...window.__n };
      const r = detach(a);
      const nDepois = { ...window.__n };
      const alvoDepois = X(a), irmaoDepois = X(b);
      const clone = clonOf(tw, a);
      return { erro: r.erro, alvoAntes, alvoDepois, irmaoAntes, irmaoDepois,
               achouClone: !!clone,
               callbacksAntes: nAntes, callbacksDepois: nDepois,
               callbacksDispararamNoDetach:
                 nDepois.start !== nAntes.start || nDepois.update !== nAntes.update ||
                 nDepois.complete !== nAntes.complete };
    `,
  },
  {
    // Ease com ESTADO: contar invocações revela re-render escondido.
    id: 'negativo-ease-funcional-com-estado',
    kind: 'negativo',
    body: `
      const a = E('a'), b = E('b');
      window.__easeCalls = 0;
      const tw = gsap.to([a, b], {
        x: 100, duration: 1, paused: true,
        ease: (p) => { window.__easeCalls++; return p * p; },
      });
      tw.progress(0.5, true);
      const alvoAntes = X(a), irmaoAntes = X(b);
      const easeAntes = window.__easeCalls;
      const r = detach(a);
      const easeDepois = window.__easeCalls;
      const alvoDepois = X(a), irmaoDepois = X(b);
      const clone = clonOf(tw, a);
      const t = clone ? traj(clone, a) : { de: null, ate: null };
      return { erro: r.erro, alvoAntes, alvoDepois, irmaoAntes, irmaoDepois,
               achouClone: !!clone, cloneDe: t.de, cloneAte: t.ate,
               // contagem EXATA, não booleano: um sampling a mais dobraria as
               // chamadas e um booleano continuaria passando (achado do Sol).
               easeChamadasNoDetach: easeDepois - easeAntes };
    `,
  },
  {
    // Relato do auditor na rodada 3 (irmão 62,5 → 75), NÃO reproduzido antes.
    id: 'negativo-yoyoEase',
    kind: 'negativo',
    body: `
      const a = E('a'), b = E('b');
      const tw = gsap.to([a, b], {
        x: 100, duration: 1, paused: true, yoyo: true, repeat: 1, yoyoEase: 'power2.in',
      });
      tw.progress(0.75, true);
      const alvoAntes = X(a), irmaoAntes = X(b);
      const r = detach(a);
      const alvoDepois = X(a), irmaoDepois = X(b);
      const clone = clonOf(tw, a);
      const t = clone ? traj(clone, a) : { de: null, ate: null };
      return { erro: r.erro, alvoAntes, alvoDepois, irmaoAntes, irmaoDepois,
               achouClone: !!clone, cloneDe: t.de, cloneAte: t.ate };
    `,
  },
  {
    id: 'negativo-timeline-pai',
    kind: 'negativo',
    body: `
      const a = E('a'), b = E('b');
      const tl = gsap.timeline({ paused: true });
      const tw = tl.to([a, b], { x: 100, duration: 1 });
      tl.progress(0.5, true);
      const alvoAntes = X(a), irmaoAntes = X(b);
      const r = detach(a);
      const alvoDepois = X(a), irmaoDepois = X(b);
      const clone = clonOf(tw, a);
      const t = clone ? traj(clone, a) : { de: null, ate: null };
      return { erro: r.erro, alvoAntes, alvoDepois, irmaoAntes, irmaoDepois,
               achouClone: !!clone, cloneDe: t.de, cloneAte: t.ate,
               paiProgresso: Number(tl.progress().toFixed(4)) };
    `,
  },
  {
    id: 'negativo-reverse',
    kind: 'negativo',
    body: `
      const a = E('a'), b = E('b');
      const tw = gsap.to([a, b], { x: 100, duration: 1, paused: true });
      tw.progress(1, true);
      tw.reverse();
      tw.pause();
      tw.progress(0.5, true);
      const alvoAntes = X(a), irmaoAntes = X(b);
      const revertidoAntes = tw.reversed();
      const r = detach(a);
      const alvoDepois = X(a), irmaoDepois = X(b);
      const clone = clonOf(tw, a);
      return { erro: r.erro, alvoAntes, alvoDepois, irmaoAntes, irmaoDepois,
               achouClone: !!clone, revertidoAntes, revertidoDepois: tw.reversed() };
    `,
  },
  {
    // Reprodução ATIVA: valores são não-determinísticos por natureza, então só
    // fatos estruturais viram asserção.
    id: 'negativo-reproducao-ativa',
    kind: 'negativo',
    body: `
      const a = E('a'), b = E('b');
      const tw = gsap.to([a, b], { x: 100, duration: 10 });   // rodando
      const pausadoAntes = tw.paused();
      const r = detach(a);
      const clone = clonOf(tw, a);
      return { erro: r.erro, pausadoAntes, pausadoDepois: tw.paused(),
               achouClone: !!clone, clonePausado: clone ? clone.paused() : null };
    `,
  },
];

// ---------------------------------------------------------------------------
// Execução — uma PÁGINA NOVA por caso (bridge, registries e alvos frescos).
// ---------------------------------------------------------------------------
const browser = await chromium.launch({ headless: true });

async function runCase(kase) {
  const page = await browser.newPage();
  await page.setContent(kase.html
    || ['a', 'b', 'c', 'd'].map((id) => `<div id="${id}" style="width:40px;height:40px"></div>`).join(''));
  await page.addScriptTag({ content: gsapSrc });
  const out = await page.evaluate(([bridge, body]) => {
    /* eslint-disable no-undef */
    const messages = [];
    window.postMessage = (m) => messages.push(m);
    window.eval(bridge);

    const E = (id) => document.getElementById(id);
    const X = (el) => Number(gsap.getProperty(el, 'x'));
    const Y = (el) => Number(gsap.getProperty(el, 'y'));

    // Caminho REAL do bridge: selecionar como a UI seleciona e aplicar o patch.
    // ⭐ `selecionar` existe separado de `patch` porque a seleção SOZINHA já
    // renderiza o tween (a inspeção rebobina) — sem separar, um drift causado
    // pela seleção seria creditado ao detach.
    const selecionar = (target) => {
      target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      const sel = messages.filter((m) => m.type === 'selection-changed').pop();
      return {
        elementId: sel?.payload?.element?.id,
        motionIds: (sel?.payload?.element?.motion || []).map((m) => m.id),
      };
    };
    const patchDetach = (target, detached, motionIdExplicito) => {
      const marca = messages.length;
      const sel = selecionar(target);
      window.dispatchEvent(new MessageEvent('message', {
        source: window,
        data: {
          protocol: 'uncraft-motion-editor/v1', source: 'host', type: 'apply-patch',
          payload: {
            patch: {
              elementId: sel.elementId, kind: 'motion',
              motionId: motionIdExplicito || sel.motionIds[0],
              property: 'link.detach',
              before: { detached: !detached }, value: { detached },
            },
          },
        },
      }));
      const err = messages.slice(marca)
        .filter((m) => m.type === 'patch-rejected' || m.type === 'error').pop();
      return {
        erro: err ? (err.payload?.message || err.type) : null,
        motions: sel.motionIds.length,
        motionId: motionIdExplicito || sel.motionIds[0],
      };
    };
    const detach = (target) => patchDetach(target, true);
    const relink = (target, motionId) => patchDetach(target, false, motionId);

    const clonOf = (tw, el) => gsap.globalTimeline.getChildren(true, true, true)
      .find((t) => t !== tw && (t.targets?.() || []).includes(el));

    const traj = (clone, el) => {
      const p = clone.progress();
      clone.progress(0, true); const de = X(el);
      clone.progress(1, true); const ate = X(el);
      clone.progress(p, true);
      return { de, ate };
    };

    try {
      const fn = new Function('E', 'X', 'Y', 'detach', 'clonOf', 'traj', 'selecionar', 'relink', body);
      return fn(E, X, Y, detach, clonOf, traj, selecionar, relink);
    } catch (e) {
      return { excecao: String(e && e.message || e) };
    }
  }, [bridgeSrc, kase.body]);
  await page.close();
  return out;
}

const observado = {};
for (const kase of CASES) {
  observado[kase.id] = await runCase(kase);
}
await browser.close();

// ---------------------------------------------------------------------------
// BASELINE congelado do comportamento SHIPADO (`ed0809a3`, produção intocada).
// Positivos: o que o detach DEVERIA fazer (hoje falham — é o defeito).
// Negativos: o que o shipado FAZ hoje; mudar isso = regressão.
// ---------------------------------------------------------------------------
if (RECORD) {
  console.log(JSON.stringify(observado, null, 2));
  process.exit(0);
}

const BASELINE = JSON.parse(readFileSync(new URL('./_probe-detach-baseline.json', import.meta.url), 'utf8'));

// Mudanças CONHECIDAS e aceitas em relação ao shipado. Ficam aqui, travadas no
// valor observado, em vez de o witness ser afrouxado: qualquer crescimento além
// disto volta a falhar. Documentar > esconder.
// (Vazio hoje — a exceção do `ease` 10→20 pertencia à tentativa de fix do
// detach que foi REVERTIDA; baseline atual regravado da produção corrente.)
const MUDANCAS_ACEITAS = {};

let falhas = 0;
const check = (rotulo, ok, detalhe) => {
  if (!ok) falhas += 1;
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${rotulo}${detalhe ? ` — ${detalhe}` : ''}`);
};
const num = (v) => (typeof v === 'number' ? Number(v.toFixed(4)) : v);

for (const kase of CASES) {
  const r = observado[kase.id] || {};
  console.log(`\n[${kase.kind}] ${kase.id}`);
  if (r.excecao) { check('sem exceção no caso', false, r.excecao); continue; }

  if (kase.kind === 'positivo') {
    console.log(`  alvo ${num(r.alvoAntes)} -> ${num(r.alvoDepois)} · irmão ${num(r.irmaoAntes)} -> ${num(r.irmaoDepois)} · clone ${num(r.cloneDe)} -> ${num(r.cloneAte)}`);
    check('detach não falhou', r.erro == null, r.erro || '');
    check('alvo não saltou', num(r.alvoAntes) === num(r.alvoDepois), `${num(r.alvoAntes)} -> ${num(r.alvoDepois)}`);
    check('irmão não se moveu', num(r.irmaoAntes) === num(r.irmaoDepois), `${num(r.irmaoAntes)} -> ${num(r.irmaoDepois)}`);
    check('trajetória do clone preservada (0 -> 100)', num(r.cloneDe) === 0 && num(r.cloneAte) === 100, `${num(r.cloneDe)} -> ${num(r.cloneAte)}`);
  } else {
    // Negativo: NÃO PIOR que o shipado. "Idêntico" seria estrito demais — o fix
    // melhora várias destas formas (o alvo deixa de saltar, o clone deixa de
    // nascer morto), e um witness que reprova melhora empurra pra emendar o que
    // não está quebrado. O contrato é: nenhum dos três defeitos pode APARECER
    // onde não existia, e os invariantes duros não podem virar.
    const base = BASELINE[kase.id];
    if (!base) { check('baseline existe', false, 'caso ausente do baseline'); continue; }
    const defeitos = (x) => ({
      'alvo saltou': x.alvoAntes == null ? null : num(x.alvoAntes) !== num(x.alvoDepois),
      'irmão se moveu': x.irmaoAntes == null ? null : num(x.irmaoAntes) !== num(x.irmaoDepois),
      'clone nasceu morto': x.cloneDe == null ? null : num(x.cloneDe) === num(x.cloneAte),
    });
    // ⚠️ O critério dos três defeitos só enxerga casos que usam os nomes de
    // campo canônicos. Casos com nomes próprios precisam publicar um campo
    // `salto*`, que é comparado como "não pode aumentar" — foi essa lacuna que
    // deixou a regressão da linha multi-alvo passar por VERDE numa rodada.
    for (const campo of Object.keys(base)) {
      if (!campo.startsWith('salto') || typeof base[campo] !== 'number') continue;
      check(`${campo} não aumentou`, num(r[campo]) <= num(base[campo]) + 0.0001,
        `shipado ${num(base[campo])} · agora ${num(r[campo])}`);
    }
    const antes = defeitos(base); const agora = defeitos(r);
    const piorou = Object.keys(antes).filter((d) => antes[d] === false && agora[d] === true);
    const melhorou = Object.keys(antes).filter((d) => antes[d] === true && agora[d] === false);
    check(
      `nenhum defeito novo${melhorou.length ? ` (melhorou: ${melhorou.join(', ')})` : ''}`,
      piorou.length === 0,
      piorou.map((d) => `${d} passou a acontecer`).join(' | '),
    );
    // Todo campo CATEGÓRICO tem que bater: booleanos (estilo do irmão sobreviveu,
    // callbacks dispararam, clone pausado…), mensagens de erro — que são contrato
    // de UI — e contadores exatos. Valores contínuos ficam com os três critérios
    // acima, porque melhorar um valor é o objetivo, não uma regressão.
    const categoricos = Object.keys(base).filter((k) => typeof base[k] === 'boolean'
      || k.startsWith('erro') || k === 'erro' || typeof base[k] === 'string' || base[k] === null
      || k.startsWith('easeChamadas') || k.startsWith('callbacks'));
    const aceitas = MUDANCAS_ACEITAS[kase.id] || {};
    for (const campo of categoricos) {
      const aceita = aceitas[campo];
      if (aceita && num(base[campo]) === aceita.de) {
        check(`mudança ACEITA ${campo} (${aceita.de} -> ${aceita.para})`,
          num(r[campo]) === aceita.para,
          `esperado ${aceita.para} · agora ${JSON.stringify(r[campo])} — ${aceita.motivo}`);
        continue;
      }
      check(`invariante ${campo}`, JSON.stringify(num(base[campo])) === JSON.stringify(num(r[campo])),
        `shipado ${JSON.stringify(base[campo])} · agora ${JSON.stringify(r[campo])}`);
    }
  }
}

console.log(`\n${falhas === 0 ? 'WITNESS VERDE' : `${falhas} CHECK(S) FALHARAM`}`);
process.exit(falhas === 0 ? 0 : 1);
