// PROBE — o clone parece com o original? (PERCEPTUAL, não estrutural)
//
// Motivo: a régua de impressão digital do spike conta como "diferente" qualquer
// elemento cuja caixa mude UM pixel. O Adilson observou que o clone do
// FarmMinerals já parece bom, e a régua estrita dizia 55% de diferença. As duas
// coisas podem ser verdade ao mesmo tempo, porque a régua estrita NÃO mede
// aparência — ela marcou igual o farmminerals (bom) e o ueno.co (44x de altura,
// destruído).
//
// Este probe mede o que importa para o produto: **pixels**. Compara telas do
// site vivo com telas do clone de hoje, nas mesmas posições de rolagem.
//
// ⚠️ Limite: comparação de pixels penaliza o que muda sozinho (vídeo tocando,
// loop) mesmo quando o clone está certo. Por isso mede-se também a diferença do
// ORIGINAL CONTRA ELE MESMO na mesma posição — o piso de ruído. Só o que excede
// esse piso é diferença de clone.
//
// Uso: node _probe-fidelidade-visual.mjs <url> [pasta-de-saida]
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { captureSnapshot } from './lib/snapshot.js';

const url = process.argv[2];
const saida = process.argv[3] || '/tmp/fidelidade';
if (!url) { console.error('uso: node _probe-fidelidade-visual.mjs <url> [pasta]'); process.exit(2); }
mkdirSync(saida, { recursive: true });

const LARGURA = 1440, ALTURA = 900;

// Diferença de pixels: fração de pixels cujo canal difere acima de um limiar
// perceptual. 12/255 ignora ruído de compressão e antialiasing, e ainda pega
// qualquer mudança que um olho note.
function difPixels(a, b) {
  const n = Math.min(a.length, b.length);
  let dif = 0, total = 0;
  for (let i = 0; i < n; i += 4) {
    total += 1;
    if (Math.abs(a[i] - b[i]) > 12 || Math.abs(a[i + 1] - b[i + 1]) > 12 || Math.abs(a[i + 2] - b[i + 2]) > 12) dif += 1;
  }
  return total ? dif / total : 1;
}

const browser = await chromium.launch({ headless: true });
const out = { url };

// ---- O: site vivo -----------------------------------------------------------
const pageO = await browser.newPage({ viewport: { width: LARGURA, height: ALTURA } });
await pageO.goto(url, { waitUntil: 'load', timeout: 60000 });
await pageO.waitForTimeout(2500);
const alturaO = await pageO.evaluate(() => document.body.scrollHeight);
const maxO = Math.max(0, alturaO - ALTURA);
const posicoes = [0, Math.round(maxO * 0.25), Math.round(maxO * 0.5), Math.round(maxO * 0.75), maxO];

const telasO = [], telasO2 = [];
for (const y of posicoes) {
  await pageO.evaluate((v) => window.scrollTo(0, v), y);
  await pageO.waitForTimeout(1200);
  telasO.push(await pageO.screenshot());
  // Segunda tela na MESMA posição: o piso de ruído do próprio site.
  await pageO.waitForTimeout(900);
  telasO2.push(await pageO.screenshot());
}
await pageO.close();

// ---- H: o clone de hoje -----------------------------------------------------
const cap = await captureSnapshot(url, { viewport: { width: LARGURA, height: ALTURA } });
const html = cap?.html || '';
const servidor = createServer((_, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); });
await new Promise((r) => servidor.listen(0, r));
const porta = servidor.address().port;

const pageH = await browser.newPage({ viewport: { width: LARGURA, height: ALTURA } });
await pageH.goto(`http://127.0.0.1:${porta}/`, { waitUntil: 'load', timeout: 60000 });
await pageH.waitForTimeout(2000);
const alturaH = await pageH.evaluate(() => document.body.scrollHeight);

const telasH = [];
for (const y of posicoes) {
  await pageH.evaluate((v) => window.scrollTo(0, v), y);
  await pageH.waitForTimeout(900);
  telasH.push(await pageH.screenshot());
}
await pageH.close();
servidor.close();

// ---- comparação -------------------------------------------------------------
// Sem dependência nova: a diferença de pixels é calculada DENTRO do navegador,
// via canvas, a partir das telas em data-URL.
const pageDiff = await (await chromium.launch({ headless: true })).newPage();
async function difPixelsNav(a, b) {
  return pageDiff.evaluate(async ([da, db]) => {
    const carrega = (d) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = d; });
    const [ia, ib] = await Promise.all([carrega(da), carrega(db)]);
    const w = Math.min(ia.width, ib.width), h = Math.min(ia.height, ib.height);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.drawImage(ia, 0, 0); const A = ctx.getImageData(0, 0, w, h).data;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(ib, 0, 0); const B = ctx.getImageData(0, 0, w, h).data;
    let dif = 0, total = 0;
    for (let i = 0; i < A.length; i += 4) {
      total += 1;
      if (Math.abs(A[i] - B[i]) > 12 || Math.abs(A[i + 1] - B[i + 1]) > 12 || Math.abs(A[i + 2] - B[i + 2]) > 12) dif += 1;
    }
    return total ? dif / total : 1;
  }, [`data:image/png;base64,${a.toString('base64')}`, `data:image/png;base64,${b.toString('base64')}`]);
}
const PNG = true;

out.altura = { original: alturaO, clone: alturaH, razao: Number((alturaH / Math.max(1, alturaO)).toFixed(3)) };
out.posicoes = [];
for (let i = 0; i < posicoes.length; i += 1) {
  const nome = `${saida}/${new URL(url).hostname}-${i}`;
  writeFileSync(`${nome}-O.png`, telasO[i]);
  writeFileSync(`${nome}-H.png`, telasH[i]);
  const linha = { y: posicoes[i], arquivos: [`${nome}-O.png`, `${nome}-H.png`] };
  if (PNG) {
    const ruido = await difPixelsNav(telasO[i], telasO2[i]);
    const clone = await difPixelsNav(telasO[i], telasH[i]);
    Object.assign(linha, {
      ruidoDoSite: Number(ruido.toFixed(4)),
      difClone: Number(clone.toFixed(4)),
      excedente: Number(Math.max(0, clone - ruido).toFixed(4)),
    });
  }
  out.posicoes.push(linha);
}
if (PNG) {
  const exc = out.posicoes.map((p) => p.excedente);
  out.resumo = {
    difMediaAcimaDoRuido: Number((exc.reduce((a, b) => a + b, 0) / exc.length).toFixed(4)),
    pior: Number(Math.max(...exc).toFixed(4)),
  };
} else {
  out.resumo = { aviso: 'pngjs ausente — só telas gravadas, sem número' };
}
await browser.close();
await pageDiff.context().browser().close();
console.log(JSON.stringify(out, null, 2));
