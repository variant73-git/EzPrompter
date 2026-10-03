// Caminho 2 (leitor do IX3 do Webflow): extracao do dado, traducao para fichas e resolucao dos
// alvos numa pagina real (mesma sessao da normalizacao: cada elemento ja tem `data-u-id`).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { extrairRegistro, fichasDoIx3, resolverNaPagina, DURACAO_PADRAO } from './ler-ix3.mjs';

const ROL = { controlType: 'scroll', scrollTriggerConfig: { start: 'top bottom', end: 'bottom top', scrub: 0.8, enter: 'play', leave: 'none', enterBack: 'none', leaveBack: 'none' } };
const JS = `foo();e.ready().then(()=>{t.register([{id:"i-1",scope:{type:"site"},triggers:[["wf:scroll",${JSON.stringify(ROL)},["wf:class",["card"],{relationship:"none",firstMatchOnly:!1}]]],timelineIds:["t-1"],deleted:!1}],[{id:"t-1",deleted:!1,actions:[{id:"a-1",targets:[["wf:trigger-only","",{relationship:"none"}]],timing:{position:.2,ease:8},tt:2,properties:{"wf:transform":{opacity:["0%","100%"],y:["100%","0%"]}}}]}])});`;

describe('extrairRegistro', () => {
  it('le o literal do register (com !0/!1 e numeros .2) sem executar codigo do site', () => {
    const r = extrairRegistro(JS);
    expect(r.falhas).toEqual([]);
    expect(r.interacoes.map((i) => i.id)).toEqual(['i-1']);
    expect(r.interacoes[0].deleted).toBe(false);
    expect(r.linhas[0].actions[0].timing.position).toBe(0.2);
  });
  it('recusa register que traga codigo (nao e dado)', () => {
    const r = extrairRegistro('t.register([{id:"x",triggers:[],f:()=>1}],[])');
    expect(r.interacoes).toEqual([]);
    expect(r.falhas[0]).toMatch(/codigo/);
  });
});

describe('fichasDoIx3', () => {
  const linhas = [{ id: 't-1', actions: [
    { id: 'a-1', targets: [['wf:trigger-only', '']], timing: { position: 0.2, ease: 8 }, tt: 2, properties: { 'wf:transform': { opacity: ['0%', '100%'], y: ['100%', '0%'] } } },
    { id: 'a-2', targets: [['wf:trigger-only', '']], timing: { position: '500ms', duration: 1, stagger: { amount: 0.3, from: 'random' } }, tt: 2, properties: { 'wf:transform': { y: ['0%', '-20%'] }, 'wf:style': { display: ['none', 'block'] } } },
    { id: 'a-3', targets: [['wf:class', ['x']]], timing: {}, tt: 3, properties: { 'wf:transform': { opacity: ['', '0%'] } } },
    { id: 'a-4', targets: [['wf:class', ['y']]], timing: {}, tt: 1, properties: { 'wf:transform': { x: ['-50px', ''] } }, splitText: { type: 'words', mask: 'words' } },
    { id: 'a-5', targets: [['wf:class', ['vazio']]], timing: {}, tt: 2, properties: { 'wf:transform': { x: [0, 1] } } },
  ] }];
  const instancias = [{ interacao: 'i-1', linha: 't-1', k: 0, tipo: 'wf:scroll', cfg: ROL, gatilho: 'u-card', acoes: [
    { ai: 0, ids: ['u-card'], semId: 0 }, { ai: 1, ids: ['u-card'], semId: 0 }, { ai: 2, ids: ['u-x'], semId: 0 }, { ai: 3, ids: ['u-y1', 'u-y2'], semId: 1 }, { ai: 4, ids: [], semId: 0 },
  ] }];
  const { fichas, relatorio } = fichasDoIx3({ linhas }, { instancias });
  const f = Object.fromEntries(fichas.map((x) => [x.id.split('-').slice(-2, -1)[0], x]));
  it('fromTo com porcentagem de opacidade em 0..1, curva pelo indice, duracao padrao, linha e posicao', () => {
    expect(f[1]).toMatchObject({ linha: 'ix-i-1-t-1-0', posicao: 0.2, alvo: '#u-card', de: { opacity: 0, y: '100%' }, para: { opacity: 1, y: '0%' }, duracao: DURACAO_PADRAO, curva: 'power3.out' });
    expect(f[1].motor).toEqual({ tipo: 'rolagem', gatilho: '#u-card', inicio: 'top bottom', fim: 'bottom top', arrasto: 0.8, acoes: 'play none none none' });
  });
  it('clamp do IX3 vira clamp() do ScrollTrigger', () => {
    const lc = [{ id: 't-c', actions: [{ id: 'a', targets: [['wf:trigger-only', '']], timing: {}, tt: 2, properties: { 'wf:transform': { x: [0, 10] } } }] }];
    const cfg = { scrollTriggerConfig: { ...ROL.scrollTriggerConfig, clamp: true } };
    const r = fichasDoIx3({ linhas: lc }, { instancias: [{ interacao: 'i', linha: 't-c', k: 0, tipo: 'wf:scroll', cfg, gatilho: 'u-g', acoes: [{ ai: 0, ids: ['u-g'], semId: 0 }] }] });
    expect(r.fichas[0].motor).toMatchObject({ inicio: 'clamp(top bottom)', fim: 'clamp(bottom top)' });
  });
  it('posicao em ms, escalonamento por total, display fica de fora e e contado', () => {
    expect(f[2]).toMatchObject({ posicao: 0.5, duracao: 1, intervalo: { total: 0.3, de: 'random' } });
    expect(f[2].para).toEqual({ y: '-20%' });
    expect(relatorio.foraDoContrato['wf:style.display']).toBe(1);
  });
  it('a acao que REPETE uma propriedade do mesmo alvo nao pre-renderiza (regra do runtime)', () => {
    expect(f[1].imediato).toBeUndefined();
    expect(f[2].imediato).toBe(false);
  });
  it('set = duracao 0; from = so `de`; divisao de texto vira dividir; alvo sem id contado; acao sem alvo pulada', () => {
    expect(f[3]).toMatchObject({ duracao: 0, para: { opacity: 0 } });
    expect(f[3].de).toBeUndefined();
    expect(f[4]).toMatchObject({ de: { x: '-50px' }, dividir: 'words', alvo: ['#u-y1', '#u-y2'] });
    expect(f[4].para).toBeUndefined();
    expect(f[5]).toBeUndefined();
    expect(relatorio).toMatchObject({ acoesSemAlvo: 1, alvosSemId: 1, mascaras: 1, divisoes: 1, fichas: 4 });
  });
});

