// TRAVA DE LAYOUT (decisao 1 do Adilson, 2026-10-05) em navegador real, pelas DUAS portas de edicao:
// (A) a ponte do clone (protocolo v2 — e por onde os paineis de fora editam e por onde o salvo e
//     reaplicado) e a porta do editor-core (__uncraftEditorCommit);
// (B) o editor-core dentro da pagina, dirigido por clique/tecla como o usuario faz.
// Em todas: posicao/tamanho de caixa travada = recusa; cor/opacidade/texto = livre; fora da regiao = livre.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getRuntimeBridgeSource } from '../motion-editor/runtime-bridge-source.js';
import { fullEditorTags } from '../motion-editor/native-clone-gateway.js';

vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 });

const EDITOR_SRC = path.resolve(process.cwd(), '../editor-core/src');
const CSS = `<style>
  body{margin:0;font:16px sans-serif}
  #u-regiao{position:relative;width:600px;height:300px;margin:20px}
  #u-faixa{width:100px;height:20px;background:rgb(240, 240, 240)}
  #u-ancora{position:absolute;left:10px;top:40px;width:200px;height:120px;background:#ddd}
  #u-legenda{position:absolute;left:10px;top:180px;width:300px;margin:0;color:rgb(0, 0, 0)}
  #u-livre{width:600px;height:200px;margin:20px}
  #u-texto-livre{width:200px;margin:0;color:rgb(0, 0, 0)}
  #u-envelope{width:200px;height:30px;padding:12px;margin-top:20px;background:rgb(230, 230, 230)}
  #u-foto,#u-foto-livre{width:40px}
</style>`;
const CORPO = `<main id="u-pagina"><section id="u-regiao" data-u-trava="regiao"><div id="u-faixa"></div><div id="u-ancora" data-u-trava="layout"></div><p id="u-legenda">Caption text</p><img id="u-foto" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"></section>
<section id="u-livre"><p id="u-texto-livre">Free text</p><img id="u-foto-livre" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">
<div id="u-envelope"><span>Badge</span><div id="u-fixa" data-u-trava="fixa" style="position:fixed;right:10px;bottom:10px;width:40px;height:40px"></div></div></section></main>`;
const PAGINA = `<!doctype html><html><head>${CSS}</head><body>${CORPO}</body></html>`;
const PAGINA_EDITOR = `<!doctype html><html><head>${CSS}</head><body>${CORPO}${fullEditorTags()}</body></html>`;

let srv; let porta; let browser;
beforeAll(async () => {
  srv = createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname.startsWith('/editor-core/')) {
      const nome = path.basename(u.pathname);
      try {
        const corpo = await readFile(path.join(EDITOR_SRC, nome));
        res.writeHead(200, { 'content-type': nome.endsWith('.css') ? 'text/css' : 'text/javascript' }); res.end(corpo);
      } catch { res.writeHead(404); res.end(); }
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' }); res.end(u.pathname === '/editor' ? PAGINA_EDITOR : PAGINA);
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok)); porta = srv.address().port;
  const { chromium } = await import('playwright-core'); browser = await chromium.launch();
});
afterAll(async () => { await browser?.close(); await new Promise((ok) => srv.close(ok)); });

