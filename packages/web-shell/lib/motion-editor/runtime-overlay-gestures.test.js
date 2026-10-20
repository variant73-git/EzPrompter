// Gestos da camada de alças e guias com a ponte real (jsdom; o navegador real fica na etapa 11 do plano).
// Spec 2026-10-20 §5.2-§5.3; paridade com packages/editor-core/src/editor.js.
import { afterEach, describe, expect, it } from 'vitest';
import { MOTION_EDITOR_PROTOCOL, MOTION_EDITOR_PROTOCOL_V2, SUPPORTED_MOTION_EDITOR_PROTOCOLS, commandV2 } from './protocol.js';
import { getRuntimeBridgeSource } from './runtime-bridge-source.js';

function boot(html) {
  document.body.innerHTML = html || '<main id="m" data-uncraft-id="u-m"><div id="a" data-uncraft-id="u-a" style="width:200px;height:100px">A</div><div id="b" data-uncraft-id="u-b">B</div></main>';
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

// a caixa acompanha o estilo inline (o jsdom não faz layout)
function caixaViva(el, x, y) {
  el.getBoundingClientRect = () => {
    const w = parseFloat(el.style.width) || 0; const h = parseFloat(el.style.height) || 0;
    return { left: x, top: y, right: x + w, bottom: y + h, width: w, height: h, x, y };
  };
}
const ponteiro = (alvo, tipo, x, y, extra = {}) => alvo.dispatchEvent(new MouseEvent(tipo, { bubbles: true, composed: true, cancelable: true, clientX: x, clientY: y, button: 0, ...extra }));

describe('arrastar os quadradinhos (spec §5.2)', () => {
  let rt; afterEach(() => rt?.restore());
  it('alça leste +40 → UMA edição com largura 240px e a altura mantida', () => {
    rt = boot(); const a = document.getElementById('a'); caixaViva(a, 10, 10);
    rt.send('select-element', { elementId: 'u-a' });
    const alca = window.__uncraftMotionBridge.overlay.alcaParaTeste('e');
    ponteiro(alca, 'pointerdown', 210, 60);
    ponteiro(document, 'pointermove', 230, 60);
    ponteiro(document, 'pointermove', 250, 60);
    expect(a.style.width).toBe('240px');                 // prévia na tela
    ponteiro(document, 'pointerup', 250, 60);
    const fins = rt.messages.filter((m) => m.type === 'overlay-gesture-ended');
    expect(fins).toHaveLength(1);
    const w = fins[0].payload.changes.find((c) => c.elementId === 'u-a' && c.property === 'width');
    const h = fins[0].payload.changes.find((c) => c.elementId === 'u-a' && c.property === 'height');
    expect(w).toMatchObject({ before: '200px', value: '240px' });
    expect(h).toMatchObject({ value: '100px' });
  });
  it('clique sem passar de 2 px não emite nada', () => {
    rt = boot(); const a = document.getElementById('a'); caixaViva(a, 10, 10);
    rt.send('select-element', { elementId: 'u-a' });
    const alca = window.__uncraftMotionBridge.overlay.alcaParaTeste('e');
    ponteiro(alca, 'pointerdown', 210, 60); ponteiro(document, 'pointermove', 211, 61); ponteiro(document, 'pointerup', 211, 61);
    expect(rt.messages.some((m) => m.type === 'overlay-gesture-ended')).toBe(false);
    expect(a.style.width).toBe('200px');
  });
  it('Esc no meio do arraste devolve tudo', () => {
    rt = boot(); const a = document.getElementById('a'); caixaViva(a, 10, 10);
    rt.send('select-element', { elementId: 'u-a' });
    const alca = window.__uncraftMotionBridge.overlay.alcaParaTeste('se');
    ponteiro(alca, 'pointerdown', 210, 110); ponteiro(document, 'pointermove', 260, 160);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(a.style.width).toBe('200px');
    expect(rt.messages.some((m) => m.type === 'overlay-gesture-ended')).toBe(false);
  });
  it('alça oeste compensa na margem esquerda (lado direito fica no lugar)', () => {
    rt = boot(); const a = document.getElementById('a'); caixaViva(a, 10, 10);
    rt.send('select-element', { elementId: 'u-a' });
    const alca = window.__uncraftMotionBridge.overlay.alcaParaTeste('w');
    ponteiro(alca, 'pointerdown', 10, 60); ponteiro(document, 'pointermove', 40, 60); ponteiro(document, 'pointerup', 40, 60);
    const fim = rt.messages.filter((m) => m.type === 'overlay-gesture-ended').pop();
    expect(fim.payload.changes.find((c) => c.property === 'width')).toMatchObject({ value: '170px' });
    expect(fim.payload.changes.find((c) => c.property === 'margin-left')).toMatchObject({ value: '30px' });
  });
  it('elemento em linha (não substituído): quadradinhos apagados e nenhum gesto', () => {
    rt = boot('<p><span id="s" data-uncraft-id="u-s" style="display:inline">texto</span></p>');
    const s = document.getElementById('s'); caixaViva(s, 0, 0);
    rt.send('select-element', { elementId: 'u-s' });
    expect(window.__uncraftMotionBridge.overlay.estado().alcasApagadas).toBe('inline_element');
    const alca = window.__uncraftMotionBridge.overlay.alcaParaTeste('e');
    ponteiro(alca, 'pointerdown', 0, 0); ponteiro(document, 'pointermove', 30, 0); ponteiro(document, 'pointerup', 30, 0);
    expect(rt.messages.some((m) => m.type === 'overlay-gesture-ended')).toBe(false);
  });
  // Astra (Task 8): ponteiro cancelado (ou captura perdida) deixava o gesto vivo — e um movimento depois, sem botão,
  // ainda redimensionava; um pointerup qualquer mandava a edição abandonada
  it.each(['pointercancel', 'lostpointercapture'])('%s cancela o arraste e nada depois mexe ou envia', (tipo) => {
    rt = boot(); const a = document.getElementById('a'); caixaViva(a, 10, 10);
    rt.send('select-element', { elementId: 'u-a' });
    const alca = window.__uncraftMotionBridge.overlay.alcaParaTeste('e');
    ponteiro(alca, 'pointerdown', 210, 60); ponteiro(document, 'pointermove', 250, 60);
    expect(a.style.width).toBe('240px');
    ponteiro(tipo === 'pointercancel' ? document : alca, tipo, 250, 60);
    expect(window.__uncraftMotionBridge.overlay.ponteParaTeste().gestoVivo()).toBe(false);
    expect(a.style.width).toBe('200px');
    ponteiro(document, 'pointermove', 300, 60);
    ponteiro(document, 'pointerup', 300, 60);
    expect(a.style.width).toBe('200px');
    expect(rt.messages.some((m) => m.type === 'overlay-gesture-ended')).toBe(false);
  });
});
