// VERBATIM — auditoria do insumo, antes de gastar inferência.
//
// Duas perguntas decididas numa carga só, sem IA:
//
//  (1) AS REFERÊNCIAS EXTERNAS. O portão contou 264 TENTATIVAS. Tentativa não é
//      referência: retentativa e reconstrução multiplicam poucos defeitos. Aqui
//      se agrupa por URL única, com tipo de recurso e quem pediu, para saber
//      quantos defeitos existem de verdade e de que classe — só então faz
//      sentido projetar o conserto (Astra: "diagnostique antes de projetar 264
//      consertos").
//
//  (2) O INVENTÁRIO DE MOVIMENTO RESOLVE? Antes de sonhar em reautorar o
//      movimento sobre um DOM regenerado, é preciso saber se ele sequer
//      ENDEREÇA o DOM original. Cada registro traz `alvos` (seletores CSS) e
//      `quantosAlvos`. Aqui se tenta resolver cada seletor contra o DOM
//      capturado e se mede o buraco: registros que não resolvem, que resolvem
//      para um número diferente de elementos, easing não reproduzível
//      (`funcao`), e gatilhos de rolagem sem ligação com animação.
//      É o pré-requisito do controle que o Astra prescreveu — replay sobre o
//      DOM intacto com o motor original desligado. Se o endereçamento já falha,
//      o replay não tem como funcionar e a re-expressão por IA seria fé.
//
// USO
//   node scripts/verbatim-audit.mjs --bundle <dir> --inventory _verbatim/source/motion-inventory.json

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';

const VIEWPORT = { width: 1440, height: 1200 };
const SETTLE_MS = 4500;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.avif': 'image/avif', '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
};

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function serveDirectory(root) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    if (rel === '') rel = 'index.html';
    const full = path.resolve(root, rel);
    if (!full.startsWith(path.resolve(root)) || rel.endsWith('.uncraft-meta.json')) { res.writeHead(404).end(); return; }
    try {
      const body = await readFile(full);
      let type = MIME[path.extname(full).toLowerCase()];
      try {
        const meta = JSON.parse(await readFile(`${full}.uncraft-meta.json`, 'utf8'));
        if (meta?.contentType) type = meta.contentType;
      } catch { /* extensão basta */ }
      res.writeHead(200, { 'content-type': type || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(body);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

// Classifica a referência pelo que o navegador diz que ela é, e pela forma da
// URL — o suficiente para saber QUAL conserto determinístico ela pede.
function classificar(url, resourceType) {
  const u = url.toLowerCase();
  if (resourceType === 'image') return /\?|&/.test(u) ? 'imagem (com query — variante srcset/CDN)' : 'imagem';
  if (resourceType === 'font') return 'fonte';
  if (resourceType === 'stylesheet') return 'css';
  if (resourceType === 'script') return 'script';
  if (resourceType === 'media') return 'mídia';
  if (resourceType === 'fetch' || resourceType === 'xhr') return 'fetch/xhr (construída em runtime)';
  if (/\.json(\?|$)/.test(u)) return 'json (lottie/manifesto?)';
  return resourceType || 'outro';
}

async function main() {
  const bundleArg = arg('--bundle');
  const inventoryPath = arg('--inventory', '_verbatim/source/motion-inventory.json');
  if (!bundleArg) { console.error('uso: --bundle <dir> [--inventory <json>]'); process.exit(2); }
  const root = path.resolve(bundleArg);
  const assets = path.join(root, 'assets');
  const served = await serveDirectory(assets);

  const inv = JSON.parse(await readFile(path.resolve(inventoryPath), 'utf8'));
  const registros = inv?.aposEntrada?.animacoes || [];
  const gatilhos = inv?.aposEntrada?.rolagem || [];

  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, serviceWorkers: 'block' });

  // (1) instrumentação detalhada das tentativas externas
  const tentativas = new Map();   // url -> { n, tipo, classe }
  await context.route('**/*', async (route, request) => {
    const u = request.url();
    if (u.startsWith(served.origin) || u.startsWith('data:') || u.startsWith('blob:') || u === 'about:blank') {
      await route.continue();
      return;
    }
    const tipo = request.resourceType();
    const atual = tentativas.get(u) || { n: 0, tipo, classe: classificar(u, tipo) };
    atual.n += 1;
    tentativas.set(u, atual);
    await route.abort();
  });

  const page = await context.newPage();
  await page.goto(`${served.origin}/index.html`, { waitUntil: 'load', timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(SETTLE_MS);

  // (2) o inventário ENDEREÇA este DOM?
  const resolucao = await page.evaluate(([regs, trigs]) => {
    const conta = (sel) => { try { return document.querySelectorAll(sel).length; } catch { return -1; } };
    let resolvemTodos = 0; let algumZero = 0; let seletorInvalido = 0;
    let contagemDivergente = 0; let easingNaoReproduzivel = 0; let semSeletores = 0;
    let elementosEsperados = 0; let elementosEncontrados = 0;
    for (const r of regs) {
      const sels = Array.isArray(r.alvos) ? r.alvos : [];
      if (!sels.length) { semSeletores += 1; continue; }
      const counts = sels.map(conta);
      if (counts.some((c) => c === -1)) seletorInvalido += 1;
      else if (counts.some((c) => c === 0)) algumZero += 1;
      else resolvemTodos += 1;
      const achados = counts.filter((c) => c > 0).reduce((a, b) => a + b, 0);
      const esperados = Number(r.quantosAlvos) || sels.length;
      elementosEsperados += esperados; elementosEncontrados += achados;
      if (achados !== esperados) contagemDivergente += 1;
      if (r.curva === 'funcao' || r.curva == null) easingNaoReproduzivel += 1;
    }
    // Gatilhos: o registro traz ligação com a animação que ele dispara?
    const camposGatilho = trigs.length ? Object.keys(trigs[0]) : [];
    const ligaAnimacao = camposGatilho.some((k) => /anima|tween|timeline|id/i.test(k));
    return {
      registros: regs.length,
      resolvemTodos, algumZero, seletorInvalido, semSeletores,
      contagemDivergente, easingNaoReproduzivel,
      elementosEsperados, elementosEncontrados,
      gatilhos: trigs.length, camposGatilho, ligaAnimacao,
    };
  }, [registros, gatilhos]);

  await context.close(); await browser.close();
  await new Promise((d) => served.server.close(d));

  // (1) agregação
  const unicas = [...tentativas.entries()].map(([url, v]) => ({ url, ...v }));
  const totalTentativas = unicas.reduce((a, b) => a + b.n, 0);
  const porClasse = {};
  for (const u of unicas) porClasse[u.classe] = (porClasse[u.classe] || 0) + 1;
  const maisPedidas = unicas.sort((a, b) => b.n - a.n).slice(0, 5)
    .map((u) => ({ tentativas: u.n, classe: u.classe, url: `${u.url.slice(0, 96)}…` }));

  console.log(JSON.stringify({
    referenciasExternas: {
      tentativas: totalTentativas,
      urlsUnicas: unicas.length,
      porClasse,
      maisPedidas,
    },
    inventarioResolve: resolucao,
  }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
