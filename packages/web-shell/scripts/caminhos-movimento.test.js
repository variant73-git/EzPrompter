// Unidade das tres pecas sem navegador: o gravador do caminho 1 (fichasPorLeitura), o das
// sequencias do caminho 3 (fichasDeSequencia) e a regua de trajetoria (comparar), com os
// controles que a revisao pediu: programa vazio NAO pode ganhar nota nas revelacoes.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fichasPorLeitura, difere, medirProprio } from './gravar-trajetoria.mjs';
import { fichasDeSequencia, etiquetasQueSeMexem, normalizar, mapasDaPagina, mapaDeRemotas, mapaDaCaptura, remotasNaPagina } from './normalizar-clone.mjs';
import { runtimeFetchShim } from '../lib/native-clone/runtime-fetch-map.js';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { comparar, conferirIds, idsDoCorpo } from './regua-trajetoria.mjs';
import { escolher } from './escolher-por-elemento.mjs';

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

describe('escolher por elemento (combinacao verificada)', () => {
  const declarado = { fichas: [
    { id: 'd1', linha: 'l', alvo: '#u-a', para: { x: 1 } }, { id: 'd2', linha: 'l', alvo: ['#u-b', '#u-c'], para: { x: 1 } },
    { id: 's1', tipo: 'sequencia', alvo: '#u-tela', imagens: ['q.avif'] } ] };
  const observado = { fichas: [{ id: 'o1', alvo: '#u-a', quadros: [] }, { id: 'o2', alvo: '#u-b', quadros: [] }, { id: 'o3', alvo: '#u-d', quadros: [] }, { id: 's1', tipo: 'sequencia', alvo: '#u-tela', imagens: ['q.avif'] }] };
  it('a LINHA inteira e a unidade: fica se, na media dos alvos, reproduz pelo menos tao bem (nunca pela metade)', () => {
    const ganha = escolher({ declarado, observado, notasDecl: { 'u-a': 0.9, 'u-b': 0.4, 'u-c': 0.9 }, notasObs: { 'u-a': 0.7, 'u-b': 0.8, 'u-c': 0.5, 'u-d': 0.8 } });
    expect(ganha.programa.fichas.map((f) => f.id).sort()).toEqual(['d1', 'd2', 'o3', 's1']);
    const perde = escolher({ declarado, observado, notasDecl: { 'u-a': 0.5, 'u-b': 0.4, 'u-c': 0.6 }, notasObs: { 'u-a': 0.7, 'u-b': 0.8, 'u-c': 0.5 } });
    expect(perde.programa.fichas.map((f) => f.id).sort()).toEqual(['o1', 'o2', 'o3', 's1']);
    expect(perde.relatorio).toMatchObject({ elementosDeclarados: 3, ficaramDeclarados: 0, voltaramParaObservacao: 3 });
  });
  it('empate (ninguem se move nas duas medidas) fica com o declarado', () => {
    const r = escolher({ declarado: { fichas: [{ id: 'd', alvo: '#u-x', para: { x: 1 } }] }, observado: { fichas: [] }, notasDecl: {}, notasObs: {} });
    expect(r.programa.fichas.map((f) => f.id)).toEqual(['d']);
  });
});

