// @vitest-environment node
// Alças e guias da cópia editável em navegador REAL (Chromium, playwright-core): layout de verdade, mouse de verdade.
// A própria página faz o papel do editor de fora (como nos testes jsdom), mas a confirmação usa as MESMAS funções
// do editor de fora (`buildOverlayBatch` + `createTransaction`). Spec 2026-10-20 §8; um caso por achado do Astra e
// por linha do Review Focus do plano (docs/superpowers/plans/2026-10-20-alcas-e-guias.md, Task 11).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { getRuntimeBridgeSource } from './runtime-bridge-source.js';
import { buildOverlayBatch } from './overlay-batch.js';
import { createTransaction } from './transaction.js';

vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 });

const GSAP = path.resolve(process.cwd(), 'node_modules/gsap/dist/gsap.min.js');
const paginas = new Map();
let srv; let porta; let browser;
beforeAll(async () => {
  srv = createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/gsap.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(await readFile(GSAP)); return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(paginas.get(u.pathname.slice(1)) || '<!doctype html><html><body></body></html>');
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok)); porta = srv.address().port;
  const { chromium } = await import('playwright-core'); browser = await chromium.launch();
});
afterAll(async () => { await browser?.close(); await new Promise((ok) => srv.close(ok)); });

// Liga a ponte e fala com ela pelo protocolo v2, como o editor de fora
const HARNESS = `window.__H = (() => {
  const V1 = 'uncraft-motion-editor/v1', V2 = 'uncraft-motion-editor/v2';
  const NONCE = 'nonce-alcas-123456', BUNDLE = 'bundle-alcas', SESSION = 'session-alcas', ORIGIN = 'https://app.uncraft.test';
  const messages = []; let generation = null; let seq = 0;
  const config = document.createElement('script');
  config.type = 'application/json'; config.dataset.uncraftRuntimeConfig = 'true';
  config.textContent = JSON.stringify({ initialManifest: { schemaVersion: 2, baseBundleId: BUNDLE, transactions: [] },
    runtimeSessionId: SESSION, runtimeFingerprint: 'sha256:alcas', sessionNonce: NONCE });
  document.head.appendChild(config);
  window.postMessage = (m) => messages.push(JSON.parse(JSON.stringify(m)));
  window.eval(window.__BRIDGE_SRC);
  generation = messages.filter((m) => m.type === 'runtime-ready').pop().payload.runtimeGeneration;
  const enviar = (protocol, type, payload) => {
    const mark = messages.length;
    window.dispatchEvent(new MessageEvent('message', { source: window, origin: ORIGIN, data: {
      protocol, protocolVersion: protocol, supportedProtocols: [V2, V1], source: 'host', type,
      sessionNonce: NONCE, requestId: 'alcas-' + (seq += 1), runtimeGeneration: generation,
      bundleId: BUNDLE, sessionId: SESSION, payload } }));
    return messages.slice(mark);
  };
  enviar(V1, 'negotiate-protocol', { selectedProtocol: V2 });
  return {
    send: (type, payload) => enviar(V2, type, payload),
    ultimo: (type) => { const m = messages.filter((x) => x.type === type).pop(); return m ? m.payload : null; },
    todos: (type) => messages.filter((x) => x.type === type).map((x) => x.payload),
    tudo: () => JSON.stringify(messages),
  };
})();`;

