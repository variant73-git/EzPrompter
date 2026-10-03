// Linhas de tempo (caminho 2: o IX3 do Webflow declara linhas com varias acoes em posicoes):
// fichas com a mesma `linha` tocam num so gsap.timeline, cada uma na sua `posicao`; so `de` =
// from; `intervalo` como objeto; editar um membro remonta a linha e o outro membro continua.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const { chromium } = await import('playwright-core');
const RAIZ = process.cwd();
const ARQ = {
  '/gsap.min.js': path.join(RAIZ, 'node_modules/gsap/dist/gsap.min.js'),
  '/ScrollTrigger.min.js': path.join(RAIZ, 'node_modules/gsap/dist/ScrollTrigger.min.js'),
  '/uncraft-motion.js': path.join(RAIZ, 'lib/motion-program/uncraft-motion.js'),
};
const ROL = { tipo: 'rolagem', inicio: 0, fim: 1000, arrasto: true };
// linha DISPARADA que ainda nao comecou (gatilho bem abaixo): e ai que a pre-renderizacao aparece
const DISP = { tipo: 'rolagem', inicio: 2200, fim: 2300, arrasto: false };
const PROGRAMA = {
  versao: 0,
  fichas: [
    // a 2a so anda depois que a 1a termina: posicoes 0 e 1, duracao 1 cada
    { id: 'm-a', linha: 'l-um', posicao: 0, alvo: '#u-a', motor: ROL, de: { x: 0 }, para: { x: 100 }, duracao: 1, curva: 'none' },
    { id: 'm-b', linha: 'l-um', posicao: 1, alvo: '#u-b', motor: ROL, de: { x: 0 }, para: { x: 100 }, duracao: 1, curva: 'none' },
    { id: 'm-motor-errado', linha: 'l-um', posicao: 0, alvo: '#u-c', motor: { tipo: 'carga' }, para: { x: 5 } },
    // ficha AVULSA comecando no topo da pagina: `inicio: 0` e valido (antes virava 'top 80%')
    { id: 'm-zero', alvo: '#u-e', motor: ROL, de: { x: 0 }, para: { x: 100 }, curva: 'none' },
    // so `de` na rolagem: comeca em x=80 e chega ao estado ATUAL (0) no fim
    { id: 'm-de2', alvo: '#u-f', motor: ROL, de: { x: 80 }, curva: 'none' },
    // imediato: duas acoes na MESMA propriedade do mesmo alvo; sem `imediato:false` a 2a pre-renderiza
    // x=100 na montagem e o topo da pagina mostra o estado errado. A linha l-ctl e o CONTROLE (sem a
    // marca): prova que o cenario e sensivel.
    { id: 'm-i1', linha: 'l-imed', posicao: 0, alvo: '#u-g', motor: DISP, de: { x: 0 }, para: { x: 100 }, duracao: 1, curva: 'none' },
    { id: 'm-i2', linha: 'l-imed', posicao: 1, alvo: '#u-g', motor: DISP, de: { x: 100 }, para: { x: 200 }, duracao: 1, curva: 'none', imediato: false },
    { id: 'm-c1', linha: 'l-ctl', posicao: 0, alvo: '#u-h', motor: DISP, de: { x: 0 }, para: { x: 100 }, duracao: 1, curva: 'none' },
    { id: 'm-c2', linha: 'l-ctl', posicao: 1, alvo: '#u-h', motor: DISP, de: { x: 100 }, para: { x: 200 }, duracao: 1, curva: 'none' },
    // corte PARTILHADO: duas fichas dividem #u-txt em palavras; as partes levam etiqueta id--n
    { id: 'm-w1', alvo: '#u-txt', dividir: 'words', motor: { tipo: 'carga' }, para: { opacity: 1 }, duracao: 0.01 },
    { id: 'm-w2', alvo: '#u-txt', dividir: 'words', motor: { tipo: 'carga' }, para: { y: 0 }, duracao: 0.01 },
    // so `de`: vem de opacidade 0 ate o valor atual (1)
    { id: 'm-de', alvo: '#u-c', motor: { tipo: 'carga' }, de: { opacity: 0 }, duracao: 0.2 },
    // intervalo como objeto: o ultimo da lista comeca primeiro (de: 'end')
    { id: 'm-esc', alvo: ['#u-d1', '#u-d2', '#u-d3'], motor: { tipo: 'carga' }, para: { y: 50 }, duracao: 0.01, intervalo: { cada: 0.4, de: 'end' }, curva: 'none' },
  ],
};
const caixa = (id) => `<div id="${id}" style="width:20px;height:20px;background:#333"></div>`;
const SITE = `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0}main{height:3000px}</style></head>
<body><p id="u-txt">tres palavras aqui</p><div style="position:fixed;top:0">${['u-a', 'u-b', 'u-c', 'u-d1', 'u-d2', 'u-d3', 'u-e', 'u-f', 'u-g', 'u-h'].map(caixa).join('')}</div><main></main>
<script src="/gsap.min.js"></script><script src="/ScrollTrigger.min.js"></script>
<script type="application/json" id="uncraft-motion-programa">${JSON.stringify(PROGRAMA)}</script>
<script src="/uncraft-motion.js"></script></body></html>`;

