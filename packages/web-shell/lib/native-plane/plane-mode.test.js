// packages/web-shell/lib/native-plane/plane-mode.test.js
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
// testes de navegador real: sob a suite inteira o padrao de 5 s estoura por carga, nao por defeito
vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 });
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
  const pagina = (extra = '') => injetarModoPlano(`<!doctype html><html><head></head><body style="background:rgb(9, 9, 9);height:3000px"><p id="t">texto</p><canvas id="c0" width="10" height="10"></canvas><canvas id="c1" width="10" height="10"></canvas>${extra}</body></html>`, { excluirCanvas: ['canvas#c1'] });
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
      // espera o PRIMEIRO aviso (ate 8 s — sob carga ele demora) e mais 600 ms para ver que nao vem outro
      const n = []; let fim = null;
      addEventListener('message', (e) => { if (e.data && e.data.tipo === 'u-plano-pronto') { n.push(e.data); if (!fim) fim = setTimeout(() => ok(n), 600); } });
      const f = document.createElement('iframe'); f.srcdoc = html; document.body.appendChild(f);
      setTimeout(() => ok(n), 8000);
    }), pagina());
    expect(prontos.length).toBe(1); expect(prontos[0].canvas).toBe(1);
    await p.close();
  });
});

describe('modo plano: canvas criado depois do load', () => {
  it('canvas EXCLUIDO que nasce depois continua escondido', async () => {
    const { chromium } = await import('playwright-core'); const b = await chromium.launch(); const p = await b.newPage();
    try {
      await p.setContent(injetarModoPlano('<!doctype html><html><head></head><body><canvas id="c0"></canvas></body></html>', { excluirCanvas: ['canvas#c1'] }));
      await p.evaluate(() => { const c = document.createElement('canvas'); c.id = 'c1'; document.body.appendChild(c); });
      await p.waitForTimeout(200);
      expect(await p.evaluate(() => getComputedStyle(document.getElementById('c1')).visibility)).toBe('hidden');
    } finally { await b.close(); }
  });
});

describe('modo plano: posse do canvas por ASSINATURA (Astra r1 #2)', () => {
  it('canvas inserido ANTES do excluido nao desloca a exclusao', async () => {
    const { chromium } = await import('playwright-core'); const b = await chromium.launch(); const p = await b.newPage();
    try {
      await p.setContent(injetarModoPlano('<!doctype html><html><head></head><body><div class="a"><canvas id="x1" width="5" height="5"></canvas></div><div class="b"><canvas width="5" height="5"></canvas></div></body></html>', { excluirCanvas: ['div.b:2 > canvas:1'] }));
      await p.evaluate(() => { const c = document.createElement('canvas'); c.id = 'novo'; document.body.insertBefore(c, document.body.firstChild); });
      await p.waitForTimeout(200);
      expect(await p.evaluate(() => [...document.querySelectorAll('canvas')].map((c) => `${c.id || 'b'}:${getComputedStyle(c).visibility}`))).toEqual(['novo:visible', 'x1:visible', 'b:hidden']);
    } finally { await b.close(); }
  });
});

describe('modo plano: canvas inserido no MESMO pai antes do excluido (Astra r2)', () => {
  it('a exclusao fica presa ao ELEMENTO encontrado, nao a posicao', async () => {
    const { chromium } = await import('playwright-core'); const b = await chromium.launch(); const p = await b.newPage();
    try {
      await p.setContent(injetarModoPlano('<!doctype html><html><head></head><body><div id="wrap"><canvas class="um" width="5" height="5"></canvas><canvas class="alvo" width="5" height="5"></canvas></div></body></html>', { excluirCanvas: ['div#wrap > canvas.alvo:2'] }));
      await p.waitForTimeout(100);
      await p.evaluate(() => { const c = document.createElement('canvas'); c.className = 'alvo'; c.id = 'novo'; const w = document.getElementById('wrap'); w.insertBefore(c, w.children[1]); });
      await p.waitForTimeout(200);
      expect(await p.evaluate(() => [...document.querySelectorAll('canvas')].map((c) => `${c.id || c.className}:${getComputedStyle(c).visibility}`))).toEqual(['um:visible', 'novo:visible', 'alvo:hidden']);
    } finally { await b.close(); }
  });
});