describe('resolverNaPagina (Chromium real)', () => {
  let browser; let page;
  beforeAll(async () => {
    const { chromium } = await import('playwright-core');
    browser = await chromium.launch(); page = await browser.newPage();
    await page.setContent(`<div class="card" data-u-id="u-c1"><span class="t" data-u-id="u-t1"></span></div>
      <div class="card" data-u-id="u-c2"><span class="t" data-u-id="u-t2"></span><p data-u-id="u-p2"><b data-u-id="u-b2"></b></p></div>
      <span class="t" data-u-id="u-fora"></span><div data-wf-target='[["pg","el-9"]]' data-u-id="u-inst"></div>`);
  }, 60000);
  afterAll(async () => { if (browser) await browser.close(); });
  const linhas = [{ id: 't', actions: [
    { id: 'a', targets: [['wf:class', ['t'], { relationship: 'within', filterBy: ['wf:trigger-only', ''] }]] },
    { id: 'b', targets: [['wf:any-element', '*', { relationship: 'direct-child-of', filterBy: ['wf:trigger-only', ''] }]] },
    { id: 'c', targets: [['wf:inst', ['pg', 'el-9']]] },
    { id: 'd', targets: [['wf:coisa-nova', 'x']] },
  ] }];
  const ints = [
    { id: 'i-rol', triggers: [['wf:scroll', ROL, ['wf:class', ['card'], { relationship: 'none' }]]], timelineIds: ['t'] },
    { id: 'i-clique', triggers: [['wf:click', {}, ['wf:class', ['card']]]], timelineIds: ['t'] },
    { id: 'i-tela', triggers: [['wf:scroll', ROL, ['wf:class', ['card']]]], timelineIds: ['t'], conditionalPlayback: [{ type: 'breakpoint', behavior: 'dont-animate', breakpoints: ['main'] }] },
  ];
  it('uma instancia por elemento-gatilho; alvos relativos a ELA; clique e tela grande pulados', async () => {
    const r = await page.evaluate(resolverNaPagina, { interacoes: ints, linhas, largura: 1440 });
    expect(r.pulos).toMatchObject({ cliques: 1, porTamanhoDeTela: 1 });
    expect(r.instancias.map((x) => x.gatilho)).toEqual(['u-c1', 'u-c2']);
    const [i1, i2] = r.instancias;
    expect(i1.acoes[0].ids).toEqual(['u-t1']);              // so o .t DENTRO do gatilho
    expect(i2.acoes[0].ids).toEqual(['u-t2']);
    expect(i2.acoes[1].ids).toEqual(['u-t2', 'u-p2']);      // filhos diretos, nao o neto
    expect(i1.acoes[2].ids).toEqual(['u-inst']);            // instancia por data-wf-target
    expect(i1.acoes[3]).toMatchObject({ ids: [], desconhecido: true });
  });
  it('em tela pequena a interacao condicionada a "main" volta a valer', async () => {
    const r = await page.evaluate(resolverNaPagina, { interacoes: ints, linhas, largura: 800 });
    expect(r.pulos.porTamanhoDeTela).toBe(0);
    expect(r.instancias.length).toBe(4);
  });
});
