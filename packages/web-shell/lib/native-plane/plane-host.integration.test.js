import { createServer } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
// testes de navegador real: sob a suite inteira o padrao de 5 s estoura por carga, nao por defeito
vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 });
import { fonteDoHost } from './plane-host.js';
import { injetarModoPlano } from './plane-mode.js';

let srv; let porta; let browser;
const NATIVO = injetarModoPlano('<!doctype html><html><head></head><body style="height:4000px;margin:0"><canvas width="100" height="100" style="position:fixed;top:0;left:0"></canvas></body></html>');
const NATIVO_TRAVADO = '<!doctype html><html><head></head><body>sem modo plano: nunca anuncia</body></html>';
// anuncia pronto e, depois, NAVEGA para uma pagina sem o modo plano (Astra r1 #3)
const NATIVO_QUE_NAVEGA = injetarModoPlano('<!doctype html><html><head></head><body><canvas width="10" height="10"></canvas><script>addEventListener("load", () => setTimeout(() => { location.href = "/travado"; }, 1200));</script></body></html>');
const canon = (src, cfg) => `<!doctype html><html><head><script type="application/json" data-u-plano-config>${JSON.stringify({ src, ...cfg })}</script></head><body style="height:4000px;margin:0;background:rgb(10, 20, 30)"><div id="u-alvo" style="height:50px">alvo</div><script>${fonteDoHost()}</script></body></html>`;
beforeAll(async () => {
  srv = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const corpo = u.pathname === '/nativo' ? NATIVO : u.pathname === '/travado' ? NATIVO_TRAVADO : u.pathname === '/navega' ? NATIVO_QUE_NAVEGA : canon(u.searchParams.get('src'), JSON.parse(u.searchParams.get('cfg') || '{}'));
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
  it('a camada que NAVEGA depois do pronto tem que anunciar de novo — sem anuncio, sai', async () => {
    // limite de 6 s: sob a suite inteira o PRIMEIRO pronto pode passar de 1 s; a navegacao vem 1,2 s depois do load
    const p = await abrir(`http://localhost:${porta}/navega`, { origemPlano: `http://localhost:${porta}`, colocacao: 'front', tempoLimiteMs: 6000 });
    await p.waitForFunction(() => window.__uPlano && window.__uPlano.estado === 'pronto', null, { timeout: 30000 });
    await p.waitForFunction(() => window.__uPlano.estado === 'sem-plano', null, { timeout: 30000 });
    expect(await p.evaluate(() => [window.__uPlano.motivo, document.querySelectorAll('iframe[data-u-plano]').length])).toEqual(['navegou', 0]);
    await p.close();
  });
});
