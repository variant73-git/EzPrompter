// @vitest-environment node
// A cópia editável é gravada NA TELA em que vai ser mostrada (2026-10-19). A montagem serializa o estilo
// CALCULADO de cada elemento; gravada a 1440, uma faixa de largura 100% virava 1440 px fixos e transbordava no
// node e no editor de 1280 (barra de rolagem horizontal e uma tira branca). O controle grava na referência e
// tem que transbordar — senão o site de teste não exercita o defeito.
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { normalizarCaptura } from './normalizar-clone.mjs';
import { servir } from './inventario-conteudo.mjs';
import { medirCanonico } from './regua-trajetoria.mjs';

// Dois casos que a montagem grava com largura FIXA: bloco cuja largura não é a automática (`calc(100% - 40px)`)
// e imagem (leva a largura sempre, por causa da variante do srcset). Gravados a 1440, saem com 1400 e 1440 px.
const SITE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>telas</title><style>
body { margin: 0; font-family: sans-serif; }
.faixa { width: calc(100% - 40px); height: 240px; margin: 0 20px; background: #2e4a6b; }
.foto { display: block; width: 100%; height: 160px; }
.texto { padding: 24px; }
</style></head><body>
<header class="faixa">Ver produto</header>
<img class="foto" src="foto.png" alt="Foto do produto">
<p class="texto">Um parágrafo que acompanha a largura da janela.</p>
</body></html>`;
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

let raiz;
let browser;

async function montar(nome, tela) {
  const captura = path.join(raiz, `${nome}-cap`); const saida = path.join(raiz, nome, 'canonica');
  await mkdir(captura, { recursive: true });
  await writeFile(path.join(captura, 'index.html'), SITE);
  await writeFile(path.join(captura, 'foto.png'), PNG_1X1);
  const relatorio = await normalizarCaptura({ captura, saida, movimento: 'decl+leitura', plano: false, ...(tela ? { tela } : {}) });
  return { saida, relatorio };
}

async function larguraNa(saida, width, height) {
  const { srv, origem } = await servir(saida);
  const page = await browser.newPage({ viewport: { width, height } });
  try {
    await page.goto(`${origem}/index.html`, { waitUntil: 'load' });
    return await page.evaluate(() => ({ janela: innerWidth, conteudo: document.documentElement.scrollWidth, tela: document.documentElement.getAttribute('data-u-tela') }));
  } finally { await page.close(); srv.close(); }
}

beforeAll(async () => {
  raiz = await mkdtemp(path.join(os.tmpdir(), 'telas-'));
  browser = await chromium.launch();
});
afterAll(async () => { await browser?.close(); });

describe('cópia gravada na tela do node', () => {
  it('gravada no desktop (1280 × 800), cabe no node de 1280 e declara a tela', async () => {
    const { saida, relatorio } = await montar('desktop', 'desktop');
    expect(relatorio.tela).toBe('desktop');
    const m = await larguraNa(saida, 1280, 800);
    expect(m.conteudo).toBeLessThanOrEqual(m.janela);
    expect(m.tela).toBe('desktop');
    // a régua lê o estado da página na MESMA tela da gravação do site
    const grav = JSON.parse(await readFile(path.join(path.dirname(saida), 'gravacao-nativa.json'), 'utf8'));
    expect(grav.tela).toBe('desktop');
  }, 120_000);

  it('controle: gravada na referência (1440), transborda o node de 1280 — o defeito relatado', async () => {
    const { saida, relatorio } = await montar('referencia', null);
    expect(relatorio.tela).toBe('reference');
    const m = await larguraNa(saida, 1280, 800);
    expect(m.conteudo).toBeGreaterThan(m.janela);
    expect(m.tela).toBe('reference');
  }, 120_000);

  it('a régua recusa medir uma cópia numa tela diferente da que ela foi gravada', async () => {
    const saida = path.join(raiz, 'desktop', 'canonica');
    await expect(medirCanonico(saida, [0], { tela: 'reference' })).rejects.toThrow(/tela/);
    const medida = await medirCanonico(saida, [0], { tela: 'desktop' });
    expect(medida).toHaveLength(1);
  }, 120_000);

  // Astra r1 (P2): sem gravar movimento, a página é percorrida em saltos para carregar o que só aparece quando
  // visível. Com saltos de 900 numa tela de 800, a faixa 800–900 nunca entrava na tela.
  it('sem movimento, o percurso não deixa faixa sem ver numa tela de 800', async () => {
    const captura = path.join(raiz, 'preguicoso-cap'); const saida = path.join(raiz, 'preguicoso', 'canonica');
    await mkdir(captura, { recursive: true });
    await writeFile(path.join(captura, 'index.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>p</title>
<style>body{margin:0;height:3000px;position:relative}#alvo{position:absolute;top:850px;left:0;width:200px;height:20px}</style></head>
<body><div id="alvo">vazio</div><script>
new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) e.target.textContent = 'carregado na rolagem'; }).observe(document.getElementById('alvo'));
</script></body></html>`);
    await normalizarCaptura({ captura, saida, tela: 'desktop', plano: false });
    expect(await readFile(path.join(saida, 'index.html'), 'utf8')).toContain('carregado na rolagem');
  }, 120_000);

  it('tela desconhecida para a montagem antes de abrir o navegador', async () => {
    await expect(normalizarCaptura({ captura: raiz, saida: path.join(raiz, 'x'), tela: 'celular', plano: false })).rejects.toThrow(/tela desconhecida/);
  });
});