// Liga a ponte na pagina e fala com ela pelo protocolo v2 (como o host faz)
const HARNESS = `window.__H = (() => {
  const V1 = 'uncraft-motion-editor/v1', V2 = 'uncraft-motion-editor/v2';
  const NONCE = 'nonce-trava-123456', BUNDLE = 'bundle-trava', SESSION = 'session-trava', ORIGIN = 'https://app.uncraft.test';
  const messages = []; let generation = null; let seq = 0;
  const config = document.createElement('script');
  config.type = 'application/json'; config.dataset.uncraftRuntimeConfig = 'true';
  config.textContent = JSON.stringify({ initialManifest: { schemaVersion: 2, baseBundleId: BUNDLE, transactions: [] },
    runtimeSessionId: SESSION, runtimeFingerprint: 'sha256:trava', sessionNonce: NONCE });
  document.head.appendChild(config);
  window.postMessage = (m) => messages.push(m);
  window.eval(window.__BRIDGE_SRC);
  generation = messages.filter((m) => m.type === 'runtime-ready').pop().payload.runtimeGeneration;
  const enviar = (protocol, type, payload) => {
    const mark = messages.length;
    window.dispatchEvent(new MessageEvent('message', { source: window, origin: ORIGIN, data: {
      protocol, protocolVersion: protocol, supportedProtocols: [V2, V1], source: 'host', type,
      sessionNonce: NONCE, requestId: 'trava-' + (seq += 1), runtimeGeneration: generation,
      bundleId: BUNDLE, sessionId: SESSION, payload } }));
    return messages.slice(mark);
  };
  enviar(V1, 'negotiate-protocol', { selectedProtocol: V2 });
  const idDe = (domId) => {
    document.getElementById(domId).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    return messages.filter((m) => m.type === 'selection-changed').pop().payload.element.id;
  };
  let tx = 0;
  const transacao = (patches) => {
    const id = 'tx-trava-' + (tx += 1);
    const r = enviar(V2, 'apply-transaction', { transaction: { id, patches: patches.map((p, i) => ({ id: id + ':p' + i, kind: 'style', before: null, ...p })) } });
    const ack = r.filter((m) => m.type === 'transaction-committed' || m.type === 'transaction-rejected').pop();
    return { tipo: ack ? ack.type : null, code: ack && ack.payload ? ack.payload.code || null : null };
  };
  const ferramenta = (t) => enviar(V2, 'set-tool', { tool: t });
  // arrasto com a ferramenta Mover: pointerdown no elemento, move e solta no documento
  const arrastar = (domId, dx, dy) => {
    const el = document.getElementById(domId); const r = el.getBoundingClientRect();
    const x = r.left + 10, y = r.top + 5; const mark = messages.length;
    const pe = (alvo, type, cx, cy) => alvo.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, button: 0, clientX: cx, clientY: cy, pointerId: 1 }));
    pe(el, 'pointerdown', x, y); pe(document, 'pointermove', x + dx, y + dy); pe(document, 'pointerup', x + dx, y + dy);
    return { movidos: [...document.querySelectorAll('[style*="translate"]')].map((e) => e.id), tipos: messages.slice(mark).map((m) => m.type) };
  };
  return { idDe, transacao, ferramenta, arrastar };
})();`;

async function abrirComPonte() {
  const p = await browser.newPage({ viewport: { width: 900, height: 700 } });
  await p.goto(`http://127.0.0.1:${porta}/`);
  await p.evaluate((src) => { window.__BRIDGE_SRC = src; }, getRuntimeBridgeSource());
  await p.evaluate(HARNESS);
  return p;
}
const estilo = (p, id, prop) => p.evaluate(([i, k]) => getComputedStyle(document.getElementById(i))[k], [id, prop]);

