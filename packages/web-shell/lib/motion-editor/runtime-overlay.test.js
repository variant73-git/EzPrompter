// Camada de alças e guias dentro da página (spec 2026-10-20 §4-§6) — jsdom, com a ponte real.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPatch } from './protocol.js';
import { createTransaction } from './transaction.js';
import { MOTION_EDITOR_PROTOCOL, MOTION_EDITOR_PROTOCOL_V2, SUPPORTED_MOTION_EDITOR_PROTOCOLS, commandV2 } from './protocol.js';
import { getRuntimeBridgeSource } from './runtime-bridge-source.js';

function boot() {
  document.body.innerHTML = '<main id="m"><div id="a" data-uncraft-id="u-a" style="width:200px">A</div><div id="b" data-uncraft-id="u-b">B</div></main>';
  const config = document.createElement('script'); config.type = 'application/json'; config.dataset.uncraftRuntimeConfig = 'true';
  config.textContent = JSON.stringify({ initialManifest: { schemaVersion: 2, baseBundleId: 'bundle-fixture', transactions: [] }, runtimeSessionId: 'session-fixture', runtimeFingerprint: 'sha256:fixture', sessionNonce: 'nonce-fixture-123456' });
  document.head.appendChild(config);
  const messages = []; const original = window.postMessage; window.postMessage = (m) => messages.push(m);
  window.eval(getRuntimeBridgeSource());
  const ready = messages.filter((m) => m.type === 'runtime-ready').pop();
  const context = { sessionNonce: 'nonce-fixture-123456', runtimeGeneration: ready.payload.runtimeGeneration, bundleId: 'bundle-fixture', sessionId: 'session-fixture' };
  const origin = 'https://app.uncraft.test';
  window.dispatchEvent(new MessageEvent('message', { source: window, origin, data: { protocol: MOTION_EDITOR_PROTOCOL, protocolVersion: MOTION_EDITOR_PROTOCOL, supportedProtocols: SUPPORTED_MOTION_EDITOR_PROTOCOLS, source: 'host', type: 'negotiate-protocol', requestId: 'n1', ...context, payload: { selectedProtocol: MOTION_EDITOR_PROTOCOL_V2 } } }));
  const send = (type, payload, requestId = `r-${Math.random()}`) => window.dispatchEvent(new MessageEvent('message', { source: window, origin, data: commandV2(type, payload, { ...context, requestId }) }));
  return { messages, send, restore: () => { window.__uncraftMotionBridge?.teardown?.(); window.postMessage = original; document.head.querySelectorAll('[data-uncraft-runtime-config]').forEach((n) => n.remove()); } };
}

