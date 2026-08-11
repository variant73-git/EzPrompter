// PROBE — o clone é fiel, comparado ELEMENTO A ELEMENTO?
//
// Três tentativas anteriores mediram ALINHAMENTO e eu li como QUALIDADE:
// impressão digital de elementos, pixels da viewport inteira, e altura de
// página. Todas comparavam "a posição de rolagem N no original" com "a posição
// N no clone" — e posição de rolagem NÃO é coordenada comparável entre um site
// dirigido por JS e um clone sem JS.
//
// Aqui a âncora é o ELEMENTO. Acha-se o mesmo elemento nos dois lados (pelo
// texto, que sobrevive à captura), leva-se cada um até ele, e compara-se um
// RECORTE da caixa dele. Assim o deslocamento vertical deixa de existir por
// construção, e o que sobra é aparência.
//
// Braço de controle: o mesmo recorte do ORIGINAL contra ele mesmo, depois de um
// intervalo — porque o site vivo pode estar no meio de uma animação, e isso não
// é defeito do clone.
//
// Uso: node _probe-fidelidade-ancorada.mjs <url> [pasta]
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { captureSnapshot } from './lib/snapshot.js';

const url = process.argv[2];
const saida = process.argv[3] || '/tmp/ancorada';
if (!url) { console.error('uso: node _probe-fidelidade-ancorada.mjs <url> [pasta]'); process.exit(2); }
mkdirSync(saida, { recursive: true });

const LARGURA = 1440, ALTURA = 900;
const MARGEM = 24;

// Âncoras: elementos com texto próprio, distintivo e estável. Texto sobrevive à
// captura muito melhor que caminho de DOM, que muda quando o JS cria nós.
const ACHAR_ANCORAS = () => {
  const vistos = new Map();
  for (const el of document.querySelectorAll('h1,h2,h3,p,li,button,a,span')) {
    if (el.children.length > 0) continue;               // só folhas
    const t = (el.textContent || '').trim().replace(/\s+/g, ' ');
    if (t.length < 18 || t.length > 90) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 10 || r.height > 600) continue;
    if (vistos.has(t)) { vistos.set(t, null); continue; } // texto repetido = ambíguo
    vistos.set(t, { texto: t, topoAbsoluto: Math.round(r.top + window.scrollY) });
  }
  return [...vistos.values()].filter(Boolean);
};

const POSICIONAR = (texto) => {
  const alvos = [...document.querySelectorAll('h1,h2,h3,p,li,button,a,span')]
    .filter((el) => el.children.length === 0 && (el.textContent || '').trim().replace(/\s+/g, ' ') === texto);
  if (alvos.length !== 1) return null;                   // ambíguo ou ausente
  const el = alvos[0];
  const r0 = el.getBoundingClientRect();
  window.scrollTo(0, Math.max(0, Math.round(r0.top + window.scrollY - 300)));
  return true;
};

const LER_CAIXA = (texto) => {
  const alvos = [...document.querySelectorAll('h1,h2,h3,p,li,button,a,span')]
    .filter((el) => el.children.length === 0 && (el.textContent || '').trim().replace(/\s+/g, ' ') === texto);
  if (alvos.length !== 1) return null;
  const r = alvos[0].getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
};

const browser = await chromium.launch({ headless: true });
const out = { url, ancoras: [] };

// ---- O: site vivo -----------------------------------------------------------
const pageO = await browser.newPage({ viewport: { width: LARGURA, height: ALTURA } });
await pageO.goto(url, { waitUntil: 'load', timeout: 60000 });
await pageO.waitForTimeout(2500);
// Percorre a página: entradas precisam ter acontecido para o texto existir
// assentado, senão compara-se o original meio-revelado com o clone completo.
const altO = await pageO.evaluate(() => document.body.scrollHeight);
for (let y = 0; y < altO; y += 600) { await pageO.evaluate((v) => window.scrollTo(0, v), y); await pageO.waitForTimeout(120); }
await pageO.evaluate(() => window.scrollTo(0, 0));
await pageO.waitForTimeout(800);

