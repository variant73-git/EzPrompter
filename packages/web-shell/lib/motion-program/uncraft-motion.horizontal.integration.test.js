// Rolagem horizontal (medido no gsap.com: a secao fica PRESA na tela enquanto a faixa desliza para o
// lado, e gatilhos de dentro contam o deslizamento — no clone a secao passava reto e a tela ficava
// vazia). A estrutura ja traz o espaco que o site reservou para a fixacao (espacoReservado).
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
const PROGRAMA = { versao: 0, fichas: [
  // a faixa: presa na tela de 1000 a 3000 (o espaco ja esta na estrutura: o "espacador" de 2000 px)
  { id: 'm-faixa', linha: 'l-faixa', posicao: 0, alvo: '#u-faixa', motor: { tipo: 'rolagem', gatilho: '#u-secao', inicio: 1000, fim: '+=2000', arrasto: true, fixar: '#u-secao', espacoReservado: true }, de: { x: 0 }, para: { x: -2000 }, duracao: 1, curva: 'none' },
  // cartao de dentro: aparece quando chega a 50% da LARGURA durante o deslizamento
  { id: 'm-cartao', linha: 'l-cartao', posicao: 0, alvo: '#u-cartao', motor: { tipo: 'rolagem', gatilho: '#u-cartao', inicio: 'left 50%', fim: 'left 30%', arrasto: true, conteiner: 'l-faixa' }, de: { opacity: 0 }, para: { opacity: 1 }, duracao: 1, curva: 'none' },
  { id: 'm-ciclo', linha: 'l-a', posicao: 0, alvo: '#u-x', motor: { tipo: 'rolagem', conteiner: 'l-a' }, para: { x: 1 } },
  // AVULSA que conta o deslizamento da faixa (Astra: ficava presa a faixa velha depois de editar a faixa)
  { id: 'm-avulsa', alvo: '#u-cartao', motor: { tipo: 'rolagem', gatilho: '#u-cartao', inicio: 'left 50%', fim: 'left 30%', arrasto: true, conteiner: 'l-faixa' }, de: { y: 0 }, para: { y: 30 }, curva: 'none' },
] };
const SITE = `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0}#u-antes{height:1000px}#u-espacador{padding-bottom:2000px}#u-secao{height:800px;overflow:hidden;background:#111}#u-faixa{display:flex;width:4000px;height:800px}#u-faixa div{width:1000px;flex:none}#u-depois{height:2000px}</style></head>
<body><div id="u-antes"></div><div id="u-espacador"><section id="u-secao"><div id="u-faixa"><div></div><div></div><div id="u-cartao" style="background:#c33"></div><div></div></div></section></div><div id="u-depois"></div><div id="u-x"></div>
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
  browser = await chromium.launch(); page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  await page.goto(`http://127.0.0.1:${srv.address().port}/`, { waitUntil: 'load' }); await page.waitForTimeout(600);
}, 60000);
afterAll(async () => { if (browser) await browser.close(); if (srv) await new Promise((d) => srv.close(d)); });

const em = (y) => page.evaluate(async (v) => {
  window.scrollTo(0, v); await new Promise((r) => setTimeout(r, 300));
  const s = document.getElementById('u-secao').getBoundingClientRect();
  return { topoSecao: Math.round(s.top), x: Math.round(window.gsap.getProperty('#u-faixa', 'x')), op: Number(getComputedStyle(document.getElementById('u-cartao')).opacity).toFixed(2), altura: document.documentElement.scrollHeight };
}, y);

describe('rolagem horizontal', () => {
  it('a linha que conta o deslizamento monta; a que aponta para si mesma e recusada', async () => {
    const r = await page.evaluate(() => window.__uncraftMotion.relatorio());
    expect(r.montadas.sort()).toEqual(['m-avulsa', 'm-cartao', 'm-faixa']);
    expect(r.erros.map((e) => e.id)).toEqual(['m-ciclo']);
  });
  it('a secao fica PRESA na tela enquanto a faixa desliza, sem somar espaco a pagina', async () => {
    const a = await em(500); const b = await em(2000); const c = await em(3000);
    expect(a.topoSecao).toBe(500);                 // antes: rola normal
    expect(b.topoSecao).toBe(0); expect(b.x).toBe(-1000);   // no meio: presa, faixa na metade
    expect(c.topoSecao).toBe(0); expect(c.x).toBe(-2000);
    expect(b.altura).toBe(a.altura);               // espaco reservado pela estrutura, nao somado
    expect(a.altura).toBe(1000 + 800 + 2000 + 2000 + 0);
  });
  it('o cartao de dentro reage ao DESLIZAMENTO (a 50% da largura), nao a rolagem da pagina', async () => {
    // o cartao (3o painel, x=2000 na faixa) chega a 50% da largura quando a faixa anda 1500 px: y = 1000 + 1500
    expect((await em(2400)).op).toBe('0.00');
    expect(Number((await em(2700)).op)).toBeGreaterThan(0.9);
  });
});

describe('editar a faixa (conteiner) remonta quem depende dela, inclusive a avulsa', () => {
  it('depois de editar a faixa, o cartao e a avulsa seguem o deslizamento NOVO', async () => {
    const r = await page.evaluate(() => window.__uncraftMotion.aplicar('m-faixa', { para: { x: -3000 } }));
    expect(r.ok).toBe(true);
    // faixa -3000 em 2000 px de rolagem: o cartao (x=2000) chega a 50% (500 px) quando a faixa anda 1500 -> y = 1000 + 1000
    const em2 = async (y) => page.evaluate(async (v) => { window.scrollTo(0, v); await new Promise((q) => setTimeout(q, 300)); return { op: Number(getComputedStyle(document.getElementById('u-cartao')).opacity), y: Math.round(window.gsap.getProperty('#u-cartao', 'y')) }; }, y);
    expect((await em2(1900)).op).toBeLessThan(0.1);
    const d = await em2(2400);
    expect(d.op).toBeGreaterThan(0.9); expect(d.y).toBe(30);
  });
});

describe('a linha trilho nao pode sumir de baixo de quem depende dela', () => {
  it('renomear a faixa e recusado (o cartao e a avulsa perderiam o trilho); tudo segue montado', async () => {
    const r = await page.evaluate(() => window.__uncraftMotion.aplicar('m-faixa', { linha: 'l-faixa-2' }));
    expect(r.ok).toBe(false); expect(r.erro).toMatch(/conteiner inexistente/);
    const rel = await page.evaluate(() => window.__uncraftMotion.relatorio());
    expect(rel.montadas).toEqual(expect.arrayContaining(['m-faixa', 'm-cartao', 'm-avulsa']));
  });
});