describe('trava de layout — ponte do clone', () => {
  it('transacao: tamanho/posicao de caixa travada e RECUSADO (layout_locked), sem escrever nada', async () => {
    const p = await abrirComPonte();
    const legenda = await p.evaluate(() => window.__H.idDe('u-legenda'));
    const ancora = await p.evaluate(() => window.__H.idDe('u-ancora'));
    for (const [elementId, property, value] of [[legenda, 'width', '120px'], [legenda, 'margin-top', '40px'], [ancora, 'left', '300px'], [ancora, 'transform', 'translateX(50px)'], [legenda, 'inline-size', '90px'], [ancora, 'block-size', '10px']]) {
      const r = await p.evaluate((patch) => window.__H.transacao([patch]), { elementId, property, value });
      expect(r, `${property}`).toEqual({ tipo: 'transaction-rejected', code: 'layout_locked' });
    }
    expect(await estilo(p, 'u-legenda', 'width')).toBe('300px');
    expect(await estilo(p, 'u-ancora', 'left')).toBe('10px');
    await p.close();
  });
  it('transacao: cor da caixa travada e LIVRE; tamanho FORA da regiao e livre', async () => {
    const p = await abrirComPonte();
    const legenda = await p.evaluate(() => window.__H.idDe('u-legenda'));
    const livre = await p.evaluate(() => window.__H.idDe('u-texto-livre'));
    expect(await p.evaluate((elementId) => window.__H.transacao([{ elementId, property: 'color', value: 'rgb(200, 0, 0)' }]), legenda)).toEqual({ tipo: 'transaction-committed', code: null });
    expect(await estilo(p, 'u-legenda', 'color')).toBe('rgb(200, 0, 0)');
    expect(await p.evaluate((elementId) => window.__H.transacao([{ elementId, property: 'width', value: '123px' }]), livre)).toEqual({ tipo: 'transaction-committed', code: null });
    expect(await estilo(p, 'u-texto-livre', 'width')).toBe('123px');
    await p.close();
  });
  it('transacao MISTA (cor livre + largura travada) e atomica: a cor tambem volta', async () => {
    const p = await abrirComPonte();
    const legenda = await p.evaluate(() => window.__H.idDe('u-legenda'));
    const r = await p.evaluate((elementId) => window.__H.transacao([
      { elementId, property: 'color', value: 'rgb(0, 128, 0)' },
      { elementId, property: 'width', value: '50px' },
    ]), legenda);
    expect(r).toEqual({ tipo: 'transaction-rejected', code: 'layout_locked' });
    expect(await estilo(p, 'u-legenda', 'color')).toBe('rgb(0, 0, 0)');
    expect(await estilo(p, 'u-legenda', 'width')).toBe('300px');
    await p.close();
  });
  it('quem CONTEM a regiao tambem e travado (crescer o pai move a ancora); camelCase nao escapa', async () => {
    const p = await abrirComPonte();
    const pagina = await p.evaluate(() => window.__H.idDe('u-pagina'));
    expect(await p.evaluate((elementId) => window.__H.transacao([{ elementId, property: 'padding-top', value: '80px' }]), pagina)).toEqual({ tipo: 'transaction-rejected', code: 'layout_locked' });
    const legenda = await p.evaluate(() => window.__H.idDe('u-legenda'));
    expect(await p.evaluate((elementId) => window.__H.transacao([{ elementId, property: 'maxWidth', value: '10px' }]), legenda)).toEqual({ tipo: 'transaction-rejected', code: 'layout_locked' });
    await p.close();
  });
  it('lista do que PODE: o imprevisto e recusado; texto, fonte e aparencia passam', async () => {
    const p = await abrirComPonte();
    const legenda = await p.evaluate(() => window.__H.idDe('u-legenda'));
    const tenta = (property, value) => p.evaluate(([elementId, property, value]) => window.__H.transacao([{ elementId, property, value }]), [legenda, property, value]);
    for (const [property, value] of [['writing-mode', 'vertical-rl'], ['--u-x', '40px'], ['vertical-align', 'middle'], ['overflow', 'scroll'], ['line-clamp', '2']]) {
      expect(await tenta(property, value), property).toEqual({ tipo: 'transaction-rejected', code: 'layout_locked' });
    }
    for (const [property, value] of [['font-size', '20px'], ['letter-spacing', '2px'], ['text-align', 'center'], ['background-color', 'rgb(1, 2, 3)'], ['box-shadow', 'rgb(0, 0, 0) 0px 0px 4px 0px'], ['opacity', '0.5']]) {
      expect(await tenta(property, value), property).toEqual({ tipo: 'transaction-committed', code: null });
    }
    await p.close();
  });
  it('ferramenta MOVER: caixa travada nem comeca o arrasto (aviso, nada escrito); fora da regiao move', async () => {
    const p = await abrirComPonte();
    await p.evaluate(() => window.__H.ferramenta('move'));
    const travada = await p.evaluate(() => window.__H.arrastar('u-legenda', 30, 20));
    expect(travada.movidos).toEqual([]);
    expect(travada.tipos).toContain('patch-rejected');
    expect(travada.tipos).not.toContain('transaction-committed');
    // controle: o MESMO arrasto fora da regiao escreve e registra
    const livre = await p.evaluate(() => window.__H.arrastar('u-texto-livre', 30, 20));
    expect(livre.movidos.length).toBe(1);
    expect(livre.tipos).toContain('transaction-committed');
    await p.close();
  });
  it('borda: largura/estilo travam (mudam o tamanho); cor da borda e raio seguem livres', async () => {
    const p = await abrirComPonte();
    const legenda = await p.evaluate(() => window.__H.idDe('u-legenda'));
    for (const [property, value] of [['border-width', '20px'], ['border-top-style', 'solid'], ['border', '4px solid red'], ['borderLeftWidth', '9px']]) {
      expect(await p.evaluate(([elementId, property, value]) => window.__H.transacao([{ elementId, property, value }]), [legenda, property, value]), property).toEqual({ tipo: 'transaction-rejected', code: 'layout_locked' });
    }
    for (const [property, value] of [['border-color', 'rgb(255, 0, 0)'], ['border-radius', '8px']]) {
      expect(await p.evaluate(([elementId, property, value]) => window.__H.transacao([{ elementId, property, value }]), [legenda, property, value]), property).toEqual({ tipo: 'transaction-committed', code: null });
    }
    await p.close();
  });
  it('ancora FIXA trava so ela: quem a contem segue livre (nenhum pai move o que esta preso a tela)', async () => {
    const p = await abrirComPonte();
    const fixa = await p.evaluate(() => window.__H.idDe('u-fixa'));
    expect(await p.evaluate((elementId) => window.__H.transacao([{ elementId, property: 'width', value: '80px' }]), fixa)).toEqual({ tipo: 'transaction-rejected', code: 'layout_locked' });
    // a pagina (main) contem a fixa E a regiao: continua travada pela regiao; tira-se a regiao e ela libera
    const pagina = await p.evaluate(() => { document.getElementById('u-regiao').remove(); return window.__H.idDe('u-pagina'); });
    expect(await p.evaluate((elementId) => window.__H.transacao([{ elementId, property: 'padding-top', value: '10px' }]), pagina)).toEqual({ tipo: 'transaction-committed', code: null });
    // ...exceto o que faria dele o bloco de contencao da fixa (Astra r2): ela seria arrastada junto
    const antes = await p.evaluate(() => JSON.stringify(document.getElementById('u-fixa').getBoundingClientRect()));
    for (const [property, value] of [['transform', 'translateX(50px)'], ['translate', '50px 0px'], ['filter', 'blur(1px)'], ['will-change', 'transform'], ['contain', 'paint']]) {
      expect(await p.evaluate(([elementId, property, value]) => window.__H.transacao([{ elementId, property, value }]), [pagina, property, value]), property).toEqual({ tipo: 'transaction-rejected', code: 'layout_locked' });
    }
    expect(await p.evaluate(() => JSON.stringify(document.getElementById('u-fixa').getBoundingClientRect()))).toBe(antes);
    // a ferramenta Mover no pai tambem nao comeca o arrasto
    await p.evaluate(() => window.__H.ferramenta('move'));
    const arrasto = await p.evaluate(() => window.__H.arrastar('u-pagina', 30, 20));
    expect(arrasto.movidos).toEqual([]);
    expect(arrasto.tipos).toContain('patch-rejected');
    await p.close();
  });
  it('Astra r4: imagem DENTRO da regiao nao troca de src (outro tamanho natural); fora troca', async () => {
    const p = await abrirComPonte();
    const foto = await p.evaluate(() => window.__H.idDe('u-foto'));
    const livre = await p.evaluate(() => window.__H.idDe('u-foto-livre'));
    const NOVA = 'data:image/gif;base64,R0lGODlhAgACAIAAAAAAAP///yH5BAEAAAAALAAAAAACAAIAAAIChFEAOw==';
    for (const property of ['src', 'srcset']) {
      expect(await p.evaluate(([elementId, property, value]) => window.__H.transacao([{ elementId, kind: 'attribute', property, value }]), [foto, property, NOVA]), property).toEqual({ tipo: 'transaction-rejected', code: 'layout_locked' });
    }
    expect(await p.evaluate(([elementId, value]) => window.__H.transacao([{ elementId, kind: 'attribute', property: 'src', value }]), [livre, NOVA])).toEqual({ tipo: 'transaction-committed', code: null });
    // a porta do editor-core tambem recusa na consulta
    const q = await p.evaluate((nova) => window.__uncraftEditorCommit(document.getElementById('u-foto'), { kind: 'attribute', property: 'src', before: document.getElementById('u-foto').getAttribute('src'), value: nova }, { dryRun: true }), NOVA);
    expect(q).toMatchObject({ ok: false, reason: 'layout_locked' });
    await p.close();
  });
  it('Astra r4: o que chega por TABELA — animacao na caixa travada; filtro e variavel CSS em quem contem ancora', async () => {
    const p = await abrirComPonte();
    const legenda = await p.evaluate(() => window.__H.idDe('u-legenda'));
    const regiao = await p.evaluate(() => window.__H.idDe('u-regiao'));
    const antes = await p.evaluate(() => JSON.stringify(document.getElementById('u-ancora').getBoundingClientRect()));
    const tenta = (elementId, property, value) => p.evaluate(([elementId, property, value]) => window.__H.transacao([{ elementId, property, value }]), [elementId, property, value]);
    expect(await tenta(legenda, 'animation', 'qualquer 1s infinite')).toEqual({ tipo: 'transaction-rejected', code: 'layout_locked' });
    // filtro faria da regiao o bloco de contencao da ancora ABSOLUTA de dentro
    expect(await tenta(regiao, 'filter', 'blur(1px)')).toEqual({ tipo: 'transaction-rejected', code: 'layout_locked' });
    expect(await p.evaluate(() => JSON.stringify(document.getElementById('u-ancora').getBoundingClientRect()))).toBe(antes);
    // filtro na PROPRIA ancora nao a move: segue livre (aparencia)
    const ancora = await p.evaluate(() => window.__H.idDe('u-ancora'));
    expect(await tenta(ancora, 'filter', 'blur(1px)')).toEqual({ tipo: 'transaction-committed', code: null });
    // variavel CSS no involucro da fixa (var() poderia alimentar um transform dele)
    const envelope = await p.evaluate(() => window.__H.idDe('u-envelope'));
    expect(await tenta(envelope, '--u-movimento', 'translateX(50px)')).toEqual({ tipo: 'transaction-rejected', code: 'layout_locked' });
    await p.close();
  });
  it('porta do editor-core (__uncraftEditorCommit): consulta recusa layout em caixa travada, aceita cor', async () => {
    const p = await abrirComPonte();
    const r = await p.evaluate(() => {
      const el = document.getElementById('u-legenda');
      const q = (property, value) => window.__uncraftEditorCommit(el, { kind: 'style', property, before: getComputedStyle(el).getPropertyValue(property), value }, { dryRun: true });
      return { largura: q('width', '100px'), cor: q('color', 'rgb(1, 2, 3)') };
    });
    expect(r.largura).toMatchObject({ ok: false, reason: 'layout_locked' });
    expect(r.cor.reason).not.toBe('layout_locked');
    await p.close();
  });
});

