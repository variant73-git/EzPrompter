// SPIKE — dá para re-expressar o movimento de um site real por OBSERVAÇÃO?
//
// É o "próximo passo real": um site por grupo da população (GSAP alcançável,
// GSAP empacotado, sem GSAP). Se falhar nos três, a direção morre barato.
//
// QUATRO ETAPAS
//   O)  observar   — o site VIVO, amostrando a trajetória visual de cada
//                    elemento em N posições de rolagem;
//   C)  compilar   — virar trilhas nossas (posição de rolagem → valor), sem
//                    ler `vars` de ninguém: só o que foi OBSERVADO;
//   R)  reproduzir — o DOM capturado, com TODO script do site removido, mais um
//                    runtime nosso de ~40 linhas dirigido pela rolagem;
//   M)  medir      — O contra R, com a mesma régua de impressão digital do
//                    probe de reversibilidade.
//
// ⚠️ REGRA DE MÉTODO: a medição acontece em posições de rolagem **que não foram
// amostradas**. Medir nas mesmas posições que alimentaram a compilação seria
// ajustar ao gabarito — daria acerto perfeito e não provaria nada.
//
// ⚠️ O que este spike NÃO é: não é o compilador do produto. Não trata pin, snap,
// scroller customizado, interação, resize nem canvas/WebGL. Ele responde UMA
// pergunta: observar a trajetória e reproduzi-la chega perto do original?
//
// Uso: node _spike-reexpressao.mjs <url>
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { captureSnapshot } from './lib/snapshot.js';

const url = process.argv[2];
if (!url) { console.error('uso: node _spike-reexpressao.mjs <url>'); process.exit(2); }

const N_AMOSTRAS = 21;   // posições que alimentam a compilação
const N_TESTE = 10;      // posições retidas, entre as amostradas

// Chave estável de elemento: caminho por tag + índice entre irmãos. Precisa
// resolver no DOM capturado, que é outro documento.
const CAMINHO = `(el) => {
  const partes = [];
  let n = el;
  while (n && n.nodeType === 1 && n !== document.body) {
    const pai = n.parentElement;
    if (!pai) break;
    const irmaos = Array.from(pai.children).filter((c) => c.tagName === n.tagName);
    partes.unshift(n.tagName + '[' + (irmaos.indexOf(n) + 1) + ']');
    n = pai;
  }
  return partes.join('>');
}`;

// O que se observa. A superfície medida no censo é pequena e dominada por
// opacidade e transform — começa por ela, e declara o resto como não coberto.
const AMOSTRAR = `(caminhoDe) => {
  const saida = {};
  let n = 0;
  for (const el of document.querySelectorAll('body *')) {
    if (n >= 900) break;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const cs = getComputedStyle(el);
    saida[caminhoDe(el)] = {
      o: Math.round(parseFloat(cs.opacity) * 1000) / 1000,
      t: cs.transform === 'none' ? '' : cs.transform,
      v: cs.visibility,
    };
    n += 1;
  }
  return saida;
}`;

const IMPRESSAO = () => {
  const alt = window.innerHeight;
  const mapa = new Map();
  let n = 0;
  for (const el of document.querySelectorAll('body *')) {
    if (n >= 1200) break;
    const r = el.getBoundingClientRect();
    if (r.bottom < -alt || r.top > alt * 2 || (r.width === 0 && r.height === 0)) continue;
    const cs = getComputedStyle(el);
    const chave = [
      el.tagName,
      typeof el.className === 'string' ? el.className.trim() : '',
      Math.round(parseFloat(cs.opacity) * 100),
      Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height),
      cs.transform === 'none' ? '' : cs.transform.replace(/[\d.-]+/g, (m) => Math.round(parseFloat(m))),
      cs.visibility,
    ].join('|');
    mapa.set(chave, (mapa.get(chave) || 0) + 1);
    n += 1;
  }
  return { entradas: [...mapa.entries()], total: n };
};

