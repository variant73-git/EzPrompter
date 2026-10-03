// Unidade das tres pecas sem navegador: o gravador do caminho 1 (fichasPorLeitura), o das
// sequencias do caminho 3 (fichasDeSequencia) e a regua de trajetoria (comparar), com os
// controles que a revisao pediu: programa vazio NAO pode ganhar nota nas revelacoes.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fichasPorLeitura, difere, medirProprio } from './gravar-trajetoria.mjs';
import { fichasDeSequencia, etiquetasQueSeMexem, normalizar, mapasDaPagina } from './normalizar-clone.mjs';
import { comparar, conferirIds, idsDoCorpo } from './regua-trajetoria.mjs';

const st = (o = {}) => ({ x: 0, y: 0, sx: 1, sy: 1, r: 0, op: 1, vis: 1, vef: 1, clip: 'none', tres: false, ...o });
const P = 100;
// 6 paradas (y = 0..500). k-arr: arrastada pela rolagem (x = y). k-rev: revelada no tempo na parada 3
// (a leitura de 300 ms pega no meio). k-par: parada. k-her: escondida so por HERANCA (o pai esconde).
const amostras = [0, 1, 2, 3, 4, 5].map((i) => ({
  y: i * P,
  a: { 'k-arr': st({ x: i * 100 }), 'k-rev': i < 3 ? st({ op: 0, vis: 0, vef: 0 }) : i === 3 ? st({ op: 0.4 }) : st(), 'k-par': st(), 'k-her': st({ vef: i < 2 ? 0 : 1 }) },
  b: { 'k-arr': st({ x: i * 100 }), 'k-rev': i < 3 ? st({ op: 0, vis: 0, vef: 0 }) : st(), 'k-par': st(), 'k-her': st({ vef: i < 2 ? 0 : 1 }) },
}));
const mapa = { 'k-arr': 'u-arr', 'k-rev': 'u-rev', 'k-par': 'u-par', 'k-her': 'u-her' };

describe('fichasPorLeitura (caminho 1)', () => {
  const { fichas, relatorio } = fichasPorLeitura({ amostras: JSON.parse(JSON.stringify(amostras)), mapa }, P);
  const por = Object.fromEntries(fichas.map((f) => [f.alvo, f]));
  it('arrastada desde o TOPO: o 1o quadro (o repouso) sai e o arrasto comeca em y=0, um quadro por passo', () => {
    const f = por['#u-arr'];
    expect(f.motor).toEqual({ tipo: 'rolagem', inicio: 0, fim: 500, arrasto: true });
    expect(f.quadros.map((q) => q.x)).toEqual([100, 200, 300, 400, 500]);
  });
  it('revelacao: de = antes, para = o estado ASSENTADO (nao o do meio), visibilidade vira autoAlpha', () => {
    const f = por['#u-rev'];
    expect(f.de).toEqual({ autoAlpha: 0 }); expect(f.para).toEqual({ autoAlpha: 1 });
    expect(f.motor).toMatchObject({ tipo: 'rolagem', inicio: 250, arrasto: false });
  });
  it('parada e escondida-por-heranca nao viram ficha', () => {
    expect(por['#u-par']).toBeUndefined(); expect(por['#u-her']).toBeUndefined();
    expect(relatorio.semMovimento).toBe(2);
  });
});