describe('camada de alças e guias — instalação e isolamento', () => {
  let rt; afterEach(() => rt?.restore());
  it('instala UMA raiz <uncraft-overlay> com sombra fechada e pointer-events none', () => {
    rt = boot();
    const raizes = document.querySelectorAll('uncraft-overlay');
    expect(raizes).toHaveLength(1);
    expect(raizes[0].shadowRoot).toBeNull();               // fechada
    expect(raizes[0].style.pointerEvents).toBe('none');
    expect(raizes[0].hasAttribute('data-uncraft-overlay')).toBe(true);
  });
  it('a camada não aparece no inventário nem no perfil do documento', () => {
    rt = boot(); rt.send('refresh-inventory', {});
    const inv = rt.messages.filter((m) => m.type === 'inventory-changed').pop();
    expect(JSON.stringify(inv.payload)).not.toMatch(/uncraft-overlay/);
  });
  it('selecionar troca o contorno pela caixa da camada', () => {
    rt = boot(); rt.send('select-element', { elementId: 'u-a' });
    const css = Array.from(document.querySelectorAll('style[data-uncraft-runtime-bridge]')).map((s) => s.textContent).join('\n');
    expect(css).toMatch(/html:not\(\[data-uncraft-overlay-ativa\]\)\[data-uncraft-editor-mode="edit"\] \[data-uncraft-selected="true"\]/);
    expect(document.documentElement.dataset.uncraftOverlayAtiva).toBeTruthy();   // o valor é o DONO da marca (reinjeção)
    expect(window.__uncraftMotionBridge.overlay.estado().caixaVisivel).toBe(true);
  });
  it('set-overlay-scale chega à camada', () => {
    rt = boot(); rt.send('set-overlay-scale', { scale: 0.5 });
    expect(window.__uncraftMotionBridge.overlay.estado().escala).toBe(0.5);
  });
  it('clique na raiz da camada nunca vira seleção dela', () => {
    rt = boot(); const raiz = document.querySelector('uncraft-overlay');
    raiz.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    const sel = rt.messages.filter((m) => m.type === 'selection-changed').pop();
    expect(sel?.payload?.element?.tagName).not.toBe('uncraft-overlay');
  });
  // Astra (Task 4) #1: a página trocando o conteúdo do body removia a raiz para sempre
  it('raiz removida pela página volta na próxima mudança, e a marca de ativa acompanha', () => {
    rt = boot();
    document.querySelector('uncraft-overlay').remove();
    rt.send('select-element', { elementId: 'u-a' });
    expect(document.querySelectorAll('uncraft-overlay')).toHaveLength(1);
    expect(document.documentElement.dataset.uncraftOverlayAtiva).toBeTruthy();
  });
  // Astra (Task 4) #2: reinjetar a ponte apagava a marca da camada NOVA
  it('reinjetar a ponte deixa UMA raiz e a marca de ativa ligada', () => {
    rt = boot();
    window.eval(getRuntimeBridgeSource());
    expect(document.querySelectorAll('uncraft-overlay')).toHaveLength(1);
    expect(document.documentElement.dataset.uncraftOverlayAtiva).toBeTruthy();
  });
  // Astra (Task 4) #4: estilo do site (até !important) não pode mover nem esconder a raiz
  it('a raiz trava posição, transformação e visibilidade com prioridade máxima', () => {
    rt = boot();
    const raiz = document.querySelector('uncraft-overlay');
    for (const p of ['position', 'inset', 'transform', 'translate', 'scale', 'rotate', 'filter', 'display', 'visibility', 'opacity', 'pointer-events', 'z-index', 'margin', 'zoom']) {
      expect(raiz.style.getPropertyPriority(p), p).toBe('important');
    }
    expect(raiz.id).toBe('rb-ed-uncraft-overlay');   // o editor antigo preserva rb-ed-* ao trocar a página
  });
  // Astra (Task 4 r2): um ancestral transformado vira o bloco de contenção dos filhos fixos e a caixa sairia
  // deslocada duas vezes — a camada mora fora do body e converte para o SEU sistema de coordenadas
  it('mora fora do body e converte a posição pela origem real da raiz', () => {
    rt = boot();
    const raiz = document.querySelector('uncraft-overlay');
    expect(raiz.parentElement).toBe(document.documentElement);
    raiz.getBoundingClientRect = () => ({ left: 0, top: 40, right: 1280, bottom: 840, width: 1280, height: 800, x: 0, y: 40 });
    document.getElementById('a').getBoundingClientRect = () => ({ left: 10, top: 40, right: 210, bottom: 140, width: 200, height: 100, x: 10, y: 40 });
    rt.send('select-element', { elementId: 'u-a' });
    expect(window.__uncraftMotionBridge.overlay.estado().caixa).toEqual({ x: 10, y: 0, width: 200, height: 100 });
  });
});

