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
    expect(r).toMatchObject({ versao: 1, colocacao: 'front', acoplamento: 'ancoras', acopladas: ['u-a'], canvas: 1, regioes: [], fixas: [] });
    expect(r.cobertura).toBeLessThan(0.2);
  }, 120000);
  it('Astra r1 #4: caixa que so CONTEM a ancora nao e ancora; elemento cortado pela borda da tela nao conta', async () => {
    // u-a no FLUXO (margem, nao absoluta): os irmaos dentro do cartao a moveriam -> o cartao e a regiao
    const caixas = '<div id="u-grade" style="position:absolute;top:80px;left:80px;width:400px;height:300px"><div id="u-a" style="margin:20px;width:300px;height:200px"></div></div><div id="u-cortada" style="position:absolute;top:1100px;left:600px;width:300px;height:400px"></div>';
    const { captura, canonica } = pasta(desenha(caixas, "g.fillStyle='red';g.fillRect(100,100-scrollY,300,200);g.fillRect(600,1100-scrollY,300,100)"), `<!doctype html><html><body style="margin:0;height:2400px">${caixas}</body></html>`);
    const r = await analisarPlano({ captura, canonica, ys: [0] });
    expect(r.acopladas).toEqual(['u-a']);
    expect(r.regioes).toEqual(['u-grade']);   // sem section/header/footer: a regiao e o pai da ancora
    expect(r.fixas).toEqual([]);
  }, 120000);
  it('Astra r1 #4: secao do TAMANHO DA PAGINA nao vira regiao — fica o cartao justo que contem a ancora', async () => {
    const caixas = '<section id="u-sec" style="position:relative;width:1440px;height:2000px"><div id="u-cartao" style="position:absolute;top:80px;left:80px;width:400px;height:300px"><div id="u-a" style="margin:20px;width:300px;height:200px"></div></div><p id="u-outro" style="position:absolute;top:900px">outro</p></section>';
    const { captura, canonica } = pasta(desenha(caixas, "g.fillStyle='red';g.fillRect(100,100-scrollY,300,200)"), `<!doctype html><html><body style="margin:0;height:2400px">${caixas}</body></html>`);
    const r = await analisarPlano({ captura, canonica, ys: [0] });
    expect(r.acopladas).toEqual(['u-a']);
    expect(r.regioes).toEqual(['u-cartao']);
  }, 120000);
  it('ancora FIXA na tela: nenhum vizinho nem pai a move — sem regiao, marcada como fixa', async () => {
    const caixas = '<main id="u-main" style="height:2400px"><div id="u-f" style="position:fixed;top:100px;left:100px;width:300px;height:200px"></div><p>conteudo</p></main>';
    const { captura, canonica } = pasta(desenha(caixas, "g.fillStyle='red';g.fillRect(100,100,300,200)"), `<!doctype html><html><body style="margin:0">${caixas}</body></html>`);
    const r = await analisarPlano({ captura, canonica, ys: [0] });
    expect(r.acopladas).toEqual(['u-f']);
    expect(r.regioes).toEqual([]);
    expect(r.fixas).toEqual(['u-f']);
  }, 120000);
  it('Astra r3: ancestral com `translate` AVULSO (sem transform) tambem prende a fixa — NAO e fixa', async () => {
    const caixas = '<main id="u-main" style="height:2400px;translate:0px 0px"><div id="u-f" style="position:fixed;top:100px;left:100px;width:300px;height:200px"></div></main>';
    const { captura, canonica } = pasta(desenha(caixas, "g.fillStyle='red';g.fillRect(100,100-scrollY,300,200)"), `<!doctype html><html><body style="margin:0">${caixas}</body></html>`);
    const r = await analisarPlano({ captura, canonica, ys: [0] });
    expect(r.acopladas).toEqual(['u-f']);
    expect(r.fixas).toEqual([]);
  }, 120000);
  it('fixa DENTRO de ancestral com transform comporta-se como absoluta: NAO e fixa e o cartao justo e a regiao', async () => {
    const caixas = '<div id="u-cartao" style="position:absolute;top:80px;left:80px;width:400px;height:300px;transform:translateZ(0)"><div id="u-f" style="position:fixed;top:20px;left:20px;width:300px;height:200px"></div></div>';
    const { captura, canonica } = pasta(desenha(caixas, "g.fillStyle='red';g.fillRect(100,100-scrollY,300,200)"), `<!doctype html><html><body style="margin:0;height:2400px">${caixas}</body></html>`);
    const r = await analisarPlano({ captura, canonica, ys: [0] });
    expect(r.acopladas).toEqual(['u-f']);
    expect(r.regioes).toEqual(['u-cartao']);
    expect(r.fixas).toEqual([]);
  }, 120000);
  it('Astra r5: ancora ABSOLUTA presa embaixo (bottom:0) num cartao de altura automatica — o cartao e a regiao', async () => {
    // o irmao (texto) define a altura do cartao; crescer o irmao desceria a ancora
    const caixas = '<div id="u-cartao" style="position:relative;width:400px;margin-top:80px;margin-left:80px"><p id="u-texto" style="margin:0;height:300px">texto</p><div id="u-a" style="position:absolute;bottom:0;left:20px;width:300px;height:200px"></div></div>';
    const { captura, canonica } = pasta(desenha(caixas, "g.fillStyle='red';g.fillRect(100,180-scrollY,300,200)"), `<!doctype html><html><body style="margin:0;height:2400px">${caixas}</body></html>`);
    const r = await analisarPlano({ captura, canonica, ys: [0] });
    expect(r.acopladas).toEqual(['u-a']);
    expect(r.regioes).toEqual(['u-cartao']);
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
