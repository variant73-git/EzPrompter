// Caminho 2 para GSAP: leitura das animacoes VIVAS numa pagina real (GSAP 3.15 + ScrollTrigger)
// e traducao para fichas. A pagina ja vem com os ids canonicos (data-u-id), como na normalizacao.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lerGsapNaPagina, fichasDoGsap, CONTROLE_GSAP } from './ler-gsap.mjs';

const RAIZ = process.cwd();
let browser; let page; let lido;
beforeAll(async () => {
  const { chromium } = await import('playwright-core');
  browser = await chromium.launch(); page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  await page.setContent(`<body style="margin:0"><div data-u-id="u-sec" style="height:600px;margin-top:900px"><h2 data-u-id="u-tit"><span data-u-rec="r1">Ola</span> <span data-u-rec="r2">mundo</span></h2><div data-u-id="u-caixa" style="width:50px;height:50px"></div></div>
    <div data-u-id="u-letreiro" style="width:50px;height:20px"></div><div data-u-id="u-pausada"></div><div data-u-id="u-figura" style="width:10px;height:10px"></div><div data-u-id="u-ts"></div><div data-u-id="u-ioio"></div><div data-u-id="u-m0"></div><div data-u-id="u-m1"></div><div data-u-id="u-set"></div><div data-u-id="u-ir"></div><div data-u-id="u-rapido"></div><div data-u-id="u-set0"></div><div data-u-id="u-c0"></div><div data-u-id="u-c1"></div><div data-u-id="u-c2"></div><div data-u-id="u-laco-pausado"></div><div data-u-id="u-fixo" style="height:100px;width:2000px"><div data-u-id="u-dentro" style="width:100px;height:50px;margin-left:900px"></div></div><div style="height:3000px"></div></body>`);
  await page.addScriptTag({ content: await readFile(path.join(RAIZ, 'node_modules/gsap/dist/gsap.min.js'), 'utf8') });
  await page.addScriptTag({ content: await readFile(path.join(RAIZ, 'node_modules/gsap/dist/ScrollTrigger.min.js'), 'utf8') });
  await page.evaluate(() => {
    const g = window.gsap; g.registerPlugin(window.ScrollTrigger);
    const tl = g.timeline({ scrollTrigger: { trigger: '[data-u-id="u-sec"]', start: 'top 80%', end: 'bottom top', scrub: 0.5 } });
    tl.from('[data-u-rec]', { y: 40, opacity: 0, stagger: 0.1, duration: 0.5, ease: 'power3.out' })
      .to('[data-u-id="u-caixa"]', { x: 200, duration: 1 }, 0.3)
      .to('[data-u-id="u-caixa"]', { x: 400, duration: 1 });
    g.to('[data-u-id="u-letreiro"]', { xPercent: -100, duration: 4, repeat: -1, ease: 'none' });
    g.to('[data-u-id="u-figura"]', { keyframes: [{ y: -20, duration: 1 }, { y: 0, rotation: 90, duration: 1 }], repeat: -1 });
    // Astra: relogio com timeScale aninhado; vai-e-volta amostrado numa iteracao; alvos distintos; set; immediateRender:false
    const sub = g.timeline().to('[data-u-id="u-ts"]', { x: 100, duration: 1 }, 1); sub.timeScale(2);
    g.timeline({ delay: 0.25 }).add(sub, 3);
    g.to('[data-u-id="u-ioio"]', { x: 100, duration: 1, repeat: 1, yoyo: true });
    g.to(['[data-u-id="u-m0"]', '[data-u-id="u-m1"]'], { x: (i) => i * 100 + 10, duration: 1, stagger: 0.5 });
    g.timeline().set('[data-u-id="u-set"]', { opacity: 0.3 }, 0.5).to('[data-u-id="u-set"]', { y: 5, duration: 1 }, 1);
    g.from('[data-u-id="u-ir"]', { x: -60, duration: 1, delay: 2, immediateRender: false });
    // Astra r2: velocidade do PROPRIO dono; set no 0 de uma linha que repete; ordem a partir do centro
    g.to('[data-u-id="u-rapido"]', { x: 100, duration: 1 }).timeScale(2);
    g.timeline({ repeat: -1 }).set('[data-u-id="u-set0"]', { opacity: 0.2 }, 0).to('[data-u-id="u-set0"]', { y: 9, duration: 1 }, 0.5);
    g.to(['[data-u-id="u-c0"]', '[data-u-id="u-c1"]', '[data-u-id="u-c2"]'], { x: (i) => (i + 1) * 10, duration: 1, stagger: { each: 0.5, from: 'center' } });
    g.to('[data-u-id="u-pausada"]', { x: 10, paused: true });
    g.to('[data-u-id="u-laco-pausado"]', { x: 30, repeat: -1, duration: 2, paused: true });
    const faixa = g.to('[data-u-id="u-fixo"]', { x: -500, ease: 'none', scrollTrigger: { trigger: '[data-u-id="u-fixo"]', pin: true, scrub: true, end: '+=500' } });
    g.to('[data-u-id="u-dentro"]', { opacity: 0.5, scrollTrigger: { trigger: '[data-u-id="u-dentro"]', containerAnimation: faixa, start: 'left 80%', end: 'left 20%', scrub: true } });
    g.to({ quadro: 0 }, { quadro: 10, duration: 1 });
    g.to('[data-u-id="u-caixa"]', { rotation: 30, duration: 1, data: { id: 'ta-0001' } });   // acao do IX3
  });
  lido = await page.evaluate(lerGsapNaPagina, { mapaPartes: { r1: 'u-tit--w0', r2: 'u-tit--w1' }, controle: CONTROLE_GSAP });
}, 60000);
afterAll(async () => { if (browser) await browser.close(); });

