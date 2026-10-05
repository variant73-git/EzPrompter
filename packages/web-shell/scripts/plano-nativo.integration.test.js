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

// PLACA DE VIDEO REAL: pesado demais para a suite comum (rodando junto, derrubava testes vizinhos por tempo).
// Roda a parte: `npm run test:gpu` (mesmo padrao de RUN_REFERENCE_PROMOTION_ARTIFACT_TESTS).
const GPU = process.env.RUN_GPU_TESTS === '1';
describe.skipIf(!GPU)('analisarPlano (navegador real, placa de video)', () => {
  it('cena sobre ANCORAS: front, e so a caixa vazia pintada e acoplada (a que tem texto nao)', async () => {
    const { captura, canonica } = pasta(desenha(CAIXAS, "g.fillStyle='red';g.fillRect(100,100-scrollY,300,200);g.fillRect(600,100-scrollY,300,200)"), `<!doctype html><html><body style="margin:0;height:2400px">${CAIXAS}</body></html>`);
    const r = await analisarPlano({ captura, canonica, ys: [0] });
    expect(r).toMatchObject({ versao: 1, colocacao: 'front', acoplamento: 'ancoras', acopladas: ['u-a'], canvas: 1 });
    expect(r.cobertura).toBeLessThan(0.2);
  }, 120000);
  it('Astra r1 #4: caixa que so CONTEM a ancora nao e ancora; elemento cortado pela borda da tela nao conta', async () => {
    const caixas = '<div id="u-grade" style="position:absolute;top:80px;left:80px;width:400px;height:300px"><div id="u-a" style="position:absolute;top:20px;left:20px;width:300px;height:200px"></div></div><div id="u-cortada" style="position:absolute;top:1100px;left:600px;width:300px;height:400px"></div>';
    const { captura, canonica } = pasta(desenha(caixas, "g.fillStyle='red';g.fillRect(100,100-scrollY,300,200);g.fillRect(600,1100-scrollY,300,100)"), `<!doctype html><html><body style="margin:0;height:2400px">${caixas}</body></html>`);
    const r = await analisarPlano({ captura, canonica, ys: [0] });
    expect(r.acopladas).toEqual(['u-a']);
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
    expect(await analisarPlano({ captura, canonica, excluirCanvas: ['canvas#c'], ys: [0] })).toBeNull();
  }, 120000);
});