const abertas = [];
afterEach(async () => { while (abertas.length) await abertas.pop().close(); });
async function abrir(corpo, { head = '', viewport = { width: 1000, height: 700 } } = {}) {
  const nome = `p${paginas.size + 1}`;
  paginas.set(nome, `<!doctype html><html><head><style>body{margin:0;padding:40px;font:16px sans-serif}</style>${head}</head><body>${corpo}</body></html>`);
  const p = await browser.newPage({ viewport });
  abertas.push(p);
  p.erros = [];
  p.on('pageerror', (e) => p.erros.push(String(e && e.message || e)));
  await p.goto(`http://127.0.0.1:${porta}/${nome}`);
  await p.evaluate((src) => { window.__BRIDGE_SRC = src; }, getRuntimeBridgeSource());
  await p.evaluate(HARNESS);
  return p;
}
const selecionar = (p, elementId) => p.evaluate((id) => window.__H.send('select-element', { elementId: id }), elementId);
const ultimo = (p, tipo) => p.evaluate((t) => window.__H.ultimo(t), tipo);
const todos = (p, tipo) => p.evaluate((t) => window.__H.todos(t), tipo);
const estado = (p) => p.evaluate(() => window.__uncraftMotionBridge.overlay.estado());
const retangulo = (p, qual, arg) => p.evaluate(([q, a]) => {
  const g = window.__uncraftMotionBridge.overlay;
  const n = q === 'alca' ? g.alcaParaTeste(a) : q === 'guia' ? g.guiaParaTeste(a) : q === 'rotulo' ? g.rotuloParaTeste() : q === 'caixa' ? g.caixaParaTeste() : document.getElementById(a);
  const r = n.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
}, [qual, arg]);
const largura = (p, id) => p.evaluate((i) => document.getElementById(i).getBoundingClientRect().width, id);
const quadro = (p) => p.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))));
async function arrastar(p, ponto, dx, dy, { soltar = true } = {}) {
  await p.mouse.move(ponto.x, ponto.y);
  await p.mouse.down();
  await p.mouse.move(ponto.x + dx, ponto.y + dy, { steps: 6 });
  if (soltar) await p.mouse.up();
}
// o editor de fora: o mesmo montador de lote e a mesma transação do controller
async function confirmar(p) {
  const fim = await ultimo(p, 'overlay-gesture-ended');
  const lote = buildOverlayBatch({ manifest: null, deviceId: 'desktop', changes: fim.changes, descriptorFor: () => null });
  const transaction = createTransaction({ patches: lote.patches, source: 'overlay' });
  const resp = await p.evaluate(([t, g]) => window.__H.send('apply-transaction', { transaction: t, gestureId: g }), [transaction, fim.gestureId]);
  return { fim, transaction, resp };
}
const caixa = (id, estilo) => `<div id="${id}" data-uncraft-id="u-${id}" style="${estilo}">${id.toUpperCase()}</div>`;