describe('lerGsapNaPagina + fichasDoGsap', () => {
  it('pula a pausada (sem gatilho legivel) e o alvo nao-DOM', () => {
    expect(lido.pulos.pausadas).toBe(2); expect(lido.pulos.alvosNaoDom).toBeGreaterThan(0);   // a pausada e o laco pausado
  });
  it('a linha com gatilho de rolagem vira UMA linha de tempo com o gatilho relativo do site', () => {
    const { fichas } = fichasDoGsap(lido);
    const daLinha = fichas.filter((f) => f.motor.tipo === 'rolagem' && f.motor.gatilho === '#u-sec');
    expect(new Set(daLinha.map((f) => f.linha)).size).toBe(1);
    expect(daLinha[0].motor).toEqual({ tipo: 'rolagem', gatilho: '#u-sec', inicio: 'top 80%', fim: 'bottom top', arrasto: 0.5 });
  });
  it('texto em partes vira o texto inteiro com dividir; de/para amostrados (from = estado dado -> atual)', () => {
    const { fichas } = fichasDoGsap(lido);
    const t = fichas.find((f) => f.alvo === '#u-tit');
    expect(t).toMatchObject({ dividir: 'words', de: { y: 40, opacity: 0 }, para: { y: 0, opacity: 1 }, curva: 'power3.out', intervalo: { cada: 0.1 }, posicao: 0 });
  });
  it('posicao dentro da linha e a 2a acao no mesmo alvo nao pre-renderiza', () => {
    const cx = fichasDoGsap(lido).fichas.filter((f) => f.alvo === '#u-caixa').sort((a, b) => a.posicao - b.posicao);
    expect(cx.map((f) => [f.posicao, f.de.x, f.para.x])).toEqual([[0.3, 0, 200], [1.3, 200, 400]]);
    expect(cx[0].imediato).toBeUndefined(); expect(cx[1].imediato).toBe(false);
  });
  it('acao do IX3 (data.id ta-…) nao e lida de novo', () => {
    expect(lido.pulos.doIx3).toBe(1);
    expect(fichasDoGsap(lido).fichas.some((f) => f.alvo === '#u-caixa' && f.para && f.para.rotation !== undefined)).toBe(false);
  });
  it('laco PAUSADO sem controlador legivel fica de fora (Astra: inventava movimento)', () => {
    expect(fichasDoGsap(lido).fichas.some((f) => f.alvo === '#u-laco-pausado')).toBe(false);
  });
  it('rolagem horizontal: a faixa FIXA a tela (espaco ja na estrutura) e o gatilho de dentro conta o deslizamento dela', () => {
    const fs = fichasDoGsap(lido).fichas;
    const faixa = fs.find((f) => f.alvo === '#u-fixo'); const dentro = fs.find((f) => f.alvo === '#u-dentro');
    expect(faixa.motor).toMatchObject({ fixar: true, espacoReservado: true, fim: '+=500' });
    expect(dentro.motor).toMatchObject({ inicio: 'left 80%', fim: 'left 20%', conteiner: faixa.linha });
  });
  it('keyframes do GSAP viram QUADROS amostrados (laco de figura)', () => {
    const f = fichasDoGsap(lido).fichas.find((x) => x.alvo === '#u-figura');
    expect(f).toMatchObject({ motor: { tipo: 'tempo' }, repetir: -1, curva: 'none' });
    expect(f.quadros.length).toBe(12);   // so os DESTINOS: o estado inicial nao vira quadro (pausa no comeco)
    expect(f.quadros[5]).toMatchObject({ y: -20 }); expect(f.quadros[11]).toMatchObject({ y: 0, rotation: 90 });
  });
  it('Astra: relogio aninhado com timeScale e o delay declarado da raiz', () => {
    const f = fichasDoGsap(lido).fichas.find((x) => x.alvo === '#u-ts');
    expect(f).toMatchObject({ posicao: 3.5, duracao: 0.5, de: { x: 0 }, para: { x: 100 }, motor: { tipo: 'carga', atraso: 0.25 } });
  });
  it('Astra: vai-e-volta amostrado em UMA iteracao (nao some como "sem mudanca")', () => {
    expect(fichasDoGsap(lido).fichas.find((x) => x.alvo === '#u-ioio')).toMatchObject({ de: { x: 0 }, para: { x: 100 }, repetir: 1, vaiVolta: true, duracao: 1 });
  });
  it('Astra: alvos com trajetorias DIFERENTES viram uma ficha cada, no seu instante', () => {
    const fs = fichasDoGsap(lido).fichas.filter((x) => x.alvo === '#u-m0' || x.alvo === '#u-m1').sort((a, b) => a.posicao - b.posicao);
    expect(fs.map((x) => [x.alvo, x.para.x, x.posicao, x.duracao])).toEqual([['#u-m0', 10, 0, 1], ['#u-m1', 110, 0.5, 1]]);
  });
  it('Astra: set (duracao 0) sobrevive; immediateRender:false do site e preservado', () => {
    const fs = fichasDoGsap(lido).fichas;
    expect(fs.find((x) => x.alvo === '#u-set' && x.para.opacity !== undefined)).toMatchObject({ duracao: 0, para: { opacity: 0.3 }, posicao: 0.5 });
    expect(fs.find((x) => x.alvo === '#u-ir')).toMatchObject({ de: { x: -60 }, para: { x: 0 }, imediato: false });
  });
  it('Astra r2: velocidade do dono, set no 0 de laco, ordem que o tocador nao reproduz', () => {
    const fs = fichasDoGsap(lido).fichas;
    expect(fs.find((x) => x.alvo === '#u-rapido')).toMatchObject({ de: { x: 0 }, para: { x: 100 }, duracao: 0.5 });
    expect(fs.find((x) => x.alvo === '#u-set0' && x.para.opacity !== undefined)).toMatchObject({ duracao: 0, para: { opacity: 0.2 } });
    expect(fs.some((x) => ['#u-c0', '#u-c1', '#u-c2'].includes(x.alvo))).toBe(false);
    expect(lido.pulos.alvosDistintosNaoReproduz).toBeGreaterThanOrEqual(1);
  });
  it('Astra: dependente cujo conteiner nao virou ficha sai (fica com a observacao)', () => {
    const lidoFalso = { pulos: {}, linhas: [
      { id: 1, st: { gatilho: 'u-f', inicio: 0, fim: '+=500', scrub: true, naoReproduz: [] }, itens: [{ alvos: [{ id: 'u-f' }], de: { left: 0 }, para: { left: -500 }, posicao: 0, duracao: 1, curva: 'none' }] },
      { id: 2, st: { gatilho: 'u-d', inicio: 'left 80%', fim: 'left 20%', scrub: true, conteiner: 1, naoReproduz: [] }, itens: [{ alvos: [{ id: 'u-d' }], de: { opacity: 0 }, para: { opacity: 1 }, posicao: 0, duracao: 1, curva: 'none' }] },
    ] };
    const r = fichasDoGsap(lidoFalso);
    expect(r.fichas).toEqual([]); expect(r.relatorio.conteinerAusente).toBe(1);
  });
  it('laco infinito sem gatilho vira motor tempo com repeticao', () => {
    const l = fichasDoGsap(lido).fichas.find((f) => f.alvo === '#u-letreiro');
    expect(l).toMatchObject({ motor: { tipo: 'tempo' }, repetir: -1, para: { xPercent: -100 }, curva: 'none' });
  });
});