const candidatas = await pageO.evaluate(ACHAR_ANCORAS);
// Espalha as âncoras pela altura da página em vez de pegar as 8 primeiras.
candidatas.sort((a, b) => a.topoAbsoluto - b.topoAbsoluto);
const passo = Math.max(1, Math.floor(candidatas.length / 8));
const ancoras = candidatas.filter((_, i) => i % passo === 0).slice(0, 8);
out.candidatas = candidatas.length;

async function recorte(page, texto) {
  const ok = await page.evaluate(POSICIONAR, texto);
  if (!ok) return null;
  await page.waitForTimeout(1400);                       // deixa a entrada terminar
  const cx = await page.evaluate(LER_CAIXA, texto);
  if (!cx) return null;
  const clip = {
    x: Math.max(0, Math.round(cx.x - MARGEM)),
    y: Math.max(0, Math.round(cx.y - MARGEM)),
    width: Math.min(LARGURA, Math.round(cx.w + MARGEM * 2)),
    height: Math.min(ALTURA, Math.round(cx.h + MARGEM * 2)),
  };
  // ⚠️ clip sem fullPage é intersectado com a viewport — se a caixa escorregou
  // para fora, o recorte volta truncado e a comparação vira lixo silencioso.
  if (clip.y + clip.height > ALTURA || clip.x + clip.width > LARGURA) return null;
  return { buf: await page.screenshot({ clip }), clip };
}

// CONTROLE QUE FALTAVA: uma ancora cujo texto esta INVISIVEL no original
// (opacidade 0, esperando a revelacao) produz um recorte de fundo liso.
// Comparar fundo com fundo da 100% de diferenca por causa da cor da secao, e
// nao diz nada sobre fidelidade.
const VISIVEL = (texto) => {
  const alvos = [...document.querySelectorAll('h1,h2,h3,p,li,button,a,span')]
    .filter((el) => el.children.length === 0 && (el.textContent || '').trim().replace(/\s+/g, ' ') === texto);
  if (alvos.length !== 1) return { ok: false, opacidade: null };
  let el = alvos[0], op = 1;
  while (el && el !== document.body) { op *= parseFloat(getComputedStyle(el).opacity); el = el.parentElement; }
  const cs = getComputedStyle(alvos[0]);
  return { ok: op > 0.9 && cs.visibility === 'visible', opacidade: Number(op.toFixed(3)) };
};

const recortesO = {}, recortesO2 = {};
const descartadas = [];
for (const a of ancoras) {
  const r1 = await recorte(pageO, a.texto);
  if (!r1) { descartadas.push({ texto: a.texto.slice(0, 40), motivo: 'nao posicionou' }); continue; }
  const vis = await pageO.evaluate(VISIVEL, a.texto);
  if (!vis.ok) { descartadas.push({ texto: a.texto.slice(0, 40), motivo: 'invisivel no original (opacidade ' + vis.opacidade + ')' }); continue; }
  await pageO.waitForTimeout(900);
  const r2 = await recorte(pageO, a.texto);
  if (!r2) { descartadas.push({ texto: a.texto.slice(0, 40), motivo: 'nao reposicionou' }); continue; }
  recortesO[a.texto] = r1; recortesO2[a.texto] = r2;
}
out.descartadas = descartadas;
await pageO.close();

// ---- H: o clone de hoje -----------------------------------------------------
// CLONE_HTML permite medir um artefato JA produzido (por exemplo o do caminho
// REAL de clone, reconstructPage) em vez de refazer a captura estatica.
let html;
if (process.env.CLONE_HTML) {
  html = (await import('node:fs')).readFileSync(process.env.CLONE_HTML, 'utf8');
  out.fonteDoClone = process.env.CLONE_HTML;
} else {
  const cap = await captureSnapshot(url, { viewport: { width: LARGURA, height: ALTURA } });
  html = cap?.html || '';
  out.fonteDoClone = 'captureSnapshot (caminho estatico)';
}
const servidor = createServer((_, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); });
await new Promise((r) => servidor.listen(0, r));
const porta = servidor.address().port;

