# Plano visual nativo (opção b) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a site's WebGL/canvas scenes in the canonical (editable) clone by running the native clone as ONE closed visual layer — only its canvases visible — beside the canonical page, with scroll kept in sync, the layer placed in front of or behind the content per site, and the regions coupled to the scene reported so the editor can lock their layout (product decision 1, Adilson 2026-10-05).

**Architecture:** The native bundle is never modified. A *plane mode* is injected at serve time (gateway option / harness route): a stylesheet that hides everything but `<canvas>` and makes the page transparent, plus a bootstrap that obeys scroll-state messages from its parent and announces readiness. A *host* module mounts the plane iframe (from a different origin = a different process) as a fixed layer, posts one state packet per animation frame, waits for readiness with a timeout (no ready → the layer is removed and the canonical stands alone) and reports drift of coupled regions. An *analysis* step runs at normalization time with the real GPU: it decides placement (`back` when the plane paints most of the viewport, `front` otherwise), lists the canvases the plane owns (never the ones a `sequencia` ficha already plays) and the canonical elements coupled to the scene, and writes `plano.json` next to the canonical page. The visual gate composes canonical + plane to measure it.

**Tech Stack:** Node 25 ESM scripts, Playwright (`channel: 'chromium'` + `--use-angle=metal` for real GPU), Vitest, plain browser JS for the injected code (no build step).

**Spec:** `docs/superpowers/plans/2026-09-29-verbatim-agente-fatia-1.md` §178 (experiment, measurements, decisions) and the Codex advice summarised there. Decision 1 (lock layout in WebGL-coupled regions; text/colour/font stay editable) is the product rule; enforcement inside the editor UI is a later plan — v0 produces the metadata and the drift signal.

## Global Constraints

- The native bundle on disk is never mutated; plane mode is derived at serve time.
- The plane is served from a DIFFERENT origin than the canonical page (measured: same origin → the heavy native froze the canonical).
- No CSP relaxation and no network escape: remote requests are only served from the capture's own `ALHEIOS` map (offline closure); anything else is aborted and counted.
- WebGL is measured with the real GPU only (`channel: 'chromium'`, `--use-angle=metal --enable-gpu --ignore-gpu-blocklist`); SwiftShader froze or took 87 s per frame.
- One owner per canvas: a canvas played by a `sequencia` ficha is excluded from the plane.
- v0 = document-scroll sites only. Virtual-scroll WebGL-only sites (wheel drives the scene, `scrollY` stays 0), pointer interaction and multiple planes are out of scope.
- `back` placement: `body { isolation: isolate }` and the plane at `z-index: -1` inside it — between the page background and the content. Never `z-index: -1` without the isolated body.
- Product UI text in English; code comments and docs in Portuguese, like the surrounding code.

## Review Focus

- The plane never becomes ready (preloader stuck, script missing): the host must remove the layer after the timeout and the canonical must look exactly as it does without a plane — never a blank or frozen layer on top.
- A `message` from another frame or origin carrying `{tipo:'u-plano-estado'}` must be ignored by the plane, and a ready message from anyone but the plane iframe must be ignored by the host.
- The canonical scrolled past the native page's height (canonical taller after a text edit): the plane must clamp (`scrollTo` past the end is harmless) and the host must report drift, not throw.
- A site whose native has no drawing canvas (only empty or 300×150 uninitialised canvases): no `plano.json`, no iframe, nothing changes.
- A site where a `sequencia` ficha already plays a canvas: that canvas must stay hidden inside the plane so it is not drawn twice.

---

## File Structure

- Create `packages/web-shell/lib/native-plane/plane-mode.js` — the injected stylesheet + bootstrap (string builders) and `injetarModoPlano(html, opcoes)`.
- Create `packages/web-shell/lib/native-plane/plane-host.js` — `montarPlano(...)`, a self-contained browser function (also exported as source text for injection), and the message protocol constants.
- Modify `packages/web-shell/lib/motion-editor/native-clone-gateway.js` — `injectRuntimeBridge(html, config, { plano })` option that adds the plane mode (product seam).
- Create `packages/web-shell/scripts/plano-nativo.mjs` — `analisarPlano({ captura, canonica, excluirCanvas })` → `plano.json` content.
- Modify `packages/web-shell/scripts/normalizar-clone.mjs` — call the analysis and write `plano.json`; pass `sequencia` canvas ownership.
- Modify `packages/web-shell/scripts/verbatim-gate.mjs` — `--plano` composite mode for `bundle:` candidates.
- Tests: `packages/web-shell/lib/native-plane/plane-mode.test.js`, `plane-host.integration.test.js`, `packages/web-shell/scripts/plano-nativo.integration.test.js`, additions to `lib/motion-editor/native-clone-gateway.test.js`.

## Message protocol (shared by Tasks 1 and 2)

```js
// host -> plane, one per animation frame of the host page
{ tipo: 'u-plano-estado', seq: <int, strictly increasing>, y: <number, host scrollY> }
// plane -> host, once, when the document loaded, fonts settled and 2 frames rendered
{ tipo: 'u-plano-pronto', canvas: <int, visible canvases> }
// plane -> host, after every applied state (the native page's real scroll after clamping)
{ tipo: 'u-plano-rolou', seq: <int>, y: <number> }
```

---

### Task 1: Plane mode (derived, injected at serve time)

**Files:**
- Create: `packages/web-shell/lib/native-plane/plane-mode.js`
- Test: `packages/web-shell/lib/native-plane/plane-mode.test.js`
- Modify: `packages/web-shell/lib/motion-editor/native-clone-gateway.js` (`injectRuntimeBridge`)
- Test: `packages/web-shell/lib/motion-editor/native-clone-gateway.test.js`