// Etapa 5 — ciclo de vida do gesto na ponte (spec §6.2)
describe('gestos — estados e confirmação', () => {
  let rt; afterEach(() => rt?.restore());
  const ponte = () => window.__uncraftMotionBridge.overlay.ponteParaTeste();
  // transação montada pelas MESMAS funções do editor de fora (passa por assertTransaction)
  const transacao = (value) => createTransaction({ patches: [createPatch({ elementId: 'u-a', kind: 'style', property: 'width', before: '200px', value })], source: 'overlay' });
  it('soltar deixa a prévia; a confirmação devolve o antes e aplica no mesmo turno (before = antes do gesto)', () => {
    rt = boot(); const a = document.getElementById('a');
    const g = ponte().iniciarGesto([{ el: a, property: 'width' }]);
    ponte().previa(g.gestureId, [{ el: a, property: 'width', value: '260px' }]);
    ponte().terminarGesto(g.gestureId, [{ el: a, property: 'width', value: '260px' }]);
    expect(a.style.width).toBe('260px');
    const fim = rt.messages.filter((m) => m.type === 'overlay-gesture-ended').pop();
    expect(fim.payload.changes).toEqual([{ elementId: 'u-a', property: 'width', before: '200px', value: '260px' }]);
    rt.send('apply-transaction', { transaction: transacao('260px'), gestureId: g.gestureId });
    const ok = rt.messages.filter((m) => m.type === 'transaction-committed').pop();
    expect(ok.payload.transaction.patches[0].before).toBe('200px');
    expect(a.style.width).toBe('260px');
  });
  it('confirmação que chega depois do cancelamento é recusada com o id da transação (r2 #2)', () => {
    rt = boot(); const a = document.getElementById('a');
    const g = ponte().iniciarGesto([{ el: a, property: 'width' }]);
    ponte().terminarGesto(g.gestureId, [{ el: a, property: 'width', value: '300px' }]);
    ponte().cancelarGesto(g.gestureId, 'escape');
    expect(a.style.width).toBe('200px');
    const tardia = transacao('300px');
    rt.send('apply-transaction', { transaction: tardia, gestureId: g.gestureId });
    const nao = rt.messages.filter((m) => m.type === 'transaction-rejected').pop();
    expect(nao.payload.transactionId).toBe(tardia.id);
    expect(nao.payload.code).toBe('gesture_inactive');
    expect(a.style.width).toBe('200px');
  });
  it('um gesto vivo por vez (r4)', () => {
    rt = boot(); const a = document.getElementById('a');
    const g = ponte().iniciarGesto([{ el: a, property: 'width' }]);
    ponte().terminarGesto(g.gestureId, [{ el: a, property: 'width', value: '300px' }]);
    expect(ponte().iniciarGesto([{ el: a, property: 'width' }])).toEqual({ ok: false, motivo: 'gesture_busy' });
  });
  it('gesto órfão por 10 s volta sozinho', () => {
    vi.useFakeTimers(); rt = boot(); const a = document.getElementById('a');
    const g = ponte().iniciarGesto([{ el: a, property: 'width' }]);
    ponte().previa(g.gestureId, [{ el: a, property: 'width', value: '300px' }]);
    ponte().terminarGesto(g.gestureId, [{ el: a, property: 'width', value: '300px' }]);
    vi.advanceTimersByTime(10_001);
    expect(a.style.width).toBe('200px'); expect(ponte().gestoVivo()).toBe(false);
    vi.useRealTimers();
  });
  // Astra (Task 5) #1: a prévia escrevia num par fora da lista capturada e o cancelamento deixava o valor na página
  it('par novo na prévia tem o antes capturado antes da 1ª escrita', () => {
    rt = boot(); const a = document.getElementById('a'); const b = document.getElementById('b');
    b.style.height = '50px';
    const g = ponte().iniciarGesto([{ el: a, property: 'width' }]);
    ponte().previa(g.gestureId, [{ el: b, property: 'height', value: '80px' }]);
    ponte().cancelarGesto(g.gestureId, 'escape');
    expect(b.style.height).toBe('50px');
  });
  // Astra (Task 5) #2: confirmação recusada pela ponte deixava o gesto "confirmado" sem cancelamento
  it('confirmação que falha na ponte vira cancelamento com o motivo', () => {
    rt = boot(); const a = document.getElementById('a');
    const g = ponte().iniciarGesto([{ el: a, property: 'width' }]);
    ponte().previa(g.gestureId, [{ el: a, property: 'width', value: '300px' }]);
    ponte().terminarGesto(g.gestureId, [{ el: a, property: 'width', value: '300px' }]);
    const quebrada = createTransaction({ patches: [createPatch({ elementId: 'u-nao-existe', kind: 'style', property: 'width', before: '', value: '1px' })], source: 'overlay' });
    rt.send('apply-transaction', { transaction: quebrada, gestureId: g.gestureId });
    expect(rt.messages.some((m) => m.type === 'transaction-rejected')).toBe(true);
    expect(rt.messages.some((m) => m.type === 'overlay-gesture-canceled' && m.payload.gestureId === g.gestureId && m.payload.reason === 'transaction_rejected')).toBe(true);
    expect(ponte().gestoVivo()).toBe(false);
    expect(a.style.width).toBe('200px');
  });
});