describe('normalizar: imagem cuja largura anima', () => {
  let browser;
  afterAll(async () => { if (browser) await browser.close(); });
  it('a altura da imagem NAO fica presa (acompanha a largura pela proporcao); altura imposta pelo site fica', async () => {
    const { chromium } = await import('playwright-core');
    browser = await chromium.launch(); const page = await browser.newPage();
    const gif = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"></svg>');
    await page.setContent(`<body><img id="livre" src="${gif}" style="width:100px"><img id="imposta" src="${gif}" style="width:100px;height:30px"></body>`);
    await page.waitForTimeout(200);
    const r = await page.evaluate(normalizar);
    const regras = r.css.match(/#u-[\w-]*-img-[\w-]*\{[^}]*\}/g) || [];
    expect(regras.length).toBe(2);
    expect(regras[0]).toMatch(/width:100px/); expect(regras[0]).not.toMatch(/height:/);   // livre: altura pela proporcao
    expect(regras[1]).toMatch(/width:100px/); expect(regras[1]).toMatch(/height:30px/);   // imposta pelo site: fica
  });
});

describe('normalizar: cores que seguem a cor do texto', () => {
  let browser;
  afterAll(async () => { if (browser) await browser.close(); });
  it('borda/preenchimento que so repetem `color` NAO sao gravados (seguem a animacao de cor); cor propria e gravada', async () => {
    const { chromium } = await import('playwright-core');
    browser = await chromium.launch(); const page = await browser.newPage();
    await page.setContent('<body><p id="a" style="color:rgb(10, 20, 30);border:1px solid">segue</p><p id="b" style="color:rgb(10, 20, 30);border:1px solid rgb(200, 0, 0);-webkit-text-fill-color:rgb(0, 200, 0)">propria</p><p id="c" style="color:rgb(0, 128, 0);border:1px solid rgb(0, 128, 0)">igual mas propria</p><p id="d" style="color:rgb(1, 2, 3);border:1px solid rgb(1, 2, 3)">colide sentinela</p></body>');
    const r = await page.evaluate(normalizar);
    const regras = r.css.match(/#u-[\w-]*-p-[\w-]*\{[^}]*\}/g) || [];
    expect(regras.length).toBe(4);
    expect(regras[3]).toMatch(/border-top-color:rgb\(1, 2, 3\)/);   // Astra r2: cor igual a sentinela
    // Astra: borda com a MESMA cor do texto, mas declarada — continua gravada (nao segue a animacao de cor)
    expect(regras[2]).toMatch(/border-top-color:rgb\(0, 128, 0\)/);
    expect(regras[0]).toMatch(/color:rgb\(10, 20, 30\)/); expect(regras[0]).not.toMatch(/border-top-color|text-fill-color/);
    expect(regras[1]).toMatch(/border-top-color:rgb\(200, 0, 0\)/); expect(regras[1]).toMatch(/-webkit-text-fill-color:rgb\(0, 200, 0\)/);
  });
  it('Astra r3: com TRANSICAO de cor no elemento, a sondagem ainda reconhece quem segue `color` e nao deixa transicao correndo', async () => {
    const { chromium } = await import('playwright-core');
    const b = await chromium.launch(); const page = await b.newPage();
    try {
      await page.setContent('<body><p id="t" style="color:rgb(10, 20, 30);border:1px solid;transition:color 5s, border-color 5s, -webkit-text-fill-color 5s">segue com transicao</p></body>');
      const r = await page.evaluate(normalizar);
      const regra = (r.css.match(/#u-[\w-]*-p-[\w-]*\{[^}]*\}/g) || [])[0] || '';
      expect(regra).toMatch(/color:rgb\(10, 20, 30\)/);
      expect(regra).not.toMatch(/border-top-color|text-fill-color/);
      const vivo = await page.evaluate(() => { const el = document.querySelector('p'); return { anim: el.getAnimations().length, cor: getComputedStyle(el).color, borda: getComputedStyle(el).borderTopColor, trans: el.style.transition }; });
      expect(vivo).toEqual({ anim: 0, cor: 'rgb(10, 20, 30)', borda: 'rgb(10, 20, 30)', trans: 'color 5s, border-color 5s, -webkit-text-fill-color 5s' });
    } finally { await b.close(); }
  });
  it('Astra r4: transicao de cor EM ANDAMENTO nao e cancelada pela sondagem (sem sondar, a cor fica gravada como esta)', async () => {
    const { chromium } = await import('playwright-core');
    const b = await chromium.launch(); const page = await b.newPage();
    try {
      await page.setContent('<body><p id="t" style="color:rgb(0, 0, 0);border:1px solid;transition:color 20s linear">em andamento</p></body>');
      await page.evaluate(() => { const el = document.querySelector('p'); getComputedStyle(el).color; el.style.color = 'rgb(200, 200, 200)'; getComputedStyle(el).color; });
      await page.waitForTimeout(300);
      const r = await page.evaluate(normalizar);
      const vivo = await page.evaluate(() => { const el = document.querySelector('p'); const a = el.getAnimations(); return { anim: a.length, estado: a[0] && a[0].playState, cor: getComputedStyle(el).color }; });
      expect(vivo.anim).toBe(1); expect(vivo.estado).toBe('running');
      expect(vivo.cor).not.toBe('rgb(200, 200, 200)'); expect(vivo.cor).not.toBe('rgb(0, 0, 0)');
      const regra = (r.css.match(/#u-[\w-]*-p-[\w-]*\{[^}]*\}/g) || [])[0] || '';
      expect(regra).not.toMatch(/color:rgb\(200, 200, 200\)/);   // nao le o ALVO da transicao cancelada
    } finally { await b.close(); }
  });
});

describe('normalizar: auto declarado', () => {
  let browser;
  afterAll(async () => { if (browser) await browser.close(); });
  it('absoluto com top/left auto NAO ganha posicao em px; margem auto que centraliza continua auto; valor proprio fica', async () => {
    const { chromium } = await import('playwright-core');
    browser = await chromium.launch(); const page = await browser.newPage();
    await page.setContent('<body><div style="position:relative;height:200px"><p style="position:absolute;width:300px;margin:0">bloco solto aqui</p><p style="position:absolute;top:7px;left:9px;width:300px;margin:0">bloco preso aqui</p></div><section style="width:300px;margin:0 auto;height:20px"></section></body>');
    const r = await page.evaluate(normalizar);
    const solto = (r.css.match(/#u-[\w-]*-p-bloco-solto[\w-]*\{[^}]*\}/) || [''])[0]; const preso = (r.css.match(/#u-[\w-]*-p-bloco-preso[\w-]*\{[^}]*\}/) || [''])[0];
    const secao = (r.css.match(/#u-[\w-]*-section-[\w-]*\{[^}]*\}/) || [''])[0];
    expect(solto).toMatch(/position:absolute/); expect(solto).not.toMatch(/(^|[;{])(top|left|right|bottom):/);
    expect(preso).toMatch(/top:7px/); expect(preso).toMatch(/left:9px/);
    expect(secao).toMatch(/margin-left:auto/); expect(secao).toMatch(/margin-right:auto/);
  });
});

// Teste as cegas no Framer (2026-10-04): quatro classes GERAIS da estrutura. Cada caso normaliza um
// site minimo, RENDERIZA a canonica numa pagina limpa e confere o que o visitante veria.
describe('normalizar: classes gerais achadas no teste as cegas (Framer)', () => {
  let browser;
  beforeAll(async () => { const { chromium } = await import('playwright-core'); browser = await chromium.launch(); });
  afterAll(async () => { if (browser) await browser.close(); });
  const canonica = async (siteHtml, ler, opcoes = {}) => {
    const site = await browser.newPage(); await site.setContent(siteHtml); const r = await site.evaluate(normalizar, opcoes); await site.close();
    const canon = await browser.newPage();
    await canon.setContent(`<!doctype html><html><head><style id="u-fontes">${r.fontes}</style><style id="u-estilo">${r.css}</style></head><body>${r.corpo}</body></html>`);
    try { return await canon.evaluate(ler); } finally { await canon.close(); }
  };
  it('link com a cor e o sublinhado do SITE, nao os padroes do navegador (o padrao do <a> e medido COM endereco)', async () => {
    const v = await canonica('<body style="color:rgb(10, 20, 30)"><p>texto <a href="/x" style="color:inherit;text-decoration:none">link</a></p></body>', () => {
      const a = document.querySelector('a'); const cs = getComputedStyle(a); return { cor: cs.color, sub: cs.textDecorationLine };
    });
    expect(v).toEqual({ cor: 'rgb(10, 20, 30)', sub: 'none' });
  });
  it('link que herda a cor do pai continua SEGUINDO o pai na canonica (cor do pai animada -> link acompanha)', async () => {
    const v = await canonica('<body style="color:rgb(10, 20, 30)"><p>texto <a href="/x" style="color:inherit">link</a></p></body>', () => {
      const p = document.querySelector('p'); p.style.color = 'rgb(200, 0, 0)'; return getComputedStyle(document.querySelector('a')).color;
    });
    expect(v).toBe('rgb(200, 0, 0)');
  });
  it('propriedade herdavel que o navegador NAO herda naquela tag (h1 font-size: inherit) e gravada', async () => {
    const v = await canonica('<body><div style="font-size:20px"><h1 style="font-size:inherit;font-weight:inherit;margin:0">Titulo</h1></div></body>', () => {
      const h = getComputedStyle(document.querySelector('h1')); return { tam: h.fontSize, peso: h.fontWeight };
    });
    expect(v).toEqual({ tam: '20px', peso: '400' });
  });
  it('contorno desenhado por ::after com border-radius: inherit continua arredondado', async () => {
    const v = await canonica('<head><style>a::after{content:"";position:absolute;inset:0;border:1px solid rgb(200, 0, 0);border-radius:inherit}</style></head><body><a href="#" style="position:relative;display:inline-block;border-radius:20px;padding:10px">botao</a></body>', () => getComputedStyle(document.querySelector('a'), '::after').borderTopLeftRadius);
    expect(v).toBe('20px');
  });
  it('borda PRETA num elemento de texto AZUL continua preta (o padrao "currentcolor" medido em outro contexto tambem e preto, e igual nao e o mesmo) — elemento e ::after', async () => {
    const v = await canonica('<head><style>a::after{content:"";position:absolute;inset:0;border:1px solid rgb(0, 0, 0)}</style></head><body><a href="#" style="position:relative;display:inline-block;color:rgb(0, 0, 238);padding:10px">x</a><div style="color:rgb(0, 0, 238);border:1px solid rgb(0, 0, 0)">y</div></body>', () => ({
      pseudo: getComputedStyle(document.querySelector('a'), '::after').borderTopColor, el: getComputedStyle(document.querySelector('div')).borderTopColor,
    }));
    expect(v).toEqual({ pseudo: 'rgb(0, 0, 0)', el: 'rgb(0, 0, 0)' });
  });
  it('Astra r1 #1: cor do link IGUAL a do pai mas FIXA nao vira inherit (o pai muda, o link fica)', async () => {
    const v = await canonica('<body><p style="color:rgb(10, 20, 30)">texto <a href="/x" style="color:rgb(10, 20, 30)">link</a></p></body>', () => {
      document.querySelector('p').style.color = 'rgb(200, 0, 0)'; return getComputedStyle(document.querySelector('a')).color;
    });
    expect(v).toBe('rgb(10, 20, 30)');
  });
  it('Astra r1 #2: ancora para um elemento cujo invólucro e DESFEITO continua achando o alvo', async () => {
    const v = await canonica('<body><a href="#sec">ir</a><div id="sec"><div>alvo aqui</div></div></body>', () => {
      const k = document.querySelector('a').getAttribute('href').slice(1); const e = document.getElementById(k); return e ? e.textContent.trim() : null;
    });
    expect(v).toBe('alvo aqui');
  });
  it('Astra r1 #3: texto VISIVEL que parece referencia ou endereco nao e reescrito', async () => {
    const v = await canonica('<body><p id="fim">veja href="#fim" e url(#fim) e https://cdn.test/a.png</p><img alt="https://cdn.test/a.png" src="https://cdn.test/a.png"></body>', () => ({
      texto: document.querySelector('p').textContent, alt: document.querySelector('img').getAttribute('alt'), src: document.querySelector('img').getAttribute('src'),
    }), { remotas: { 'https://cdn.test/a.png': '_ext/cdn.test/a.png' } });
    expect(v).toEqual({ texto: 'veja href="#fim" e url(#fim) e https://cdn.test/a.png', alt: 'https://cdn.test/a.png', src: '_ext/cdn.test/a.png' });
  });
  it('imagem com atributo height="800" e CSS height:100% num quadro de 215 px: a canonica mantem 215 (o atributo nao pode voltar a valer)', async () => {
    const gif = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
    const v = await canonica(`<body><div style="position:relative;width:382px;height:215px;overflow:hidden"><div style="position:absolute;inset:0"><img src="${gif}" width="1420" height="800" style="display:block;width:100%;height:100%;object-fit:cover"></div></div></body>`, () => Math.round(document.querySelector('img').getBoundingClientRect().height));
    expect(v).toBe(215);
  });
  it('logo desenhado por MASCARA (bloco branco recortado pelo SVG) mantem a mascara — sem ela vira um retangulo branco', async () => {
    const svg = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'%3E%3Ccircle cx='5' cy='5' r='5'/%3E%3C/svg%3E";
    const v = await canonica(`<body><div style="width:40px;height:40px;background-color:rgb(255, 255, 255);-webkit-mask-image:url(&quot;${svg}&quot;);mask-image:url(&quot;${svg}&quot;);mask-size:contain;mask-repeat:no-repeat"></div></body>`, () => {
      const cs = getComputedStyle(document.querySelector('div')); return { mask: cs.maskImage !== 'none', size: cs.maskSize, rep: cs.maskRepeat };
    });
    expect(v).toEqual({ mask: true, size: 'contain', rep: 'no-repeat' });
  });
  it('Astra r4: endereco local guarda o FRAGMENTO (mascara masks.svg#logo, link /sobre#equipe)', async () => {
    const site = await browser.newPage();
    await site.route('http://u.test/**', (r) => r.fulfill({ contentType: 'text/html', body: '<body><div style="width:10px;height:10px;mask-image:url(/masks.svg#logo);background-image:url(/bg.svg#a)"></div><a href="/sobre#equipe">sobre</a></body>' }));
    await site.goto('http://u.test/'); const r = await site.evaluate(normalizar); await site.close();
    expect(r.css).toContain('url("masks.svg#logo")'); expect(r.css).toContain('url("bg.svg#a")');
    expect(r.corpo).toContain('href="sobre#equipe"');
  });
  it('Astra r5: MASCARA remota capturada entra no mapa e sai local com o fragmento', async () => {
    const site = await browser.newPage();
    await site.route('http://u.test/**', (r) => r.fulfill({ contentType: 'text/html', body: '<body><div style="width:10px;height:10px;mask-image:url(https://cdn.test/m.svg#logo)"></div></body>' }));
    await site.route('https://cdn.test/**', (r) => r.abort());
    await site.goto('http://u.test/');
    const remotas = mapaDeRemotas(await site.evaluate(remotasNaPagina), { 'https://cdn.test/m.svg': '_ext/cdn.test/m.svg' });
    const r = await site.evaluate(normalizar, { remotas }); await site.close();
    expect(r.css).toContain('url("_ext/cdn.test/m.svg#logo")'); expect(r.arquivos).toContain('_ext/cdn.test/m.svg');
  });
  it('icone por <use href="#id"> continua achando o desenho (o id original nao pode ser trocado sem levar a referencia)', async () => {
    const v = await canonica('<body><svg id="ic" width="10" height="10" viewBox="0 0 10 10"><rect width="10" height="10" fill="red"></rect></svg><div style="width:20px;height:20px"><svg style="width:100%;height:100%" viewBox="0 0 10 10"><use href="#ic"></use></svg></div><a href="#fim">ir</a><section id="fim">fim</section></body>', () => {
      const u = document.querySelector('use'); const alvo = document.getElementById(u.getAttribute('href').slice(1));
      const ancora = document.querySelector('a').getAttribute('href').slice(1);
      return { icone: Boolean(alvo) && alvo.tagName.toLowerCase() === 'svg', ancora: Boolean(document.getElementById(ancora)) && document.getElementById(ancora).textContent.trim() };
    });
    expect(v).toEqual({ icone: true, ancora: 'fim' });
  });
  it('preenchimento herdado de SVG (fill no conteiner) e a aparencia de campo (appearance: none) sobrevivem', async () => {
    const v = await canonica('<body><div style="fill:rgb(255, 255, 255)"><svg width="10" height="10"><rect width="10" height="10"></rect></svg></div><select style="appearance:none;border:0;background:rgb(238, 238, 238)"><option>a</option></select></body>', () => ({
      fill: getComputedStyle(document.querySelector('rect')).fill, apar: getComputedStyle(document.querySelector('select')).appearance,
    }));
    expect(v).toEqual({ fill: 'rgb(255, 255, 255)', apar: 'none' });
  });
});

describe('mapaDaCaptura + mapaDeRemotas: endereco remoto -> arquivo, pelo MAPA que a captura gravou', () => {
  it('le o mapa caminho->URL que o produtor embute na pagina; enderecos que COLIDEM no nome vao cada um para o SEU arquivo (Astra r2)', () => {
    const alheias = { '_ext/cdn.test/a_20b.png': 'https://cdn.test/a%20b.png', '_ext/cdn.test/a_20b.k3j9.png': 'https://cdn.test/a_20b.png', '_ext/framerusercontent.com/images/x.1234abcd.png': 'https://framerusercontent.com/images/x.png?width=191&height=52' };
    const html = `<html><head><script>${runtimeFetchShim({}, { origensAlheias: alheias, origemFonte: 'https://site.test' })}</script></head><body></body></html>`;
    const porUrl = mapaDaCaptura(html);
    expect(mapaDeRemotas(['https://cdn.test/a%20b.png', 'https://cdn.test/a_20b.png', 'https://framerusercontent.com/images/x.png?width=191&height=52', 'https://twitter.com/x'], porUrl)).toEqual({
      'https://cdn.test/a%20b.png': '_ext/cdn.test/a_20b.png', 'https://cdn.test/a_20b.png': '_ext/cdn.test/a_20b.k3j9.png', 'https://framerusercontent.com/images/x.png?width=191&height=52': '_ext/framerusercontent.com/images/x.1234abcd.png',
    });
    expect(Object.keys(mapaDaCaptura('<html><body>sem remendo</body></html>'))).toEqual([]);
  });
});

// landonorris (2026-10-04): o FUNDO DA PAGINA (cor do <body>) muda com a rolagem — escuro -> bege. A
// observacao so gravava cor quando o site a escrevia no style do elemento, e o <body> nem era acompanhado.
describe('observacao: cor de fundo calculada e o <body> acompanhado', () => {
  it('cor de fundo que muda com a rolagem vira ficha de rolagem com backgroundColor (e o <body> mira #u-pagina)', () => {
    const am = [0, 1, 2, 3].map((i) => ({ y: i * 100, a: { pagina: st({ bg: i < 2 ? 'rgb(40, 44, 32)' : 'rgb(217, 217, 210)', cor: 'rgb(0, 0, 0)' }) }, b: { pagina: st({ bg: i < 2 ? 'rgb(40, 44, 32)' : 'rgb(217, 217, 210)', cor: 'rgb(0, 0, 0)' }) } }));
    const { fichas } = fichasPorLeitura({ amostras: am, mapa: { pagina: 'u-pagina' } }, 100);
    expect(fichas.length).toBe(1); expect(fichas[0].alvo).toBe('#u-pagina');
    const ultimo = fichas[0].quadros ? fichas[0].quadros[fichas[0].quadros.length - 1] : fichas[0].para;
    expect(ultimo.backgroundColor).toBe('rgb(217, 217, 210)'); expect(ultimo).not.toHaveProperty('color');
  });
  it('difere enxerga a cor de fundo; estado antigo sem o campo nao inventa mudanca', () => {
    expect(difere(st({ bg: 'rgb(1, 1, 1)' }), st({ bg: 'rgb(2, 2, 2)' }))).toBe(true);
    expect(difere(st(), st({ bg: 'rgb(2, 2, 2)' }))).toBe(false);
  });
  it('medirProprio le a cor de fundo de todos e a cor do texto SO do <body> (raiz da heranca)', async () => {
    const { chromium } = await import('playwright-core'); const b = await chromium.launch(); const page = await b.newPage();
    try {
      await page.setContent('<body data-k="pg" style="background:rgb(40, 44, 32);color:rgb(9, 9, 9)"><p data-k="p" style="background:rgb(1, 2, 3)">x</p></body>');
      const m = await page.evaluate(medirProprio, 'data-k');
      expect(m.pg.bg).toBe('rgb(40, 44, 32)'); expect(m.pg.cor).toBe('rgb(9, 9, 9)');
      expect(m.p.bg).toBe('rgb(1, 2, 3)'); expect(m.p.cor).toBeUndefined();
    } finally { await b.close(); }
  });
});

describe('regua: conferencia de gemeos dispensa SO definicao pura (sem area E sem <use> que a use) que sobra de UM lado', () => {
  it('coletores marcam definicao pura; svg zerado mas USADO por <use> nao e definicao pura', async () => {
    const { chromium } = await import('playwright-core'); const b = await chromium.launch(); const page = await b.newPage();
    try {
      await page.setContent('<body><div id="u-c"><svg id="u-def" style="width:0;height:0" viewBox="0 0 9 9"><path d="M0 0h9v9z"></path></svg><svg id="u-usada" style="width:0;height:0" viewBox="0 0 9 9"><path d="M0 0h9v9z"></path></svg><svg id="u-ico" width="10" height="10"><use href="#u-usada"></use></svg></div></body>');
      expect(await page.evaluate(idsDoCorpo)).toEqual([['u-c', 'div', false], ['u-def', 'svg', true], ['u-usada', 'svg', false], ['u-ico', 'svg', false]]);
      await page.evaluate(() => { for (const [i, e] of [...document.body.querySelectorAll('[id]')].entries()) { e.setAttribute('data-u-id', e.id); e.setAttribute('data-u-rec', String(i)); } });
      expect((await mapasDaPagina(page)).ids).toEqual([['u-c', 'div', false], ['u-def', 'svg', true], ['u-usada', 'svg', false], ['u-ico', 'svg', false]]);
    } finally { await b.close(); }
  });
  it('comuns casam independente de area; so a definicao PURA que sobra de um lado e dispensada', () => {
    expect(conferirIds([['u-a', 'div', false], ['u-ico', 'svg', true]], [['u-a', 'div', false], ['u-ico', 'svg', false]]).ok).toBe(true);   // zerado so de um lado: casa
    expect(conferirIds([['u-a', 'div', false]], [['u-a', 'div', false], ['u-def', 'svg', true]]).ok).toBe(true);    // definicao pura so no clone
    expect(conferirIds([['u-a', 'div', false], ['u-def', 'svg', true]], [['u-a', 'div', false]]).ok).toBe(true);    // definicao pura so na referencia
    expect(conferirIds([['u-a', 'div', false]], [['u-a', 'div', false], ['u-usada', 'svg', false]])).toMatchObject({ ok: false, sobram: ['u-usada'] });   // usada: conta
    expect(conferirIds([['u-a', 'div'], ['u-x', 'svg']], [['u-a', 'div']])).toMatchObject({ ok: false, faltam: ['u-x'] });   // gravacao antiga (sem marca): conta
  });
});