describe('fichasDeSequencia (caminho 3)', () => {
  const origem = 'http://127.0.0.1:9';
  const u = (n) => `${origem}/_ext/q/frame_${String(n).padStart(4, '0')}.avif`;
  const am = [0, 1, 2, 3, 4].map((i) => ({ y: i * P, telasA: { c1: u(i < 2 ? 0 : i - 1) }, telas: { c1: u(i < 2 ? 0 : i), c2: u(0) } }));
  const seqs = [{ rec: 'c1', ordem: [u(0), u(3), u(2), u(4)], outros: 0, ultimo: { dw: 2133, dh: 1200, cw: 1440, ch: 1200 } }, { rec: 'c2', ordem: [u(0)], outros: 0, ultimo: { dw: 1440, dh: 600, cw: 1440, ch: 1200 } }];
  const r = fichasDeSequencia({ amostras: am, sequencias: seqs, mapa: { c1: 'u-c1', c2: 'u-c2' }, origem });
  const f1 = r.fichas.find((f) => f.alvo === '#u-c1'); const f2 = r.fichas.find((f) => f.alvo === '#u-c2');
  it('quadros na ordem do NUMERO do arquivo, pontos medidos, cobrir, suavizacao detectada', () => {
    expect(f1.imagens.map((x) => x.slice(-9))).toEqual(['0000.avif', '0002.avif', '0003.avif', '0004.avif']);
    expect(f1.motor).toEqual({ tipo: 'rolagem', inicio: 100, fim: 400, arrasto: 1 });
    expect(f1.pontos).toEqual([[0, 0], [0.3333, 1], [0.6667, 2], [1, 3]]);
    expect(f1.ajuste).toBe('cobrir');
  });
  it('canvas com UMA imagem vira quadro fixo (conter quando nao cobre)', () => {
    expect(f2).toMatchObject({ imagens: ['_ext/q/frame_0000.avif'], ajuste: 'conter', motor: { tipo: 'carga' } });
    expect(r.arquivos.sort()).toEqual(['_ext/q/frame_0000.avif', '_ext/q/frame_0002.avif', '_ext/q/frame_0003.avif', '_ext/q/frame_0004.avif']);
  });
});