function diferenca(a, b) {
  const ma = new Map(a.entradas); const mb = new Map(b.entradas);
  let d = 0;
  for (const [k, v] of ma) d += Math.abs(v - (mb.get(k) || 0));
  for (const [k, v] of mb) if (!ma.has(k)) d += v;
  return d;
}

const out = { url };
const browser = await chromium.launch({ headless: true });

// ---------------------------------------------------------------------------
// O — observar o site vivo
// ---------------------------------------------------------------------------
let altura, amostras = [], impressoesO = [], posAmostra = [], posTeste = [];
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(2500);
  altura = await page.evaluate(() => document.body.scrollHeight);
  const maxScroll = Math.max(0, altura - 900);

  for (let i = 0; i < N_AMOSTRAS; i += 1) posAmostra.push(Math.round((maxScroll * i) / (N_AMOSTRAS - 1)));
  // Posições RETIDAS: no meio de cada par amostrado, nunca coincidentes.
  for (let i = 0; i < N_TESTE; i += 1) {
    const a = posAmostra[i], b = posAmostra[i + 1];
    posTeste.push(Math.round((a + b) / 2));
  }

  for (const y of posAmostra) {
    await page.evaluate((v) => window.scrollTo(0, v), y);
    await page.waitForTimeout(320);
    amostras.push(await page.evaluate(`((c,a)=>a(c))(${CAMINHO},${AMOSTRAR})`));
  }
  for (const y of posTeste) {
    await page.evaluate((v) => window.scrollTo(0, v), y);
    await page.waitForTimeout(320);
    impressoesO.push(await page.evaluate(IMPRESSAO));
  }
  await page.close();
}

// ---------------------------------------------------------------------------
// C — compilar: só o que MUDA vira trilha. O resto é estado fixo do DOM.
// ---------------------------------------------------------------------------
const trilhas = {};
{
  const chaves = new Set();
  amostras.forEach((a) => Object.keys(a).forEach((k) => chaves.add(k)));
  for (const k of chaves) {
    const serie = amostras.map((a) => a[k] || null);
    const presentes = serie.filter(Boolean);
    if (presentes.length < 2) continue;
    const mudaO = new Set(presentes.map((s) => s.o)).size > 1;
    const mudaT = new Set(presentes.map((s) => s.t)).size > 1;
    const mudaV = new Set(presentes.map((s) => s.v)).size > 1;
    if (!mudaO && !mudaT && !mudaV) continue;
    trilhas[k] = serie.map((s, i) => (s ? { y: posAmostra[i], ...s } : null)).filter(Boolean);
  }
  out.compilacao = {
    elementosObservados: Object.keys(amostras[0] || {}).length,
    elementosComTrilha: Object.keys(trilhas).length,
    posicoesAmostradas: N_AMOSTRAS,
  };
}

// ---------------------------------------------------------------------------
// R — reproduzir: DOM capturado SEM script nenhum do site + runtime nosso
// ---------------------------------------------------------------------------
const cap = await captureSnapshot(url, { viewport: { width: 1440, height: 900 } });
let html = cap?.html || '';
const scriptsAntes = (html.match(/<script\b/gi) || []).length;
html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<script\b[^>]*\/>/gi, '');
out.captura = { bytes: html.length, scriptsRemovidos: scriptsAntes };