async function abrirEditor() {
  const p = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const erros = []; p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto(`http://127.0.0.1:${porta}/editor`);
  await p.waitForSelector('#rb-editor-inspector', { state: 'attached', timeout: 20000 });
  await p.waitForTimeout(500);
  return { p, erros };
}
async function selecionar(p, id) {
  const caixa = await p.evaluate((i) => { const r = document.getElementById(i).getBoundingClientRect(); return { x: r.left + Math.min(20, r.width / 2), y: r.top + Math.min(8, r.height / 2) }; }, id);
  await p.mouse.click(caixa.x, caixa.y);
  await p.waitForTimeout(200);
}
const campoW = (p) => p.locator('#rb-editor-inspector .rb-insp-sec[data-rb-sec="container"] .rb-insp-field-bg').filter({ has: p.locator('.rb-insp-field-letter', { hasText: /^W$/ }) }).locator('input');
const textoDoAviso = (p) => p.evaluate(() => { const t = document.querySelector('#rb-editor-root .rb-ed-toast'); return t ? t.textContent : ''; });

describe('trava de layout — editor-core na pagina', () => {
  it('caixa travada: aviso no inspector, campos de layout desligados, sem alcas', async () => {
    const { p, erros } = await abrirEditor();
    await selecionar(p, 'u-legenda');
    const v = await p.evaluate(() => ({
      nota: (document.querySelector('#rb-editor-inspector .rb-insp-lock-note') || {}).textContent || null,
      travada: !!document.querySelector('#rb-editor-inspector .rb-insp-sec.rb-insp-locked[data-rb-sec="container"]'),
      alcas: getComputedStyle(document.querySelector('.rb-sel-box .rb-sel-handle')).display,
    }));
    expect(v.nota).toMatch(/^Layout locked/);
    expect(v.travada).toBe(true);
    expect(v.alcas).toBe('none');
    expect(await campoW(p).isDisabled()).toBe(true);
    expect(erros).toEqual([]);
    await p.close();
  });
  it('a guarda vale mesmo com o campo religado a forca; Delete e alca tambem recusam; cor/opacidade seguem', async () => {
    const { p, erros } = await abrirEditor();
    await selecionar(p, 'u-legenda');
    // o campo desligado e so a vitrine: a guarda de verdade esta no applyStyle
    await campoW(p).evaluate((inp) => { inp.disabled = false; inp.value = '77'; inp.dispatchEvent(new Event('change', { bubbles: true })); });
    await p.waitForTimeout(300);
    expect(await estilo(p, 'u-legenda', 'width')).toBe('300px');
    expect(await textoDoAviso(p)).toMatch(/Layout locked/);
    // alca de redimensionar (escondida, mas o ouvinte existe)
    await p.evaluate(() => {
      const h = document.querySelector('.rb-sel-handle[data-dir="se"]');
      h.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 300, clientY: 200 }));
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 420, clientY: 300 }));
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 420, clientY: 300 }));
    });
    expect(await estilo(p, 'u-legenda', 'width')).toBe('300px');
    // mesma sequencia que REMOVE no teste de fora da regiao (controle)
    await p.mouse.click(5, 880);
    await selecionar(p, 'u-legenda');
    await p.keyboard.press('Delete');
    expect(await p.evaluate(() => !!document.getElementById('u-legenda'))).toBe(true);
    // opacidade (Appearance) na MESMA caixa travada
    const op = p.locator('#rb-editor-inspector .rb-insp-sec[data-rb-sec="appearance"] input').first();
    await op.evaluate((inp) => { inp.value = '50%'; inp.dispatchEvent(new Event('change', { bubbles: true })); });
    await p.waitForTimeout(300);
    expect(Number(await estilo(p, 'u-legenda', 'opacity'))).toBeCloseTo(0.5, 2);
    expect(erros).toEqual([]);
    await p.close();
  });
  const abrirEfeito = async (p) => {
    await p.evaluate(() => document.querySelector('#rb-editor-inspector .rb-insp-sec[data-rb-sec="fill"] .rb-insp-color-row').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })));
    await p.waitForTimeout(300);
    await p.evaluate(() => [...document.querySelectorAll('.rb-fill-tab')].find((b) => b.textContent === 'Effects').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })));
    await p.waitForTimeout(200);
    await p.evaluate(() => document.querySelector('.rb-fill-fx-card').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })));
    await p.waitForTimeout(300);
  };
  const addStroke = (p) => p.evaluate(() => document.querySelector('#rb-editor-inspector .rb-insp-sec[data-rb-sec="stroke"] .rb-insp-add-btn').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })));
  it('caixa ESTATICA travada: efeito recusado (viraria bloco de contencao) e borda recusada; fora da regiao os dois pegam', async () => {
    const { p, erros } = await abrirEditor();
    await selecionar(p, 'u-faixa');
    expect(await p.evaluate(() => !!document.querySelector('.rb-insp-lock-note'))).toBe(true);
    await abrirEfeito(p);
    expect(await estilo(p, 'u-faixa', 'position')).toBe('static');
    expect(await p.evaluate(() => document.getElementById('u-faixa').hasAttribute('data-rb-fx-name'))).toBe(false);
    await p.keyboard.press('Escape'); await p.mouse.click(5, 880);
    await selecionar(p, 'u-faixa');
    await addStroke(p); await p.waitForTimeout(200);
    expect(await estilo(p, 'u-faixa', 'borderTopWidth')).toBe('0px');
    // controle: o MESMO caminho numa caixa estatica fora da regiao
    await p.keyboard.press('Escape'); await p.mouse.click(5, 880);
    await selecionar(p, 'u-texto-livre');
    await abrirEfeito(p);
    expect(await estilo(p, 'u-texto-livre', 'position')).toBe('relative');
    await p.keyboard.press('Escape'); await p.mouse.click(5, 880);
    await selecionar(p, 'u-texto-livre');
    await addStroke(p); await p.waitForTimeout(200);
    expect(await estilo(p, 'u-texto-livre', 'borderTopWidth')).toBe('1px');
    expect(erros).toEqual([]);
    await p.close();
  });
  it('Astra r4: apagar o INVOLUCRO da ancora fixa e recusado (a fixa iria junto)', async () => {
    const { p, erros } = await abrirEditor();
    const canto = await p.evaluate(() => { const r = document.getElementById('u-envelope').getBoundingClientRect(); return { x: r.left + 4, y: r.top + 4 }; });
    await p.mouse.click(canto.x, canto.y); await p.waitForTimeout(200);
    expect(await p.evaluate(() => (document.querySelector('.rb-ed-crumb-active') || {}).textContent)).toBe('div');
    await p.keyboard.press('Delete');
    expect(await p.evaluate(() => !!document.getElementById('u-envelope'))).toBe(true);
    expect(await p.evaluate(() => !!document.getElementById('u-fixa'))).toBe(true);
    expect(await textoDoAviso(p)).toMatch(/Layout locked/);
    expect(erros).toEqual([]);
    await p.close();
  });
  it('fora da regiao: nada muda — sem aviso, campo W liga e escreve, Delete remove', async () => {
    const { p, erros } = await abrirEditor();
    await selecionar(p, 'u-texto-livre');
    expect(await p.evaluate(() => document.querySelectorAll('#rb-editor-inspector .rb-insp-lock-note').length)).toBe(0);
    expect(await campoW(p).isDisabled()).toBe(false);
    await campoW(p).fill('123');
    await campoW(p).dispatchEvent('change');
    await p.waitForTimeout(300);
    expect(await estilo(p, 'u-texto-livre', 'width')).toBe('123px');
    await p.mouse.click(5, 880); // tira o foco do campo antes do Delete
    await selecionar(p, 'u-texto-livre');
    await p.keyboard.press('Delete');
    expect(await p.evaluate(() => !!document.getElementById('u-texto-livre'))).toBe(false);
    expect(erros).toEqual([]);
    await p.close();
  });
});