let srv; let browser; let page;
beforeAll(async () => {
  srv = createServer(async (req, res) => {
    if (req.url === '/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(SITE); return; }
    const f = ARQ[req.url]; if (!f) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(await readFile(f));
  });
  await new Promise((d) => srv.listen(0, '127.0.0.1', d));
  browser = await chromium.launch(); page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.goto(`http://127.0.0.1:${srv.address().port}/`, { waitUntil: 'load' });
}, 60000);
afterAll(async () => { if (browser) await browser.close(); if (srv) await new Promise((d) => srv.close(d)); });

const xs = (y) => page.evaluate(async (v) => {
  window.scrollTo(0, v); await new Promise((r) => setTimeout(r, 300));
  const x = (id) => Math.round(window.gsap.getProperty('#' + id, 'x'));
  return [x('u-a'), x('u-b'), x('u-e')];
}, y);

describe('linhas de tempo', () => {
  it('intervalo como objeto: de "end" faz o ULTIMO comecar primeiro', async () => {
    // mede logo apos a carga: o 3o ja andou, o 1o ainda nao
    const ys = await page.evaluate(async () => { await new Promise((r) => setTimeout(r, 150)); return ['u-d1', 'u-d2', 'u-d3'].map((id) => Math.round(window.gsap.getProperty('#' + id, 'y'))); });
    expect(ys[2]).toBe(50); expect(ys[0]).toBe(0);
  });
  it('monta a linha e recusa o membro com motor diferente', async () => {
    const r = await page.evaluate(() => window.__uncraftMotion.relatorio());
    expect(r.montadas.sort()).toEqual(['m-a', 'm-b', 'm-c1', 'm-c2', 'm-de', 'm-de2', 'm-esc', 'm-i1', 'm-i2', 'm-w1', 'm-w2', 'm-zero']);
    expect(r.erros.map((e) => e.id)).toEqual(['m-motor-errado']);
  });
  it('as fichas da linha andam EM SEQUENCIA pela rolagem (posicao manda); a avulsa comeca no 0', async () => {
    expect(await xs(0)).toEqual([0, 0, 0]);
    expect(await xs(250)).toEqual([50, 0, 25]);
    expect(await xs(500)).toEqual([100, 0, 50]);
    expect(await xs(750)).toEqual([100, 50, 75]);
    expect(await xs(1000)).toEqual([100, 100, 100]);
  });
  it('so `de` na rolagem: COMECA no estado dado e chega ao atual', async () => {
    const x = (y) => page.evaluate(async (v) => { window.scrollTo(0, v); await new Promise((r) => setTimeout(r, 300)); return Math.round(window.gsap.getProperty('#u-f', 'x')); }, y);
    expect(await x(0)).toBe(80); expect(await x(500)).toBe(40); expect(await x(1000)).toBe(0);
  });
  it('imediato:false: o topo mostra o estado da 1a acao; o controle sem a marca mostra o da 2a', async () => {
    const r = await page.evaluate(async () => { window.scrollTo(0, 0); await new Promise((q) => setTimeout(q, 300)); return [Math.round(window.gsap.getProperty('#u-g', 'x')), Math.round(window.gsap.getProperty('#u-h', 'x'))]; });
    expect(r[1]).toBe(100);   // controle: o cenario E sensivel (sem a marca, a 2a acao vence no topo)
    expect(r[0]).toBe(0);
  });
  it('so `de`: termina no estado atual do elemento', async () => {
    const op = await page.evaluate(() => getComputedStyle(document.getElementById('u-c')).opacity);
    expect(op).toBe('1');
  });
  it('aplicar num membro remonta a linha; o outro membro continua', async () => {
    const r = await page.evaluate(() => window.__uncraftMotion.aplicar('m-a', { para: { x: 200 } }));
    expect(r.ok).toBe(true);
    expect(await xs(500)).toEqual([200, 0, 50]);
    expect(await xs(1000)).toEqual([200, 100, 100]);
    const rel = await page.evaluate(() => window.__uncraftMotion.relatorio());
    expect(rel.montadas.sort()).toEqual(['m-a', 'm-b', 'm-c1', 'm-c2', 'm-de', 'm-de2', 'm-esc', 'm-i1', 'm-i2', 'm-w1', 'm-w2', 'm-zero']);
  });
  it('editar o MOTOR de um membro vale para a linha inteira (o outro membro nao some)', async () => {
    const r = await page.evaluate(() => window.__uncraftMotion.aplicar('m-b', { motor: { fim: 2000 } }));
    expect(r.ok).toBe(true);
    const rel = await page.evaluate(() => window.__uncraftMotion.relatorio());
    expect(rel.montadas).toEqual(expect.arrayContaining(['m-a', 'm-b']));
    const m = await page.evaluate(() => window.__uncraftMotion.fichas().filter((f) => f.linha === 'l-um').map((f) => f.motor.fim));
    expect(m).toEqual([2000, 2000, 2000]);   // inclusive o membro que tinha motor errado: agora e o da linha
    expect(await xs(1000)).toEqual([200, 0, 100]);   // linha agora vai ate 2000: no 1000 so a 1a acao terminou
  });
  it('corte partilhado: as duas fichas animam as MESMAS partes, etiquetadas id--n', async () => {
    const r = await page.evaluate(() => Array.from(document.querySelectorAll('#u-txt [data-u-parte]')).map((e) => e.getAttribute('data-u-parte') + ':' + e.textContent));
    expect(r).toEqual(['u-txt--w0:tres', 'u-txt--w1:palavras', 'u-txt--w2:aqui']);
  });
  it('aplicar que deixaria OUTRA ficha invalida e recusado (mudar o corte de uma das duas)', async () => {
    const r = await page.evaluate(() => window.__uncraftMotion.aplicar('m-w1', { dividir: 'chars' }));
    expect(r.ok).toBe(false);
    expect(r.erro).toMatch(/m-w2/);
  });
  it('depois de propagar o motor, o membro antes invalido sai do relatorio de erros', async () => {
    const rel = await page.evaluate(() => window.__uncraftMotion.relatorio());
    expect(rel.erros.map((e) => e.id)).not.toContain('m-motor-errado');
    expect(rel.montadas).toContain('m-motor-errado');
  });
  it('linha que FALHA ao montar nao deixa texto cortado (transacional)', async () => {
    const r = await page.evaluate(() => {
      const M = window.__uncraftMotion; const tl = window.gsap.timeline;
      const p = document.createElement('p'); p.id = 'u-falha'; p.textContent = 'duas palavras'; document.body.appendChild(p);
      window.gsap.timeline = function () { throw new Error('quebrou'); };
      try { M.montar({ versao: 0, fichas: [{ id: 'm-f', linha: 'l-f', posicao: 0, alvo: '#u-falha', dividir: 'words', motor: { tipo: 'carga' }, para: { opacity: 1 } }] }); } finally { window.gsap.timeline = tl; }
      const rel = M.relatorio(); M.desmontar();
      return { spans: p.querySelectorAll('span').length, texto: p.textContent, corte: Boolean(p.__uncraftCorte), montadas: rel.montadas, erros: rel.erros.map((e) => e.id) };
    });
    expect(r).toEqual({ spans: 0, texto: 'duas palavras', corte: false, montadas: [], erros: ['m-f'] });
    await page.evaluate((prog) => window.__uncraftMotion.montar(prog), PROGRAMA);   // devolve o programa dos testes seguintes
  });
  it('desmontar desfaz a linha inteira', async () => {
    const x = await page.evaluate(() => { window.__uncraftMotion.desmontar(); return [window.gsap.getProperty('#u-a', 'x'), window.gsap.getProperty('#u-b', 'x')]; });
    expect(x).toEqual([0, 0]);
  });
});