const pageH = await browser.newPage({ viewport: { width: LARGURA, height: ALTURA } });
await pageH.goto(`http://127.0.0.1:${porta}/`, { waitUntil: 'load', timeout: 60000 });
await pageH.waitForTimeout(2000);

const recortesH = {};
for (const texto of Object.keys(recortesO)) {
  const r = await recorte(pageH, texto);
  if (r) recortesH[texto] = r;
}
await pageH.close();
servidor.close();

// ---- comparação de pixels, dentro do navegador ------------------------------
const navDiff = await chromium.launch({ headless: true });
const pageDiff = await navDiff.newPage();
async function dif(a, b) {
  return pageDiff.evaluate(async ([da, db]) => {
    const carrega = (d) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = d; });
    const [ia, ib] = await Promise.all([carrega(da), carrega(db)]);
    const w = Math.min(ia.width, ib.width), h = Math.min(ia.height, ib.height);
    if (!w || !h) return 1;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.drawImage(ia, 0, 0); const A = ctx.getImageData(0, 0, w, h).data;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(ib, 0, 0); const B = ctx.getImageData(0, 0, w, h).data;
    let d = 0, t = 0;
    for (let i = 0; i < A.length; i += 4) {
      t += 1;
      if (Math.abs(A[i] - B[i]) > 12 || Math.abs(A[i + 1] - B[i + 1]) > 12 || Math.abs(A[i + 2] - B[i + 2]) > 12) d += 1;
    }
    return t ? d / t : 1;
  }, [`data:image/png;base64,${a.toString('base64')}`, `data:image/png;base64,${b.toString('base64')}`]);
}

const host = new URL(url).hostname;
let i = 0;
for (const texto of Object.keys(recortesO)) {
  if (!recortesH[texto]) { out.ancoras.push({ texto: texto.slice(0, 46), status: 'nao encontrada no clone' }); continue; }
  const contraste = await pageDiff.evaluate(async (d) => {
    const i = await new Promise((r) => { const im = new Image(); im.onload = () => r(im); im.src = d; });
    const c = document.createElement('canvas'); c.width = i.width; c.height = i.height;
    const x = c.getContext('2d'); x.drawImage(i, 0, 0);
    const A = x.getImageData(0, 0, i.width, i.height).data;
    let min = 255, max = 0;
    for (let k = 0; k < A.length; k += 4) { const l = (A[k] + A[k + 1] + A[k + 2]) / 3; if (l < min) min = l; if (l > max) max = l; }
    return max - min;
  }, 'data:image/png;base64,' + recortesO[texto].buf.toString('base64'));
  if (contraste < 25) { out.ancoras.push({ texto: texto.slice(0, 46), status: 'recorte sem contraste (' + Math.round(contraste) + ') — descartada' }); continue; }
  const ruido = await dif(recortesO[texto].buf, recortesO2[texto].buf);
  const clone = await dif(recortesO[texto].buf, recortesH[texto].buf);
  const nome = `${saida}/${host}-a${i}`;
  writeFileSync(`${nome}-O.png`, recortesO[texto].buf);
  writeFileSync(`${nome}-H.png`, recortesH[texto].buf);
  out.ancoras.push({
    texto: texto.slice(0, 46),
    ruidoDoSite: Number(ruido.toFixed(4)),
    difClone: Number(clone.toFixed(4)),
    excedente: Number(Math.max(0, clone - ruido).toFixed(4)),
    arquivos: `${nome}-{O,H}.png`,
  });
  i += 1;
}
await browser.close();
await navDiff.close();

const medidas = out.ancoras.filter((a) => a.excedente != null);
out.resumo = medidas.length ? {
  ancorasComparadas: medidas.length,
  naoEncontradas: out.ancoras.length - medidas.length,
  excedenteMedio: Number((medidas.reduce((t, a) => t + a.excedente, 0) / medidas.length).toFixed(4)),
  pior: Number(Math.max(...medidas.map((a) => a.excedente)).toFixed(4)),
  quantasAbaixoDe5pct: medidas.filter((a) => a.excedente < 0.05).length,
} : { aviso: 'nenhuma ancora comparavel' };

console.log(JSON.stringify(out, null, 2));