describe('comparar (regua de trajetoria)', () => {
  // site: u-rev escondido nas paradas 0-2 e visivel nas 3-5; u-par nunca se move
  const grav = { amostras: [0, 1, 2, 3, 4, 5].map((i) => ({ y: i * P, b: { 'u-rev': i < 3 ? st({ op: 0, vis: 0, vef: 0 }) : st(), 'u-par': st() } })) };
  const perfeito = grav.amostras.map((s) => s.b);
  // programa VAZIO: a canonica e assada com o estado revelado, entao fica visivel o tempo todo
  const vazio = grav.amostras.map(() => ({ 'u-rev': st(), 'u-par': st() }));
  it('controle positivo: o proprio site contra si = 1', () => {
    expect(comparar(grav, perfeito)).toMatchObject({ balanceada: 1, fracao: 1, paresComparados: 6, elementosJulgados: 1 });
  });
  it('controle negativo: programa vazio NAO ganha as revelacoes (repouso e movido pesam igual)', () => {
    expect(comparar(grav, vazio)).toMatchObject({ balanceada: 0.5, fracao: 0.5, elementosJulgados: 1 });
  });
  it('revelacao LONGA: clone parado no estado final nao passa de 0,5 (o topo pesa como as 100 paradas)', () => {
    const g = { amostras: Array.from({ length: 101 }, (_, i) => ({ y: i * P, b: { r: i < 1 ? st({ op: 0, vis: 0, vef: 0 }) : st() } })) };
    const c = g.amostras.map(() => ({ r: st() }));
    const r = comparar(g, c);
    expect(r.balanceada).toBe(0.5); expect(r.fracao).toBeGreaterThan(0.98); expect(r.elementosFieis80).toBe(0);
  });
  it('movimento SO no clone e erro, nao neutro', () => {
    const c = grav.amostras.map((s, i) => ({ 'u-rev': s.b['u-rev'], 'u-par': st({ x: i * 50 }) }));
    const r = comparar(grav, c);
    expect(r.movimentoSoNoClone).toBe(1); expect(r.notaMediaSoNoClone).toBeLessThanOrEqual(0.5); expect(r.elementosJulgados).toBe(2);
  });
  it('Astra r2: movimento que SO o clone tem nao passa como certo, em nenhum canal', () => {
    const est = (i) => ({ y: i * P, b: { e: st() } });
    const g = { amostras: Array.from({ length: 6 }, (_, i) => est(i)) };
    // css que o site nunca escreveu
    const alt = comparar(g, g.amostras.map((x, i) => ({ e: st({ css: { height: `${i * 10}px` } }) })));
    expect(alt.balanceada).toBeLessThanOrEqual(0.5); expect(alt.movimentoSoNoClone).toBe(1);
    // canvas que o site nao desenha, e o clone troca de quadro
    const tela = comparar(g, g.amostras.map((x, i) => ({ e: st({ quadro: `q${i}.avif` }) })));
    expect(tela.balanceada).toBeLessThanOrEqual(0.5);
    // parte de texto que so existe no clone, e se move
    const parte = comparar(g, g.amostras.map((x, i) => ({ e: st(), 'e--w0': st({ y: i * 20 }) })));
    expect(parte.elementosJulgados).toBe(1); expect(parte.balanceada).toBeLessThanOrEqual(0.5);
    // UMA parada de excursao entre cem
    const g101 = { amostras: Array.from({ length: 101 }, (_, i) => est(i)) };
    const exc = comparar(g101, g101.amostras.map((x, i) => ({ e: st({ x: i === 50 ? 40 : 0 }) })));
    expect(exc.balanceada).toBe(0.5); expect(exc.elementosFieis80).toBe(0);
  });
  it('controle: a gravacao contra ela mesma = 1, sem "movimento so no clone"', () => {
    const g = { amostras: [0, 1, 2, 3].map((i) => ({ y: i * P, b: { a: i < 2 ? undefined : st({ x: i }), b: st({ y: i * 5 }) } })) };
    g.amostras.forEach((x) => { if (x.b.a === undefined) delete x.b.a; });
    const r = comparar(g, g.amostras.map((x) => ({ ...x.b })));
    expect(r).toMatchObject({ balanceada: 1, movimentoSoNoClone: 0 });
  });
  it('texto em partes vale como UM elemento (media das partes)', () => {
    const g = { amostras: [0, 1, 2].map((i) => ({ y: i * P, b: { t: st(), 't--c0': st({ op: i ? 1 : 0, vis: i ? 1 : 0, vef: i ? 1 : 0 }), 't--c1': st({ op: i > 1 ? 1 : 0, vis: i > 1 ? 1 : 0, vef: i > 1 ? 1 : 0 }), 'u': st({ x: i }) } })) };
    const so_u = comparar(g, g.amostras.map((x) => ({ t: st(), u: x.b.u })));
    expect(so_u.porTipo).toMatchObject({ elementos: { n: 1, balanceada: 1 }, textosEmPartes: { n: 1, balanceada: 0 } });
    expect(so_u.balanceada).toBe(0.5);   // 2 donos (u e t), nao 3
  });
  it('display:none (null) e um estado: none -> bloco entra na nota', () => {
    const g = { amostras: [0, 1, 2, 3].map((i) => ({ y: i * P, b: { d: i < 2 ? null : st() } })) };
    expect(comparar(g, g.amostras.map((s) => ({ d: s.b.d }))).balanceada).toBe(1);
    expect(comparar(g, g.amostras.map(() => ({ d: st() }))).balanceada).toBe(0.5);
  });
  it('canvas: o quadro mostrado conta (parado no quadro errado perde)', () => {
    const g = { amostras: [0, 1, 2, 3].map((i) => ({ y: i * P, b: { c: st({ quadro: `f_${i}.avif` }) } })) };
    expect(comparar(g, g.amostras.map((s) => ({ c: s.b.c }))).quadrosCertos).toBe(4);
    const parado = comparar(g, g.amostras.map(() => ({ c: st({ quadro: 'f_0.avif' }) })));
    expect(parado.quadrosCertos).toBe(1); expect(parado.balanceada).toBe(0.5);
    expect(comparar(g, g.amostras.map(() => ({ c: st() }))).quadrosCertos).toBe(0);   // canvas em branco
  });
});