**Interfaces:**
- Consumes: `leadingDoctypeEnd(html)` from `lib/native-clone/doctype-anchor.js`.
- Produces: `bootstrapDoPlano({ excluirCanvas = [] }) -> string` (a `<style data-u-plano>` + `<script data-u-plano>`), `injetarModoPlano(html, { excluirCanvas = [] }) -> string` (idempotent), and `injectRuntimeBridge(html, config, { plano: { excluirCanvas } })`. `excluirCanvas` = indices of `<canvas>` elements in document order that the plane must keep hidden.

- [ ] **Step 1: Write the failing tests**

```js
// packages/web-shell/lib/native-plane/plane-mode.test.js
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { injetarModoPlano } from './plane-mode.js';

describe('injetarModoPlano', () => {
  it('entra logo depois do doctype, antes de qualquer script do site, e e idempotente', () => {
    const h = '<!doctype html><html><head><script>window.site=1</script></head><body></body></html>';
    const a = injetarModoPlano(h);
    expect(a.indexOf('data-u-plano')).toBeLessThan(a.indexOf('window.site'));
    expect(a.indexOf('data-u-plano')).toBeGreaterThan(a.toLowerCase().indexOf('<!doctype html>'));
    expect(injetarModoPlano(a)).toBe(a);
  });
});

describe('modo plano no navegador', () => {
  let browser;
  beforeAll(async () => { const { chromium } = await import('playwright-core'); browser = await chromium.launch(); });
  afterAll(async () => { if (browser) await browser.close(); });
  const pagina = (extra = '') => injetarModoPlano(`<!doctype html><html><head></head><body style="background:rgb(9, 9, 9);height:3000px"><p id="t">texto</p><canvas id="c0" width="10" height="10"></canvas><canvas id="c1" width="10" height="10"></canvas>${extra}</body></html>`, { excluirCanvas: [1] });
  it('so os canvas do plano ficam visiveis; o fundo fica transparente; o canvas excluido some', async () => {
    const p = await browser.newPage(); await p.setContent(pagina());
    const v = await p.evaluate(() => ({ texto: getComputedStyle(document.getElementById('t')).visibility, c0: getComputedStyle(document.getElementById('c0')).visibility, c1: getComputedStyle(document.getElementById('c1')).visibility, fundo: getComputedStyle(document.body).backgroundColor }));
    expect(v).toEqual({ texto: 'hidden', c0: 'visible', c1: 'hidden', fundo: 'rgba(0, 0, 0, 0)' });
    await p.close();
  });
  it('obedece estado SO do pai, com seq crescente, e responde onde de fato rolou', async () => {
    const p = await browser.newPage();
    await p.setContent(`<iframe id="f" style="width:400px;height:300px" srcdoc="${pagina().replace(/"/g, '&quot;')}"></iframe>`);
    const f = p.frames()[1]; await f.waitForLoadState('load');
    const r = await p.evaluate(() => new Promise((ok) => {
      const fw = document.getElementById('f').contentWindow; const vistos = [];
      addEventListener('message', (e) => { if (e.source === fw && e.data && e.data.tipo === 'u-plano-rolou') vistos.push(e.data); });
      fw.postMessage({ tipo: 'u-plano-estado', seq: 2, y: 500 }, '*');
      fw.postMessage({ tipo: 'u-plano-estado', seq: 1, y: 900 }, '*');   // velho: ignorado
      setTimeout(() => ok(vistos), 400);
    }));
    expect(r.map((x) => x.seq)).toEqual([2]); expect(r[0].y).toBe(500);
    expect(await f.evaluate(() => scrollY)).toBe(500);
    await p.close();
  });
  it('anuncia pronto ao pai, uma vez', async () => {
    const p = await browser.newPage();
    const prontos = await p.evaluate((html) => new Promise((ok) => {
      const n = []; addEventListener('message', (e) => { if (e.data && e.data.tipo === 'u-plano-pronto') n.push(e.data); });
      const f = document.createElement('iframe'); f.srcdoc = html; document.body.appendChild(f);
      setTimeout(() => ok(n), 1500);
    }), pagina());
    expect(prontos.length).toBe(1); expect(prontos[0].canvas).toBe(1);
    await p.close();
  });
});
```

```js
// add to packages/web-shell/lib/motion-editor/native-clone-gateway.test.js
it('injectRuntimeBridge com { plano } inclui o modo plano e nao inclui o editor completo', () => {
  const out = injectRuntimeBridge('<!doctype html><html><head></head><body></body></html>', null, { plano: { excluirCanvas: [] }, fullEditor: true });
  expect(out).toContain('data-u-plano');
  expect(out).not.toContain('data-uncraft-full-editor');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/web-shell && npx vitest run lib/native-plane/plane-mode.test.js lib/motion-editor/native-clone-gateway.test.js`
Expected: FAIL — `Cannot find module './plane-mode.js'` and the gateway test fails (no `data-u-plano`).

- [ ] **Step 3: Implement**

```js
// packages/web-shell/lib/native-plane/plane-mode.js
// MODO PLANO (opcao b, 2026-10-05): o clone NATIVO servido como camada visual — so os canvas aparecem,
// a pagina fica transparente, e quem manda na rolagem e o pai. Derivado na ENTREGA: o pacote nativo
// nunca e alterado. Protocolo: u-plano-estado (pai -> plano), u-plano-pronto / u-plano-rolou (plano -> pai).
import { leadingDoctypeEnd } from '../native-clone/doctype-anchor.js';

export function bootstrapDoPlano({ excluirCanvas = [] } = {}) {
  const fora = JSON.stringify((excluirCanvas || []).filter((n) => Number.isInteger(n) && n >= 0));
  const css = 'html,body{background:transparent!important}body *{visibility:hidden!important}canvas{visibility:visible!important}canvas[data-u-plano-fora]{visibility:hidden!important}';
  const js = `(function(){
  var FORA = ${fora};
  var marcar = function () { var cs = document.getElementsByTagName('canvas'); for (var i = 0; i < cs.length; i++) { if (FORA.indexOf(i) >= 0) cs[i].setAttribute('data-u-plano-fora', ''); } };
  var reafirmar = function () { var s = document.querySelector('style[data-u-plano]'); if (s && s.parentNode) s.parentNode.appendChild(s); marcar(); };
  document.addEventListener('DOMContentLoaded', reafirmar); addEventListener('load', reafirmar);
  var ultimo = -1;
  addEventListener('message', function (e) {
    if (e.source !== window.parent || !e.data || e.data.tipo !== 'u-plano-estado') return;
    var seq = Number(e.data.seq), y = Number(e.data.y); if (!(seq > ultimo) || !isFinite(y)) return; ultimo = seq;
    if (Math.abs(scrollY - y) > 0.5) window.scrollTo({ top: y, behavior: 'instant' });
    window.parent.postMessage({ tipo: 'u-plano-rolou', seq: seq, y: scrollY }, '*');
  });
  var anunciou = false;
  var anunciar = function () { if (anunciou) return; anunciou = true; reafirmar();
    var vis = 0, cs = document.getElementsByTagName('canvas'); for (var i = 0; i < cs.length; i++) { if (!cs[i].hasAttribute('data-u-plano-fora') && cs[i].getBoundingClientRect().width > 0) vis++; }
    window.parent.postMessage({ tipo: 'u-plano-pronto', canvas: vis }, '*'); };
  addEventListener('load', function () { var f = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    f.then(function () { requestAnimationFrame(function () { requestAnimationFrame(anunciar); }); }); });
})();`;
  return `<style data-u-plano>${css}</style><script data-u-plano>${js.replace(/<\/script/gi, '<\\/script')}</script>`;
}

export function injetarModoPlano(html, opcoes = {}) {
  const h = String(html);
  if (h.includes('data-u-plano')) return h;
  const at = leadingDoctypeEnd(h);
  return `${h.slice(0, at)}${bootstrapDoPlano(opcoes)}${h.slice(at)}`;
}
```

In `native-clone-gateway.js`, import `{ bootstrapDoPlano }` from `'../native-plane/plane-mode.js'` and change `injectRuntimeBridge`:

```js
export function injectRuntimeBridge(html, runtimeConfig = null, options = {}) {
  const source = getRuntimeBridgeSource().replace(/<\/script/gi, '<\\/script');
  // modo plano: camada so de canvas — sem editor completo (ninguem edita a camada)
  const plano = options.plano && typeof options.plano === 'object' ? options.plano : null;
  const fullEditor = plano ? false : (options.fullEditor ?? fullEditorEnabled());
  const script = `<script data-uncraft-runtime-bridge>${source}</script>${fullEditor ? fullEditorTags() : ''}`;
  const securityMeta = `<meta data-uncraft-runtime-policy http-equiv="Content-Security-Policy" content="${runtimeCspMeta()}">`;
  const config = runtimeConfig && typeof runtimeConfig === 'object'
    ? `<script type="application/json" data-uncraft-runtime-config>${safeJson(runtimeConfig)}</script>`
    : '';
  const cleaned = removePriorInjection(String(html));
  const at = leadingDoctypeEnd(cleaned);
  const secured = `${cleaned.slice(0, at)}${securityMeta}${config}${plano ? bootstrapDoPlano(plano) : ''}${cleaned.slice(at)}`;
  if (/<\/body>/i.test(secured)) return secured.replace(/<\/body>/i, `${script}</body>`);
  return `${secured}${script}`;
}
```

Also make `removePriorInjection` strip a previous plane injection: add to its removals the patterns `/<style data-u-plano>[\s\S]*?<\/style>/g` and `/<script data-u-plano>[\s\S]*?<\/script>/g` (read the function first and add them in its existing style).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/web-shell && npx vitest run lib/native-plane/ lib/motion-editor/native-clone-gateway.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web-shell/lib/native-plane/plane-mode.js packages/web-shell/lib/native-plane/plane-mode.test.js packages/web-shell/lib/motion-editor/native-clone-gateway.js packages/web-shell/lib/motion-editor/native-clone-gateway.test.js
git commit -m "feat(native-plane): plane mode injected at serve time (canvas-only, parent-driven scroll, ready handshake)"
```

---

### Task 2: Plane host (mount, sync, ready timeout, drift)

**Files:**
- Create: `packages/web-shell/lib/native-plane/plane-host.js`
- Test: `packages/web-shell/lib/native-plane/plane-host.integration.test.js`

**Interfaces:**
- Consumes: the protocol above.
- Produces: `montarPlano({ doc, src, origemPlano, colocacao, acopladas = [], tempoLimiteMs = 15000 }) -> { pronto: Promise<{ pronto: boolean, motivo?: string }>, desmontar(): void }` — a function that runs IN THE PAGE (no imports, no closures over module scope); `fonteDoHost() -> string` (its source, for injection as `<script>` that calls it with config from `<script type="application/json" data-u-plano-config>`). On drift it dispatches `CustomEvent('u-plano-desalinhado', { detail: { id, dy } })` on `doc`.

- [ ] **Step 1: Write the failing test**

```js
// packages/web-shell/lib/native-plane/plane-host.integration.test.js
import { createServer } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fonteDoHost } from './plane-host.js';
import { injetarModoPlano } from './plane-mode.js';

let srv; let porta; let browser;
const NATIVO = injetarModoPlano('<!doctype html><html><head></head><body style="height:4000px;margin:0"><canvas width="100" height="100" style="position:fixed;top:0;left:0"></canvas></body></html>');
const NATIVO_TRAVADO = '<!doctype html><html><head></head><body>sem modo plano: nunca anuncia</body></html>';
const canon = (src, cfg) => `<!doctype html><html><head><script type="application/json" data-u-plano-config>${JSON.stringify({ src, ...cfg })}</script></head><body style="height:4000px;margin:0;background:rgb(10, 20, 30)"><div id="u-alvo" style="height:50px">alvo</div><script>${fonteDoHost()}</script></body></html>`;
beforeAll(async () => {
  srv = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const corpo = u.pathname === '/nativo' ? NATIVO : u.pathname === '/travado' ? NATIVO_TRAVADO : canon(u.searchParams.get('src'), JSON.parse(u.searchParams.get('cfg') || '{}'));
    res.writeHead(200, { 'content-type': 'text/html' }); res.end(corpo);
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok)); porta = srv.address().port;
  const { chromium } = await import('playwright-core'); browser = await chromium.launch();
});
afterAll(async () => { await browser.close(); await new Promise((ok) => srv.close(ok)); });
const abrir = async (src, cfg) => { const p = await browser.newPage({ viewport: { width: 800, height: 600 } }); await p.goto(`http://127.0.0.1:${porta}/?src=${encodeURIComponent(src)}&cfg=${encodeURIComponent(JSON.stringify(cfg))}`); return p; };

describe('montarPlano', () => {
  it('back: plano de OUTRA origem fica entre o fundo e o conteudo (body isolado, z -1) e acompanha a rolagem', async () => {
    const p = await abrir(`http://localhost:${porta}/nativo`, { origemPlano: `http://localhost:${porta}`, colocacao: 'back' });
    await p.waitForFunction(() => window.__uPlano && window.__uPlano.estado === 'pronto', null, { timeout: 10000 });
    const v = await p.evaluate(() => { const f = document.querySelector('iframe[data-u-plano]'); const cs = getComputedStyle(f); return { z: cs.zIndex, pos: cs.position, pe: cs.pointerEvents, iso: getComputedStyle(document.body).isolation }; });
    expect(v).toEqual({ z: '-1', pos: 'fixed', pe: 'none', iso: 'isolate' });
    await p.evaluate(() => window.scrollTo(0, 1200)); await p.waitForTimeout(400);
    const plano = p.frames().find((f) => f.url().includes('/nativo'));
    expect(await plano.evaluate(() => scrollY)).toBe(1200);
    await p.close();
  });
  it('front: plano por cima do conteudo, sem pegar o mouse', async () => {
    const p = await abrir(`http://localhost:${porta}/nativo`, { origemPlano: `http://localhost:${porta}`, colocacao: 'front' });
    await p.waitForFunction(() => window.__uPlano && window.__uPlano.estado === 'pronto', null, { timeout: 10000 });
    const v = await p.evaluate(() => ({ z: Number(getComputedStyle(document.querySelector('iframe[data-u-plano]')).zIndex), alvo: document.elementFromPoint(20, 20).id }));
    expect(v.z).toBeGreaterThan(1000); expect(v.alvo).toBe('u-alvo');
    await p.close();
  });
  it('sem pronto ate o limite: a camada SAI e a pagina fica como sem plano', async () => {
    const p = await abrir(`http://localhost:${porta}/travado`, { origemPlano: `http://localhost:${porta}`, colocacao: 'front', tempoLimiteMs: 800 });
    await p.waitForFunction(() => window.__uPlano && window.__uPlano.estado === 'sem-plano', null, { timeout: 5000 });
    expect(await p.evaluate(() => document.querySelectorAll('iframe[data-u-plano]').length)).toBe(0);
    expect(await p.evaluate(() => window.__uPlano.motivo)).toBe('tempo');
    await p.close();
  });
  it('pronto de quem NAO e o plano e ignorado', async () => {
    const p = await abrir(`http://localhost:${porta}/travado`, { origemPlano: `http://localhost:${porta}`, colocacao: 'front', tempoLimiteMs: 800 });
    await p.evaluate(() => window.postMessage({ tipo: 'u-plano-pronto', canvas: 9 }, '*'));
    await p.waitForFunction(() => window.__uPlano && window.__uPlano.estado === 'sem-plano', null, { timeout: 5000 });
    await p.close();
  });
  it('regiao acoplada que se MOVE avisa desalinhamento', async () => {
    const p = await abrir(`http://localhost:${porta}/nativo`, { origemPlano: `http://localhost:${porta}`, colocacao: 'front', acopladas: ['u-alvo'] });
    await p.waitForFunction(() => window.__uPlano && window.__uPlano.estado === 'pronto', null, { timeout: 10000 });
    const ev = await p.evaluate(() => new Promise((ok) => { document.addEventListener('u-plano-desalinhado', (e) => ok(e.detail)); const d = document.createElement('div'); d.style.height = '160px'; document.body.insertBefore(d, document.body.firstChild); setTimeout(() => ok(null), 2000); }));
    expect(ev).toMatchObject({ id: 'u-alvo', dy: 160 });
    await p.close();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/web-shell && npx vitest run lib/native-plane/plane-host.integration.test.js`
Expected: FAIL — `Cannot find module './plane-host.js'`.

- [ ] **Step 3: Implement**

```js
// packages/web-shell/lib/native-plane/plane-host.js
// HOSPEDEIRO do plano visual nativo (opcao b): monta o nativo-em-modo-plano como camada IRMA da pagina,
// de OUTRA origem (outro processo — na mesma origem o nativo pesado travou a canonica, medido), manda um
// estado por quadro, espera o pronto com limite (sem pronto: a camada SAI) e avisa quando uma regiao acoplada
// a cena se move (decisao 1 do Adilson: layout travado nessas regioes; o aviso pega o que escapar, ex. texto
// que quebra linha). `back` = body isolado + z -1: entre o fundo da pagina e o conteudo.
export function montarPlano({ doc, src, origemPlano, colocacao = 'front', acopladas = [], tempoLimiteMs = 15000 }) {
  const win = doc.defaultView; const estado = (win.__uPlano = { estado: 'montando', motivo: null });
  const f = doc.createElement('iframe');
  f.setAttribute('data-u-plano', ''); f.setAttribute('aria-hidden', 'true'); f.tabIndex = -1; f.src = src;
  f.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0;margin:0;padding:0;background:transparent;pointer-events:none;' + (colocacao === 'back' ? 'z-index:-1' : 'z-index:2147483000');
  if (colocacao === 'back') doc.body.style.isolation = 'isolate';
  doc.body.appendChild(f);
  const topo = (id) => { const e = doc.getElementById(id); return e ? e.getBoundingClientRect().top + win.scrollY : null; };
  const base = Object.fromEntries(acopladas.map((id) => [id, topo(id)]));
  const avisados = new Set();
  let seq = 0; let vivo = true;
  const laco = () => {
    if (!vivo) return;
    try { f.contentWindow.postMessage({ tipo: 'u-plano-estado', seq: ++seq, y: win.scrollY }, origemPlano); } catch (e) { /* plano ainda carregando */ }
    for (const id of acopladas) { if (avisados.has(id) || base[id] === null) continue; const t = topo(id); if (t !== null && Math.abs(t - base[id]) > 1) { avisados.add(id); doc.dispatchEvent(new win.CustomEvent('u-plano-desalinhado', { detail: { id, dy: Math.round(t - base[id]) } })); } }
    win.requestAnimationFrame(laco);
  };
  const desmontar = () => { vivo = false; if (f.parentNode) f.parentNode.removeChild(f); if (colocacao === 'back') doc.body.style.isolation = ''; };
  const pronto = new Promise((ok) => {
    const ouvir = (e) => {
      if (e.source !== f.contentWindow || e.origin !== origemPlano || !e.data || e.data.tipo !== 'u-plano-pronto') return;
      win.removeEventListener('message', ouvir); win.clearTimeout(t); estado.estado = 'pronto'; ok({ pronto: true });
    };
    const t = win.setTimeout(() => { win.removeEventListener('message', ouvir); desmontar(); estado.estado = 'sem-plano'; estado.motivo = 'tempo'; ok({ pronto: false, motivo: 'tempo' }); }, tempoLimiteMs);
    win.addEventListener('message', ouvir);
  });
  win.requestAnimationFrame(laco);
  return { pronto, desmontar };
}

// fonte para injecao: le a configuracao de <script type="application/json" data-u-plano-config>
export function fonteDoHost() {
  return `(${montarPlano.toString()})(Object.assign({ doc: document }, JSON.parse(document.querySelector('script[data-u-plano-config]').textContent)));`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/web-shell && npx vitest run lib/native-plane/`
Expected: PASS (all plane-mode and plane-host tests).

- [ ] **Step 5: Commit**

```bash
git add packages/web-shell/lib/native-plane/plane-host.js packages/web-shell/lib/native-plane/plane-host.integration.test.js
git commit -m "feat(native-plane): host mounts the plane from another origin, syncs scroll, times out, reports drift"
```

---

### Task 3: Plane analysis (placement, owned canvases, coupled regions) → `plano.json`

**Files:**
- Create: `packages/web-shell/scripts/plano-nativo.mjs`
- Test: `packages/web-shell/scripts/plano-nativo.integration.test.js`

**Interfaces:**
- Consumes: `injetarModoPlano` (Task 1); `servir(dir)` from `scripts/inventario-conteudo.mjs` (returns `{ srv, origem }`, static server on 127.0.0.1); `mapaDaCaptura(html)` / `arquivoCapturado(porUrl, url)` from `scripts/normalizar-clone.mjs`.
- Produces: `analisarPlano({ captura, canonica, excluirCanvas = [], ys = null }) -> Promise<null | { versao: 1, colocacao: 'back'|'front', cobertura: number, canvas: number, excluirCanvas: number[], acoplamento: 'viewport'|'ancoras', acopladas: string[], prontoMs: number, externosAbortados: number }>` — `null` when the native has no drawing canvas. `cobertura` = fraction of viewport pixels the plane paints (alpha > 0) averaged over the sampled scroll positions; `colocacao = cobertura >= 0.6 ? 'back' : 'front'`; `acopladas` = ids of canonical elements with no text, no `img`/`svg`/`video`, area ≥ 2000 px², whose rect is ≥ 50% painted by the plane at some sampled position; `acoplamento = 'ancoras'` if `acopladas.length` else `'viewport'`.

- [ ] **Step 1: Write the failing test**

```js
// packages/web-shell/scripts/plano-nativo.integration.test.js
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analisarPlano } from './plano-nativo.mjs';

// canvas 2D desenha retangulos EXATAMENTE sobre caixas vazias do DOM (ancoras) — e o que o WebGL do
// gilhuybrecht faz; o canvas opaco de tela cheia e o fundo do landonorris
const desenha = (corpo, script) => `<!doctype html><html><head></head><body style="margin:0;height:2400px">${corpo}<canvas id="c" style="position:fixed;inset:0" width="1440" height="1200"></canvas><script>addEventListener('load',()=>{const c=document.getElementById('c'),g=c.getContext('2d');(function q(){g.clearRect(0,0,1440,1200);${script};requestAnimationFrame(q)})()})</script></body></html>`;
const pasta = (nativoHtml, canonHtml) => { const d = mkdtempSync(join(tmpdir(), 'u-plano-')); mkdirSync(join(d, 'n')); mkdirSync(join(d, 'c')); writeFileSync(join(d, 'n', 'index.html'), nativoHtml); writeFileSync(join(d, 'c', 'index.html'), canonHtml); return { captura: join(d, 'n'), canonica: join(d, 'c') }; };
const CAIXAS = '<div id="u-a" style="position:absolute;top:100px;left:100px;width:300px;height:200px"></div><div id="u-b" style="position:absolute;top:100px;left:600px;width:300px;height:200px"><p>legenda</p></div>';

describe('analisarPlano (navegador real, placa de video)', () => {
  it('cena sobre ANCORAS: front, e so a caixa vazia pintada e acoplada (a que tem texto nao)', async () => {
    const { captura, canonica } = pasta(desenha(CAIXAS, "g.fillStyle='red';g.fillRect(100,100-scrollY,300,200);g.fillRect(600,100-scrollY,300,200)"), `<!doctype html><html><body style="margin:0;height:2400px">${CAIXAS}</body></html>`);
    const r = await analisarPlano({ captura, canonica, ys: [0] });
    expect(r).toMatchObject({ versao: 1, colocacao: 'front', acoplamento: 'ancoras', acopladas: ['u-a'], canvas: 1 });
    expect(r.cobertura).toBeLessThan(0.2);
  }, 120000);
  it('cena de FUNDO opaca: back, acoplamento viewport', async () => {
    const { captura, canonica } = pasta(desenha('', "g.fillStyle='rgb(217,217,210)';g.fillRect(0,0,1440,1200)"), '<!doctype html><html><body style="margin:0;height:2400px"><p>conteudo</p></body></html>');
    const r = await analisarPlano({ captura, canonica, ys: [0] });
    expect(r).toMatchObject({ colocacao: 'back', acoplamento: 'viewport', acopladas: [] });
    expect(r.cobertura).toBeGreaterThan(0.9);
  }, 120000);
  it('sem canvas que desenha: null', async () => {
    const { captura, canonica } = pasta('<!doctype html><html><body><canvas width="300" height="150"></canvas><p>x</p></body></html>', '<!doctype html><html><body><p>x</p></body></html>');
    expect(await analisarPlano({ captura, canonica, ys: [0] })).toBeNull();
  }, 120000);
  it('canvas EXCLUIDO (dono = ficha sequencia) nao conta', async () => {
    const { captura, canonica } = pasta(desenha('', "g.fillStyle='red';g.fillRect(0,0,1440,1200)"), '<!doctype html><html><body></body></html>');
    expect(await analisarPlano({ captura, canonica, excluirCanvas: [0], ys: [0] })).toBeNull();
  }, 120000);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/web-shell && npx vitest run scripts/plano-nativo.integration.test.js`
Expected: FAIL — `Cannot find module './plano-nativo.mjs'`.

- [ ] **Step 3: Implement**

```js
// packages/web-shell/scripts/plano-nativo.mjs
// ANALISE do plano visual nativo (opcao b, 2026-10-05): roda o nativo em MODO PLANO (so canvas, fundo
// transparente) com a PLACA DE VIDEO real e mede o que ele pinta. `back` quando o plano cobre a maior
// parte da tela (cena de fundo, landonorris); `front` quando pinta pedacos (gilhuybrecht). As caixas
// VAZIAS da canonica pintadas pelo plano sao as ancoras da cena: o editor trava o layout delas (decisao 1).
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { servir } from './inventario-conteudo.mjs';
import { mapaDaCaptura, arquivoCapturado } from './normalizar-clone.mjs';
import { injetarModoPlano } from '../lib/native-plane/plane-mode.js';

export const GPU = { channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] };

export async function analisarPlano({ captura, canonica, excluirCanvas = [], ys = null }) {
  const html = await readFile(path.join(captura, 'index.html'), 'utf8');
  const porUrl = mapaDaCaptura(html);
  const { srv, origem } = await servir(path.resolve(captura));
  const canon = await servir(path.resolve(canonica));
  const b = await chromium.launch(GPU);
  try {
    const p = await b.newPage({ viewport: { width: 1440, height: 1200 } });
    let externosAbortados = 0;
    await p.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (r) => { const l = arquivoCapturado(porUrl, r.request().url()); if (!l || !existsSync(path.join(captura, l))) { externosAbortados += 1; return r.abort(); } return r.fulfill({ path: path.join(captura, l) }); });
    await p.route(`${origem}/index.html`, (r) => r.fulfill({ contentType: 'text/html', body: injetarModoPlano(html, { excluirCanvas }) }));
    const t0 = Date.now();
    const pronto = p.evaluate(() => new Promise((ok) => addEventListener('message', (e) => { if (e.data && e.data.tipo === 'u-plano-pronto') ok(e.data); })));   // o proprio topo recebe: parent === window
    await p.goto(`${origem}/index.html`, { waitUntil: 'load', timeout: 60000 });
    const anuncio = await Promise.race([pronto, new Promise((ok) => setTimeout(() => ok(null), 15000))]);
    const prontoMs = Date.now() - t0;
    if (!anuncio || !anuncio.canvas) return null;
    const altura = await p.evaluate(() => document.documentElement.scrollHeight);
    const posicoes = ys || [0, Math.max(0, Math.round(altura / 2 - 600))];
    // canonica numa segunda pagina, nas mesmas posicoes: caixas vazias candidatas a ancora
    const pc = await b.newPage({ viewport: { width: 1440, height: 1200 } });
    await pc.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    await pc.goto(`${canon.origem}/index.html`, { waitUntil: 'load' });
    let somaCobertura = 0; const acopladas = new Set();
    for (const y of posicoes) {
      await p.evaluate((yy) => window.scrollTo({ top: yy, behavior: 'instant' }), y); await pc.evaluate((yy) => window.scrollTo({ top: yy, behavior: 'instant' }), y);
      await p.waitForTimeout(1200);
      const png = await p.screenshot({ omitBackground: true });
      const mascara = await pc.evaluate(async (b64) => {
        const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, c.width, c.height).data; let pintados = 0;
        const pintado = (x, y) => d[(y * c.width + x) * 4 + 3] > 8;
        for (let y = 0; y < c.height; y += 4) for (let x = 0; x < c.width; x += 4) if (pintado(x, y)) pintados += 1;
        const cobertura = pintados / (Math.ceil(c.height / 4) * Math.ceil(c.width / 4));
        const ancoras = [];
        for (const e of document.body.querySelectorAll('[id^="u-"]')) {
          if (e.textContent.trim() || e.querySelector('img,svg,video') || /^(IMG|SVG|VIDEO|CANVAS)$/i.test(e.tagName)) continue;
          const r = e.getBoundingClientRect(); if (r.width * r.height < 2000 || r.bottom < 0 || r.top > innerHeight) continue;
          let dentro = 0; let total = 0;
          for (let y = Math.max(0, Math.floor(r.top)); y < Math.min(c.height, r.bottom); y += 4) for (let x = Math.max(0, Math.floor(r.left)); x < Math.min(c.width, r.right); x += 4) { total += 1; if (pintado(x, y)) dentro += 1; }
          if (total && dentro / total >= 0.5) ancoras.push(e.id);
        }
        return { cobertura, ancoras };
      }, png.toString('base64'));
      somaCobertura += mascara.cobertura; for (const id of mascara.ancoras) acopladas.add(id);
    }
    const cobertura = somaCobertura / posicoes.length;
    const colocacao = cobertura >= 0.6 ? 'back' : 'front';
    // cena de fundo pinta tudo: "ancora" ali e so coincidencia — o acoplamento e com a tela
    const lista = colocacao === 'back' ? [] : [...acopladas].sort();
    return { versao: 1, colocacao, cobertura: Math.round(cobertura * 1000) / 1000, canvas: anuncio.canvas, excluirCanvas, acoplamento: lista.length ? 'ancoras' : 'viewport', acopladas: lista, prontoMs, externosAbortados };
  } finally { await b.close(); srv.close(); canon.srv.close(); }
}
```

Note for the implementer: in the analysis the plane page is the TOP document, so `window.parent === window` and the bootstrap's `postMessage` to the parent reaches the page itself — that is why `pronto` listens on the top window.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/web-shell && npx vitest run scripts/plano-nativo.integration.test.js`
Expected: PASS (4 tests). If the GPU channel is unavailable on the machine, the launch throws — that is a hard failure by design (WebGL must not be measured on SwiftShader).

- [ ] **Step 5: Commit**

```bash
git add packages/web-shell/scripts/plano-nativo.mjs packages/web-shell/scripts/plano-nativo.integration.test.js
git commit -m "feat(native-plane): analysis decides placement and lists the regions coupled to the scene"
```

---

### Task 4: The normalizer writes `plano.json` (with canvas ownership)

**Files:**
- Modify: `packages/web-shell/scripts/normalizar-clone.mjs` (`normalizarCaptura`, after the canonical is written and the motion programs exist)
- Test: `packages/web-shell/scripts/caminhos-movimento.test.js`

**Interfaces:**
- Consumes: `analisarPlano` (Task 3); the `sequencia` fichas of the motion program (each has `alvo: '#<canvas id>'`); `mapasDaPagina(page)` mapping (`data-u-rec` → canonical id).
- Produces: `<saida>/plano.json` (shape of Task 3) when `analisarPlano` returns non-null; the report gains `relatorio.plano = { colocacao, acopladas: n } | null`. CLI flag `--sem-plano` disables it.

- [ ] **Step 1: Write the failing test**

```js
// add to scripts/caminhos-movimento.test.js
import { indicesDeCanvasDaSequencia } from './normalizar-clone.mjs';
describe('dono de canvas: o que a ficha sequencia toca nao vai para o plano', () => {
  it('converte o alvo das fichas sequencia no indice do canvas na pagina nativa', () => {
    const fichas = [{ tipo: 'sequencia', alvo: '#u-pg-canvas-canvas-2' }, { alvo: '#u-x', de: { opacity: 0 } }];
    const canvasIds = ['u-pg-canvas-canvas', 'u-pg-canvas-canvas-2', 'u-pg-canvas-canvas-3'];   // ordem do documento
    expect(indicesDeCanvasDaSequencia(fichas, canvasIds)).toEqual([1]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/web-shell && npx vitest run scripts/caminhos-movimento.test.js -t "dono de canvas"`
Expected: FAIL — `indicesDeCanvasDaSequencia is not a function`.

- [ ] **Step 3: Implement**

In `normalizar-clone.mjs` add (module scope, near `fichasDeSequencia`):

```js
// DONO DE CANVAS (plano visual nativo): o canvas que uma ficha `sequencia` toca nao pode ser desenhado
// tambem pelo plano. A pagina nativa nao tem os nossos ids: o indice do canvas na ORDEM DO DOCUMENTO e o
// mesmo nos dois lados (a canonica copia os <canvas> na mesma ordem).
export function indicesDeCanvasDaSequencia(fichas, canvasIdsEmOrdem) {
  const alvos = new Set(fichas.filter((f) => f.tipo === 'sequencia').map((f) => String(f.alvo).replace(/^#/, '')));
  return canvasIdsEmOrdem.map((id, i) => (alvos.has(id) ? i : -1)).filter((i) => i >= 0);
}
```

In `normalizarCaptura`, immediately before its final `return { ...r.relatorio, movimento: mov, arquivosCopiados: copiados, ... }` (the motion files — including the `sequencia` fichas, which every program carries — are already written there), add:

```js
    if (!process.argv.includes('--sem-plano')) {
      const { analisarPlano } = await import('./plano-nativo.mjs');
      const canvasIds = await page.evaluate(() => Array.from(document.querySelectorAll('canvas')).map((c) => c.getAttribute('data-u-id')).filter(Boolean));
      let fichasMotion = [];
      try { fichasMotion = JSON.parse(await readFile(path.join(saida, 'motion.json'), 'utf8')).fichas || []; } catch { fichasMotion = []; }
      const plano = await analisarPlano({ captura, canonica: saida, excluirCanvas: indicesDeCanvasDaSequencia(fichasMotion, canvasIds) });
      if (plano) await writeFile(path.join(saida, 'plano.json'), JSON.stringify({ ...plano, nativo: path.resolve(captura) }, null, 1));
      relPlano = plano ? { colocacao: plano.colocacao, acopladas: plano.acopladas.length } : null;
    }
```

Declare `let relPlano = null;` just above that block and add `plano: relPlano` to the returned object: `return { ...r.relatorio, movimento: mov, plano: relPlano, arquivosCopiados: copiados, ... }`. `nativo` records where the native assets live so the gate can serve them (Task 5).

- [ ] **Step 4: Run tests**

Run: `cd packages/web-shell && npx vitest run scripts/ lib/motion-program/ lib/native-plane/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web-shell/scripts/normalizar-clone.mjs packages/web-shell/scripts/caminhos-movimento.test.js
git commit -m "feat(native-plane): normalizer writes plano.json, keeping sequencia canvases out of the plane"
```

---

### Task 5: Gate composite mode (`--plano`)

**Files:**
- Modify: `packages/web-shell/scripts/verbatim-gate.mjs` (`measure` and the `bundle:` candidate branch)
- Test: manual run (Step 4) — the gate has no unit harness for `measure`.

**Interfaces:**
- Consumes: `<bundle>/assets/plano.json` (Task 4), `fonteDoHost()` (Task 2), `injetarModoPlano` (Task 1), `mapaDaCaptura`/`arquivoCapturado`.
- Produces: with `--plano`, a candidate bundle that has `plano.json` is measured as canonical + plane: a second `serveDirectory` on host `localhost` serves `plano.nativo` with plane mode injected into `index.html`; the canonical `index.html` gets `<script type="application/json" data-u-plano-config>` + the host script; the browser launches with the GPU options; remote requests from the plane are fulfilled only from the capture map. Report gains `plano: { colocacao, pronto, externosAbortados }`.

- [ ] **Step 1: Implement**

In `measure({ ... })` add parameter `plano = null`. When `plano`:
1. `const nativoSrv = await serveDirectory(plano.nativo, { onRequest: () => {} });` and `const origemPlano = nativoSrv.origin.replace('127.0.0.1', 'localhost');`.
2. Launch: `const browser = await chromium.launch(plano ? { headless: true, channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] } : { headless: true, channel: 'chrome' });`.
3. In the `context.route('**/*', ...)` allow list, also allow `origemPlano`; for any other URL when `plano` is set, fulfil from `arquivoCapturado(mapaDaCaptura(<native index.html>), url)` if the file exists under `plano.nativo`, else abort and count `plano.externosAbortados`.
4. Route `${origemPlano}/index.html` → fulfil with `injetarModoPlano(nativeHtml, { excluirCanvas: plano.excluirCanvas })`.
5. Route `${served.origin}/index.html` → fulfil the canonical HTML with, inserted before `</body>`: `<script type="application/json" data-u-plano-config>${JSON.stringify({ src: `${origemPlano}/index.html`, origemPlano, colocacao: plano.colocacao, acopladas: plano.acopladas })}</script><script>${fonteDoHost()}</script>`.
6. Before the trajectory, wait up to 20 s for `window.__uPlano && window.__uPlano.estado !== 'montando'` and record `plano.pronto = estado === 'pronto'`.

In the `bundle:` branch: `const planoFile = path.join(assets, 'plano.json'); const plano = process.argv.includes('--plano') && existsSync(planoFile) ? JSON.parse(await readFile(planoFile, 'utf8')) : null;` and pass `plano` to `measure`.

- [ ] **Step 2: Run the existing gate tests (no regression)**

Run: `cd packages/web-shell && npx vitest run scripts/verbatim-gate.test.js`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/web-shell/scripts/verbatim-gate.mjs
git commit -m "feat(native-plane): gate measures canonical + plane with the real GPU (--plano)"
```

- [ ] **Step 4: Measure** (Task 6 uses this)

---

### Task 6: Measure on the real sites and record

**Files:**
- Modify: `docs/superpowers/plans/2026-09-29-verbatim-agente-fatia-1.md` (new section)

- [ ] **Step 1: Normalize with the plane** (captures already on disk: `_verbatim/fr-gil`, `_verbatim/fr-lando`, `_verbatim/fr2-bleibt`, `_verbatim/native3` = farmminerals)

```bash
cd packages/web-shell
for s in "gil fr-gil" "lando fr-lando" "bleibt fr2-bleibt" "farm native3"; do bash -c "set -- $s; node scripts/normalizar-clone.mjs --captura _verbatim/\$2/assets --saida _verbatim/plano-\$1/assets --movimento=todos --passo 100 > _verbatim/plano-\$1.log 2>&1; echo \$1 \$?; cat _verbatim/plano-\$1/assets/plano.json 2>/dev/null | head -12"; done
```

Expected: `plano.json` for gil (`front`, `ancoras`), lando (`back`, `viewport`), bleibt (`front`); NO `plano.json` for farm (no drawing canvas outside its `sequencia`).

- [ ] **Step 2: Gate with and without the plane** (same live recording as before: `_verbatim/ref-fr-<site>-1`, farm `_verbatim/ref-farm-D1`), cadence `UNCRAFT_GATE_PASSO_MS=20000`, motion program = `motion.escolhido.json` copied to `motion.json` as in earlier runs. Compare SSIM per stop and look at the images side by side (site | without plane | with plane).

- [ ] **Step 3: Record** the table, the images and the open items in a new section of the plan doc; commit.