describe('alças e guias — navegador real', () => {
  it('r1 #1: soltar deixa a largura NOVA na tela durante a espera; a confirmação grava com o antes do gesto', async () => {
    const p = await abrir(caixa('a', 'width:200px;height:100px;background:#ccc'));
    await selecionar(p, 'u-a');
    await arrastar(p, await retangulo(p, 'alca', 'e'), 60, 0);
    expect(await largura(p, 'a')).toBe(260);
    const { resp } = await confirmar(p);
    const ok = resp.find((m) => m.type === 'transaction-committed');
    expect(ok.payload.transaction.patches.find((x) => x.property === 'width').before).toBe('200px');
    expect(await largura(p, 'a')).toBe(260);
  });

  it('r1 #2: width:100px + max-width:100px → arrastar para 150 é aceito', async () => {
    const p = await abrir(caixa('a', 'width:100px;max-width:100px;height:60px;background:#ccc'));
    await selecionar(p, 'u-a');
    await arrastar(p, await retangulo(p, 'alca', 'e'), 50, 0);
    const fim = await ultimo(p, 'overlay-gesture-ended');
    expect(fim.changes.find((c) => c.property === 'width').value).toBe('150px');
    const { resp } = await confirmar(p);
    expect(resp.some((m) => m.type === 'transaction-committed')).toBe(true);
    expect(await largura(p, 'a')).toBe(150);
  });

  it('r1 #4: guia de gap grava no PAI e a seleção continua no filho', async () => {
    const p = await abrir(`<main id="m" data-uncraft-id="u-m" style="display:flex;column-gap:40px">${caixa('a', 'width:200px;height:100px;background:#ccc')}${caixa('b', 'width:100px;height:100px;background:#ddd')}</main>`);
    await selecionar(p, 'u-a');
    // longe da alça leste (que fica no meio da borda direita, em cima do vão)
    const vao = await retangulo(p, 'guia', 'gap');
    await arrastar(p, { x: vao.x, y: vao.top + 10 }, 12, 0);
    const fim = await ultimo(p, 'overlay-gesture-ended');
    expect(fim.changes.map((c) => [c.elementId, c.property])).toEqual([['u-m', 'column-gap']]);
    expect(parseFloat(fim.changes[0].value)).toBeGreaterThan(40);
    expect((await ultimo(p, 'selection-changed')).element.id).toBe('u-a');
  });

  it('r1 #6: Ctrl+Z com o foco dentro da página vira history-key', async () => {
    const p = await abrir(caixa('a', 'width:200px;height:100px;background:#ccc'));
    await selecionar(p, 'u-a');
    await p.keyboard.press('Control+z');
    expect((await ultimo(p, 'history-key')).action).toBe('undo');
    await p.keyboard.press('Control+Shift+z');
    expect((await ultimo(p, 'history-key')).action).toBe('redo');
  });

  it('r1 #7: elemento colado no topo e na esquerda → rótulo e 8 alças inteiros dentro da janela', async () => {
    const p = await abrir(caixa('a', 'position:absolute;left:0;top:0;width:300px;height:80px;background:#ccc'));
    await selecionar(p, 'u-a');
    const janela = await p.evaluate(() => ({ w: innerWidth, h: innerHeight }));
    for (const d of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) {
      const r = await retangulo(p, 'alca', d);
      expect(r.left, d).toBeGreaterThanOrEqual(0);
      expect(r.top, d).toBeGreaterThanOrEqual(0);
      expect(r.right, d).toBeLessThanOrEqual(janela.w);
      expect(r.bottom, d).toBeLessThanOrEqual(janela.h);
    }
    const rot = await retangulo(p, 'rotulo');
    expect(rot.top).toBeGreaterThanOrEqual(0);
    expect(rot.left).toBeGreaterThanOrEqual(0);
  });

  it('r3: arrastar → desfazer chega no meio → Esc → solta: a página fica no antes e nada reaparece', async () => {
    const p = await abrir(caixa('a', 'width:200px;height:100px;background:#ccc'));
    await selecionar(p, 'u-a');
    await arrastar(p, await retangulo(p, 'alca', 'e'), 60, 0);
    const { transaction } = await confirmar(p);
    expect(await largura(p, 'a')).toBe(260);
    await arrastar(p, await retangulo(p, 'alca', 'e'), 40, 0, { soltar: false });
    expect(await largura(p, 'a')).toBe(300);
    await p.evaluate((id) => window.__H.send('rollback-transaction', { targetTransactionId: id }), transaction.id);
    expect(await largura(p, 'a')).toBe(200);
    await p.keyboard.press('Escape');
    expect(await largura(p, 'a')).toBe(200);
    const antes = (await todos(p, 'overlay-gesture-ended')).length;
    await p.mouse.up();
    expect((await todos(p, 'overlay-gesture-ended')).length).toBe(antes);
    await quadro(p);
    expect(await largura(p, 'a')).toBe(200);
  });

  it('r4: segundo arraste durante a espera não começa; cancelar o primeiro volta ao antes do primeiro', async () => {
    const p = await abrir(caixa('a', 'width:200px;height:100px;background:#ccc'));
    await selecionar(p, 'u-a');
    await arrastar(p, await retangulo(p, 'alca', 'e'), 60, 0);
    const primeiro = await ultimo(p, 'overlay-gesture-ended');
    await arrastar(p, await retangulo(p, 'alca', 'e'), 40, 0);
    expect(await todos(p, 'overlay-gesture-ended')).toHaveLength(1);
    expect(await largura(p, 'a')).toBe(260);
    await p.evaluate((g) => window.__H.send('overlay-gesture-cancel', { gestureId: g, reason: 'test' }), primeiro.gestureId);
    expect(await largura(p, 'a')).toBe(200);
  });

  it('r5 #1: GSAP real com clearProps:"all" no elemento → alças apagadas com o motivo', async () => {
    const p = await abrir(`${caixa('a', 'width:200px;height:100px;background:#ccc')}<script src="/gsap.js"></script><script>gsap.to('#a', { x: 100, duration: 10, clearProps: 'all', paused: true });</script>`);
    await selecionar(p, 'u-a');
    expect((await estado(p)).alcasApagadas).toBe('cleared_by_motion');
    expect(await p.evaluate(() => window.__uncraftMotionBridge.overlay.alcaParaTeste('e').title)).toBe('An animation resets this when it ends');
    // ao selecionar, o editor assenta a animação no visual final e o clearProps do próprio site limpa o estilo
    // inline: o que se confere é que arrastar a alça apagada não muda nada
    const estiloAntes = await p.evaluate(() => document.getElementById('a').getAttribute('style'));
    const larguraAntes = await largura(p, 'a');
    await arrastar(p, await retangulo(p, 'alca', 'e'), 60, 0);
    expect(await todos(p, 'overlay-gesture-ended')).toHaveLength(0);
    expect(await p.evaluate(() => document.getElementById('a').getAttribute('style'))).toBe(estiloAntes);
    expect(await largura(p, 'a')).toBe(larguraAntes);
  });

  it('Review Focus 3: flex-basis fixo → gesto recusado (layout_controlled), nada gravado', async () => {
    const p = await abrir(`<main style="display:flex;width:800px">${caixa('a', 'flex:0 0 200px;height:100px;background:#ccc')}</main>`);
    await selecionar(p, 'u-a');
    await arrastar(p, await retangulo(p, 'alca', 'e'), 60, 0);
    expect(await todos(p, 'overlay-gesture-ended')).toHaveLength(0);
    expect(await largura(p, 'a')).toBe(200);
    expect((await estado(p)).motivo).toBe("This element's size is set by its layout");
  });

  it('Review Focus 4: rolar um contêiner com rolagem própria move a caixa junto', async () => {
    const p = await abrir(`<div id="rolo" style="height:300px;overflow:auto"><div style="height:1200px;padding-top:200px">${caixa('a', 'width:200px;height:100px;background:#ccc')}</div></div>`);
    await selecionar(p, 'u-a');
    await quadro(p);
    const antes = await retangulo(p, 'caixa');
    await p.evaluate(() => { document.getElementById('rolo').scrollTop = 100; });
    await quadro(p);
    const depois = await retangulo(p, 'caixa');
    expect(Math.round(antes.top - depois.top)).toBe(100);
    const alvo = await retangulo(p, 'el', 'a');
    expect(Math.abs(depois.top - alvo.top)).toBeLessThanOrEqual(1);
  });

  it('Review Focus 5: transform: scale(0.5) → arrastar não lança erro e emite a largura (conta do antigo)', async () => {
    const p = await abrir(caixa('a', 'width:200px;height:100px;background:#ccc;transform:scale(0.5);transform-origin:0 0'));
    await selecionar(p, 'u-a');
    await arrastar(p, await retangulo(p, 'alca', 'e'), 30, 0);
    const fim = await ultimo(p, 'overlay-gesture-ended');
    expect(fim).not.toBeNull();
    // paridade com o antigo (editor.js 10746): parte da largura VISÍVEL (100) e soma o arraste em px da página
    expect(fim.changes.find((c) => c.property === 'width').value).toBe('130px');
    expect(p.erros).toEqual([]);
  });

  it('elemento com transition: a checagem mede o valor final, não o do meio da transição', async () => {
    const p = await abrir(caixa('a', 'width:200px;height:100px;background:#ccc;transition:all 0.4s ease'));
    await selecionar(p, 'u-a');
    await arrastar(p, await retangulo(p, 'alca', 'e'), 60, 0);
    const fim = await ultimo(p, 'overlay-gesture-ended');
    expect(fim && fim.changes.find((c) => c.property === 'width').value).toBe('260px');
    expect((await estado(p)).motivo).toBeNull();
    expect(await largura(p, 'a')).toBe(260);                         // a prévia não anima atrás do mouse
    const { resp } = await confirmar(p);
    expect(resp.some((m) => m.type === 'transaction-committed')).toBe(true);
    const depois = await p.evaluate(() => { const a = document.getElementById('a'); return { w: a.getBoundingClientRect().width, anim: a.getAnimations().length, duracao: getComputedStyle(a).transitionDuration, estilo: a.getAttribute('style') }; });
    expect(depois.w).toBe(260);
    expect(depois.anim).toBe(0);                                     // confirmar também não anima
    expect(depois.duracao).toBe('0.4s');                             // a transição do site continua lá
    expect(depois.estilo).not.toMatch(/transition: none/);
  });
  it('transition: cancelar com Esc devolve o de antes sem animar a volta', async () => {
    const p = await abrir(caixa('a', 'width:200px;height:100px;background:#ccc;transition:all 0.4s ease'));
    const original = await p.evaluate(() => document.getElementById('a').getAttribute('style'));
    await selecionar(p, 'u-a');
    await arrastar(p, await retangulo(p, 'alca', 'e'), 60, 0, { soltar: false });
    await p.keyboard.press('Escape');
    await p.mouse.up();
    const depois = await p.evaluate(() => { const a = document.getElementById('a'); return { w: a.getBoundingClientRect().width, anim: a.getAnimations().length, estilo: a.getAttribute('style') }; });
    expect(depois).toEqual({ w: 200, anim: 0, estilo: original });
  });

  it('a camada não aparece no inventário, no describe nem no clique da seleção', async () => {
    const p = await abrir(`<main id="m" data-uncraft-id="u-m" style="display:flex;column-gap:40px">${caixa('a', 'width:200px;height:100px;background:#ccc')}${caixa('b', 'width:100px;height:100px;background:#ddd')}</main>`);
    await selecionar(p, 'u-a');
    await p.evaluate(() => window.__H.send('refresh-inventory', {}));
    await p.evaluate(() => window.__H.send('describe-element', { elementId: 'u-a' }));
    const tudo = await p.evaluate(() => window.__H.tudo());
    expect(tudo).not.toMatch(/uncraft-overlay|u-handle|u-guia/);
    // clicar na faixa da guia de gap (longe do rótulo do número) seleciona o que está embaixo: o pai
    const vao = await retangulo(p, 'guia', 'gap');
    await p.mouse.click(vao.x, vao.top + 8);
    expect((await ultimo(p, 'selection-changed')).element.id).toBe('u-m');
    // clicar no B (com a caixa de passar o mouse por cima dele) seleciona o B
    const b = await retangulo(p, 'el', 'b');
    await p.mouse.move(b.x, b.y); await quadro(p);
    await p.mouse.click(b.x, b.y);
    expect((await ultimo(p, 'selection-changed')).element.id).toBe('u-b');
  });

  it('duplo clique de mouse de verdade no rótulo da margem abre o campo DO elemento (o 1º clique não atravessa)', async () => {
    // flow-root: a margem do filho fica DENTRO do pai, então sob o rótulo da margem está o pai (selecionável)
    const p = await abrir(`<main id="m" data-uncraft-id="u-m" style="display:flow-root;background:#eee">${caixa('a', 'width:200px;height:80px;margin:20px;padding:12px;background:#ccc')}</main>`);
    await selecionar(p, 'u-a');
    for (const k of ['mb', 'pt']) {
      const rotulo = await p.evaluate((g) => { const w = window.__uncraftMotionBridge.overlay.guiaParaTeste(g).querySelector('.u-guia-widget'); const r = w.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, k);
      await p.mouse.dblclick(rotulo.x, rotulo.y);
      expect(await p.evaluate(() => !!window.__uncraftMotionBridge.overlay.campoParaTeste()), k).toBe(true);
      expect((await ultimo(p, 'selection-changed')).element.id, k).toBe('u-a');
      await p.keyboard.press('Escape');
    }
  });

  it('escala do canvas 0,5 e 2 → a alça mede 12 px na tela', async () => {
    const p = await abrir(caixa('a', 'width:200px;height:100px;background:#ccc'));
    await selecionar(p, 'u-a');
    for (const escala of [0.5, 2]) {
      await p.evaluate((s) => window.__H.send('set-overlay-scale', { scale: s }), escala);
      const r = await retangulo(p, 'alca', 'e');
      expect(r.width * escala).toBeCloseTo(12, 1);
    }
  });

  it('Astra T4 r2: body com transform → a caixa da camada fica exatamente sobre o elemento', async () => {
    const p = await abrir(caixa('a', 'width:200px;height:100px;background:#ccc'), { head: '<style>body{transform:translateY(40px)}</style>' });
    await selecionar(p, 'u-a');
    await quadro(p);
    const sel = await retangulo(p, 'caixa');
    const alvo = await retangulo(p, 'el', 'a');
    for (const k of ['left', 'top', 'width', 'height']) expect(Math.abs(sel[k] - alvo[k]), k).toBeLessThanOrEqual(1);
  });

  it('Astra T6 #2: largura inline com !important — a checagem e o cancelamento a preservam', async () => {
    const p = await abrir('<div id="a" data-uncraft-id="u-a" style="width: 200px !important; height: 100px; background: #ccc">A</div>');
    const original = await p.evaluate(() => document.getElementById('a').getAttribute('style'));
    await selecionar(p, 'u-a');
    expect(await p.evaluate(() => document.getElementById('a').getAttribute('style'))).toBe(original);
    await arrastar(p, await retangulo(p, 'alca', 'e'), 40, 0, { soltar: false });
    await p.keyboard.press('Escape');
    await p.mouse.up();
    expect(await p.evaluate(() => document.getElementById('a').getAttribute('style'))).toBe(original);
    expect(await p.evaluate(() => document.getElementById('a').style.getPropertyPriority('width'))).toBe('important');
  });
});