describe('difere: dois estados invisiveis sao o mesmo para quem ve', () => {
  it('escondidos com x e opacidade diferentes = iguais; escondido x visivel = diferente', () => {
    expect(difere(st({ vef: 0, vis: 0, x: 0, op: 0 }), st({ vef: 0, vis: 0, x: 300, op: 1 }))).toBe(false);
    expect(difere(st({ vef: 0, vis: 0 }), st())).toBe(true);
    expect(difere(st({ x: 0 }), st({ x: 300 }))).toBe(true);   // controle: visiveis com x diferente
  });
});

describe('medirProprio no Chromium: visibilidade PROPRIA x herdada', () => {
  let browser; let page;
  beforeAll(async () => {
    const { chromium } = await import('playwright-core');
    browser = await chromium.launch(); page = await browser.newPage();
    await page.setContent(`<div data-k="pai" style="visibility:hidden"><p data-k="herda">a</p><p data-k="volta" style="visibility:visible">b</p></div><div><p data-k="propria" style="visibility:hidden">c</p></div>`);
  }, 60000);
  afterAll(async () => { if (browser) await browser.close(); });
  it('so e "propria" quando o pai esta visivel; a efetiva e o que se ve', async () => {
    const m = await page.evaluate(medirProprio, 'data-k');
    expect([m.pai.vis, m.pai.vef]).toEqual([0, 0]);
    expect([m.herda.vis, m.herda.vef]).toEqual([1, 0]);     // herdada: fica com o pai
    expect([m.volta.vis, m.volta.vef]).toEqual([1, 1]);
    expect([m.propria.vis, m.propria.vef]).toEqual([0, 0]);
  });
});

describe('etiquetasQueSeMexem e conferirIds', () => {
  it('quem muda entre paradas ou entre as duas leituras; quem fica parado nao entra', () => {
    const am = [{ a: { p: st(), t: st({ op: 0.5 }) }, b: { p: st(), m: st({ x: 0 }), t: st() } }, { a: {}, b: { p: st(), m: st({ x: 9 }), t: st() } }];
    expect(etiquetasQueSeMexem(am).sort()).toEqual(['m', 't']);
  });
  it('recusa gemeos trocados (id faltando, sobrando ou com outra tag)', () => {
    expect(conferirIds([['u-a', 'div'], ['u-b', 'p']], [['u-a', 'div'], ['u-b', 'p'], ['nao-canonico', 'div']]).ok).toBe(true);
    expect(conferirIds([['u-a', 'div'], ['u-b', 'p']], [['u-a', 'div']])).toMatchObject({ ok: false, faltam: ['u-b'] });
    expect(conferirIds([['u-a', 'div']], [['u-a', 'span'], ['u-c', 'p']])).toMatchObject({ ok: false, sobram: ['u-c'], outraTag: ['u-a'] });
  });
});