const RUNTIME = `
<script>
(() => {
  const T = ${JSON.stringify(trilhas)};
  const caminhoDe = ${CAMINHO};
  const mapa = [];
  for (const el of document.querySelectorAll('body *')) {
    const k = caminhoDe(el);
    if (T[k]) mapa.push([el, T[k]]);
  }
  window.__resolvidos = mapa.length;
  window.__totalTrilhas = Object.keys(T).length;
  const interp = (pts, y) => {
    if (y <= pts[0].y) return pts[0];
    if (y >= pts[pts.length - 1].y) return pts[pts.length - 1];
    for (let i = 1; i < pts.length; i += 1) {
      if (y <= pts[i].y) {
        const a = pts[i - 1], b = pts[i];
        const f = (y - a.y) / Math.max(1, b.y - a.y);
        // Opacidade interpola de verdade. Transform e visibilidade nao tem
        // interpolacao honesta a partir de string: usa-se o vizinho mais
        // proximo, e essa e uma LIMITACAO declarada deste spike.
        return { o: a.o + (b.o - a.o) * f, t: f < 0.5 ? a.t : b.t, v: f < 0.5 ? a.v : b.v };
      }
    }
    return pts[pts.length - 1];
  };
  const aplicar = () => {
    const y = window.scrollY;
    for (const [el, pts] of mapa) {
      const s = interp(pts, y);
      el.style.setProperty('opacity', String(s.o), 'important');
      el.style.setProperty('transform', s.t || 'none', 'important');
      el.style.setProperty('visibility', s.v, 'important');
    }
  };
  addEventListener('scroll', aplicar, { passive: true });
  aplicar();
})();
</script>`;

// ⚠️ TRÊS BRAÇOS, exigência do Sol que eu tinha ignorado na 1a versão e que me
// fez atribuir à re-expressão um defeito que era da CAPTURA:
//   H = o clone capturado como ele é hoje, SEM o nosso runtime  → erro de captura
//   R = o mesmo clone COM o nosso runtime                       → o que somamos
// Sem o braço H, O→R mistura os dois e o número não significa nada.
const htmlH = html;
const htmlR = html.includes('</body>') ? html.replace(/<\/body>/i, RUNTIME + '</body>') : html + RUNTIME;

const servidor = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(req.url && req.url.startsWith('/R') ? htmlR : htmlH);
});
await new Promise((r) => servidor.listen(0, r));
const porta = servidor.address().port;

// ---------------------------------------------------------------------------
// M — medir O contra R nas posições RETIDAS
// ---------------------------------------------------------------------------
async function medirBraco(caminho) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`http://127.0.0.1:${porta}${caminho}`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(1500);
  const diag = await page.evaluate(() => ({ resolvidos: window.__resolvidos ?? null, total: window.__totalTrilhas ?? null }));
  const alt = await page.evaluate(() => document.body.scrollHeight);
  const imps = [];
  for (const y of posTeste) {
    await page.evaluate((v) => window.scrollTo(0, v), y);
    await page.waitForTimeout(260);
    imps.push(await page.evaluate(IMPRESSAO));
  }
  await page.close();
  return { diag, altura: alt, imps };
}

{
  const H = await medirBraco('/H');
  const R = await medirBraco('/R');
  out.resolucao = R.diag;
  out.altura = {
    original: altura, capturado: H.altura, reproduzido: R.altura,
    razaoCaptura: Number((H.altura / Math.max(1, altura)).toFixed(3)),
  };

  const soma = (f) => posTeste.reduce((t, _, i) => t + f(i), 0);
  const totalO = soma((i) => impressoesO[i].total);
  const oh = soma((i) => diferenca(impressoesO[i], H.imps[i]));
  const hr = soma((i) => diferenca(H.imps[i], R.imps[i]));
  const or = soma((i) => diferenca(impressoesO[i], R.imps[i]));

  out.resumo = {
    posicoesRetidas: posTeste.length,
    elemsMediaO: Math.round(totalO / posTeste.length),
    // O→H: defeito que a captura de hoje JA TEM. Nao e da re-expressao.
    erroDaCapturaOH: Number((oh / Math.max(1, totalO)).toFixed(3)),
    // H→R: o que o NOSSO runtime acrescenta ou corrige sobre a captura.
    efeitoDoRuntimeHR: Number((hr / Math.max(1, totalO)).toFixed(3)),
    // O→R: o que o usuario veria.
    erroTotalOR: Number((or / Math.max(1, totalO)).toFixed(3)),
    // Se O→R < O→H, o nosso runtime APROXIMOU o clone do original.
    aproximou: or < oh,
  };
}

servidor.close();
await browser.close();
console.log(JSON.stringify(out, null, 2));