describe('normalizar + mapasDaPagina no Chromium: texto dividido pelo site', () => {
  let browser; let page;
  const parte = 'position: relative; display: block;';
  const pal = 'position: relative; display: inline-block;';
  beforeAll(async () => {
    const { chromium } = await import('playwright-core');
    browser = await chromium.launch(); page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.setContent(`<html><head><style id="u-fontes"></style><style id="u-estilo"></style></head><body>
      <h2 id="h-uma" aria-label="Most fertilizers"><span class="l-mask" aria-hidden="true" style="overflow: clip; ${parte}"><span class="gsap_split_line" aria-hidden="true" style="${parte}">Most fertilizers</span></span></h2>
      <h3 id="h-niv" aria-label="Ab cd"><div aria-hidden="true" style="${parte}"><div aria-hidden="true" style="${pal}"><div aria-hidden="true" style="${pal}">A</div><div aria-hidden="true" style="${pal}">b</div></div> <div aria-hidden="true" style="${pal}"><div aria-hidden="true" style="${pal}">c</div><div aria-hidden="true" style="${pal}">d</div></div></div></h3>
      <a id="cta" href="#" aria-label="Talk to us"><span aria-hidden="true" class="btn-label">Talk to us</span></a>
    </body></html>`);
  }, 60000);
  afterAll(async () => { if (browser) await browser.close(); });
  it('linha UNICA dividida (mascara + linha) volta a ser texto inteiro; botao com rotulo acessivel nao', async () => {
    const r = await page.evaluate(normalizar);
    expect(r.corpo).toMatch(/<h2 id="[^"]+"[^>]*>Most fertilizers<\/h2>/);
    expect(r.corpo).toMatch(/<h3 id="[^"]+"[^>]*>Ab cd<\/h3>/);      // letras aninhadas: texto do aria-label, com o espaco
    expect(r.corpo).toMatch(/<span id="[^"]+"[^>]*>Talk to us<\/span>/);   // o span do botao continua elemento
  });
  it('partes do site por NIVEL (l/w/c), na ordem dentro de cada nivel', async () => {
    await page.evaluate(() => { let n = 0; for (const e of document.body.querySelectorAll('*')) e.setAttribute('data-u-rec', String(++n)); });
    const { mapaPartes } = await mapasDaPagina(page);
    const porTexto = await page.evaluate((mp) => Object.fromEntries(Object.entries(mp).map(([rec, k]) => [k, document.querySelector(`[data-u-rec="${rec}"]`).textContent])), mapaPartes);
    const doH3 = Object.fromEntries(Object.entries(porTexto).filter(([k]) => /--/.test(k) && k.startsWith(Object.keys(porTexto).find((x) => porTexto[x] === 'Ab cd').split('--')[0])));
    expect(Object.values(doH3)).toEqual(expect.arrayContaining(['Ab cd', 'Ab', 'cd', 'A', 'b', 'c', 'd']));
    const chaves = Object.keys(doH3).map((k) => k.split('--')[1]).sort();
    expect(chaves).toEqual(['c0', 'c1', 'c2', 'c3', 'l0', 'w0', 'w1']);
    expect(Object.entries(porTexto).find(([, t]) => t === 'Most fertilizers' && true)).toBeTruthy();
  });
  it('ids so do CORPO (os <style> do cabecalho nao entram)', async () => {
    const ids = await page.evaluate(idsDoCorpo);
    expect(ids.map(([i]) => i)).not.toContain('u-fontes');
    expect(ids.map(([i]) => i)).not.toContain('u-estilo');
  });
});

describe('ponta a ponta: os ids da gravacao sao os do clone renderizado (r4)', () => {
  let browser;
  afterAll(async () => { if (browser) await browser.close(); });
  it('normalizar -> renderizar o corpo como a canonica -> conferirIds ok', async () => {
    const { chromium } = await import('playwright-core');
    browser = await chromium.launch();
    const site = await browser.newPage();
    await site.setContent(`<html><head></head><body style="margin:0"><header><nav><a href="#">Home</a><a href="#">Blog</a></nav></header><main><section><h1 aria-label="Ab cd"><div aria-hidden="true" style="position: relative; display: block;">Ab cd</div></h1><p>Texto</p><div><div><img alt="x" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></div></div></section></main></body></html>`);
    const r = await site.evaluate(normalizar);
    const { ids } = await mapasDaPagina(site);
    const canon = await browser.newPage();
    // a canonica e escrita assim (normalizarCaptura): cabecalho com os dois <style> e um <body> nu
    await canon.setContent(`<!doctype html><html><head><style id="u-fontes">${r.fontes}</style><style id="u-estilo">${r.css}</style></head><body>${r.corpo}</body></html>`);
    const c = conferirIds(ids, await canon.evaluate(idsDoCorpo));
    expect(c).toMatchObject({ ok: true, faltam: [], sobram: [], outraTag: [] });
    expect(ids.length).toBeGreaterThan(5);
  });
});
