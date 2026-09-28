// O PORTÃO VERBATIM — a etapa 7 da receita (docs/clone-verbatim/CLONE_PROMPT.md),
// executável e independente de motor. Ele NÃO constrói clone nenhum: ele julga
// um artefato pronto contra a régua, e serve igualmente para native, remake,
// iter9 ou o motor novo. Foi construído ANTES do motor de propósito — sem ele,
// "é bom" é opinião (a lição de 2026-08: quatro réguas mediram alinhamento e
// foram lidas como qualidade).
//
// Desenho endurecido pela auditoria do Astra (2026-09-28):
//
//  • INDEPENDÊNCIA A FRIO. O bloqueio é instalado ANTES de navegar, e só a
//    origem que serve o artefato passa. Um harness que carrega a página e
//    DEPOIS desliga a rede não prova independência — prova cache quente.
//    Contam-se TENTATIVAS externas (o que a página quis buscar) separadas de
//    SUCESSOS: uma tentativa abortada continua sendo dependência externa.
//    Service workers ficam bloqueados no contexto (interceptação comum tem
//    buraco para eles).
//  • ARQUIVOS REAIS. Serve-se o diretório do bundle como está, por um servidor
//    local de verdade. NADA de traduzir URL em tempo de teste: uma reescrita
//    que só existe no harness faz um pacote quebrado passar.
//    ⚠️ 127.0.0.1 de propósito: origem http fora de localhost NÃO é contexto
//    seguro — `crypto.randomUUID` some, o script do site morre no início
//    (medido em lib/clone-similarity.js: 3 tweens em vez de 138, preloader
//    eterno, SSIM 0,57 "parecendo funcionar").
//  • UMA TRAJETÓRIA REPRODUZÍVEL. Replica-se a mesma SEQUÊNCIA DE ENTRADA
//    (mesmos alvos em px, mesmos tempos) em referência e candidato. Os alvos
//    saem da REFERÊNCIA, nunca da altura própria de cada candidato: esticar
//    cada um pela própria porcentagem esconde justamente a distância de scroll
//    que falta. O scrollY observado é diagnóstico, não o critério.
//  • DIMENSÕES INDEPENDENTES. Altura, alcance de scroll, cobertura de texto e
//    de seções, requisições externas, recursos ausentes, erros de console e
//    SSIM por quadro são reportados SEPARADAMENTE e nunca viram uma média —
//    altura igual se fabrica com espaço vazio, e um SSIM médio alto esconde um
//    objeto ausente. Medida que faltou é FALHA, não vira lacuna silenciosa.
//
// USO
//   node scripts/verbatim-gate.mjs --reference https://site/  --out _verbatim/ref
//   node scripts/verbatim-gate.mjs --candidate bundle:<dir>   --out _verbatim/native --trajectory _verbatim/ref/trajectory.json
//   node scripts/verbatim-gate.mjs --candidate file:<x.html>  --out _verbatim/remake --trajectory _verbatim/ref/trajectory.json
//   node scripts/verbatim-gate.mjs --compare _verbatim/ref _verbatim/native

import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { computeSsimRgb } from '../lib/clone-similarity.js';

const VIEWPORT = { width: 1440, height: 1200 };   // a receita: 1440x1200, DPR 1, zoom 100%
const SETTLE_MS = 3500;      // deixa o preloader e a animação de entrada terminarem
const DWELL_MS = 450;        // parada em cada ponto, igual para todos
const HOLD_MS = 2500;        // permanência no fim, para o rodapé animar
const STEP_PX = 900;         // passo do scroll único e contínuo
const MAX_STEPS = 40;        // teto de segurança

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

// Servidor estático sobre os arquivos REAIS do artefato. Sidecars de metadados
// (.uncraft-meta.json) não são servidos, mas dão o content-type gravado na
// captura — melhor que adivinhar pela extensão.
async function serveDirectory(root, { onRequest }) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    if (rel === '') rel = 'index.html';
    const full = path.resolve(root, rel);
    if (!full.startsWith(path.resolve(root))) { res.writeHead(403).end(); return; }
    if (rel.endsWith('.uncraft-meta.json')) { res.writeHead(404).end(); onRequest?.(rel, 404); return; }
    try {
      const body = await readFile(full);
      let type = MIME[path.extname(full).toLowerCase()];
      try {
        const meta = JSON.parse(await readFile(`${full}.uncraft-meta.json`, 'utf8'));
        if (meta?.contentType) type = meta.contentType;
      } catch { /* sem sidecar: extensão basta */ }
      res.writeHead(200, { 'content-type': type || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(body);
      onRequest?.(rel, 200);
    } catch {
      res.writeHead(404).end();
      onRequest?.(rel, 404);   // recurso do PRÓPRIO pacote que falta = achado
    }
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

// A TERCEIRA DIMENSÃO: editabilidade, medida no próprio artefato.
//
// Sem ela o portão elege o vencedor errado — uma cópia preservada é fiel e
// independente, e mesmo assim reproduz toda a bagunça do site original
// (pointer-events:none em texto animado, wordmark decorativo cobrindo seções,
// texto fatiado em spans por letra). Era isso que justificava o custo do
// método verbatim: reconstruir nas NOSSAS regras para os painéis funcionarem.
// "Documento único com estilo embutido não implica editabilidade" (Astra).
//
// Mede-se a propriedade do ARTEFATO, não a esperteza do nosso editor: um texto
// é "alcançável" quando um clique no meio dele resolve nele mesmo, SEM precisar
// das heurísticas que o bridge aplica. Quanto mais texto obstruído ou
// bloqueado, mais imprevisível é editar aquele clone.
function editabilityProbe() {
  const TEXT_BLOCK = 'h1,h2,h3,h4,h5,h6,p,blockquote,a,button,label,li,figcaption,dt,dd';
  const directText = (el) => Array.from(el.childNodes)
    .filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ').trim();
  const all = Array.from(document.querySelectorAll('body *')).filter((el) => directText(el).length > 0);
  let reachable = 0; let peBlocked = 0; let obstructed = 0; let inViewport = 0; let semantic = 0;
  for (const el of all) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (r.width < 2 || r.height < 2) continue;
    if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) < 0.05) continue;
    if (r.bottom < 0 || r.top > window.innerHeight) continue;
    inViewport += 1;
    if (el.matches(TEXT_BLOCK)) semantic += 1;
    let blocked = false; let p = el;
    while (p && p !== document.documentElement) {
      if (getComputedStyle(p).pointerEvents === 'none') { blocked = true; break; }
      p = p.parentElement;
    }
    const cx = Math.max(1, Math.min(window.innerWidth - 1, r.left + Math.min(8, r.width / 2)));
    const cy = Math.max(1, Math.min(window.innerHeight - 1, r.top + r.height / 2));
    const hit = document.elementFromPoint(cx, cy);
    const lands = hit && (hit === el || el.contains(hit));
    if (blocked) peBlocked += 1;
    else if (!lands) obstructed += 1;
    else reachable += 1;
  }
  return {
    inViewport,
    reachable,
    peBlocked,
    obstructed,
    semantic,
    splitFragments: document.querySelectorAll('.char,.word,.line,[data-split-text],[text-split]').length,
    scripts: document.scripts.length,
    remoteStylesheets: document.querySelectorAll('link[rel="stylesheet"]').length,
    inlineStyleBlocks: document.querySelectorAll('style').length,
  };
}

// Percorre a MESMA sequência de entrada e devolve as dimensões + os quadros.
async function runTrajectory(page, { targets, outDir, allowNetwork }) {
  const frames = [];
  const t0 = Date.now();
  await page.waitForLoadState('load').catch(() => {});
  await page.waitForTimeout(SETTLE_MS);

  // Agregado ao longo da trajetória: o conteúdo aparece progressivamente, então
  // uma única amostra no topo não representa a página.
  const edit = {
    inViewport: 0, reachable: 0, peBlocked: 0, obstructed: 0, semantic: 0,
    splitFragments: 0, scripts: 0, remoteStylesheets: 0, inlineStyleBlocks: 0,
  };
  const accumulate = async () => {
    const e = await page.evaluate(editabilityProbe).catch(() => null);
    if (!e) return;
    edit.inViewport += e.inViewport; edit.reachable += e.reachable;
    edit.peBlocked += e.peBlocked; edit.obstructed += e.obstructed; edit.semantic += e.semantic;
    // Estruturais: valem para o documento, não se somam — fica o último visto.
    edit.splitFragments = e.splitFragments; edit.scripts = e.scripts;
    edit.remoteStylesheets = e.remoteStylesheets; edit.inlineStyleBlocks = e.inlineStyleBlocks;
  };

  const shoot = async (index, target) => {
    const observed = await page.evaluate(() => Math.round(window.scrollY));
    const file = path.join(outDir, `frame-${String(index).padStart(3, '0')}.png`);
    await page.screenshot({ path: file, type: 'png' });
    await accumulate();
    frames.push({ index, target, observed, atMs: Date.now() - t0, file: path.basename(file) });
  };

  await shoot(0, 0);
  for (let i = 0; i < targets.length; i += 1) {
    const target = targets[i];
    await page.evaluate((y) => window.scrollTo(0, y), target);
    await page.waitForTimeout(DWELL_MS);
    await shoot(i + 1, target);
  }
  await page.waitForTimeout(HOLD_MS);
  await shoot(targets.length + 1, targets.at(-1) ?? 0);

  const geometry = await page.evaluate(() => ({
    pageHeight: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
    maxScroll: Math.max(0, Math.max(document.body.scrollHeight, document.documentElement.scrollHeight) - window.innerHeight),
    reachedScrollY: Math.round(window.scrollY),
    textChars: (document.body.innerText || '').replace(/\s+/g, ' ').trim().length,
    sections: document.querySelectorAll('section, [class*="section" i]').length,
    images: document.images.length,
    imagesDecoded: [...document.images].filter((i) => i.complete && i.naturalWidth > 0).length,
  }));
  return { frames, geometry, editability: edit, allowNetwork };
}

async function measure({ label, outDir, url, serveRoot, trajectory }) {
  await mkdir(outDir, { recursive: true });
  let served = null;
  const ownOriginMisses = [];
  if (serveRoot) served = await serveDirectory(serveRoot, { onRequest: (rel, code) => { if (code === 404) ownOriginMisses.push(rel); } });
  const target = serveRoot ? `${served.origin}/index.html` : url;
  const allowPrefix = serveRoot ? served.origin : null;

  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  // Service workers bloqueados: a interceptação comum tem buraco para eles.
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, serviceWorkers: 'block' });

  const externalAttempts = [];
  const externalSucceeded = [];
  const consoleErrors = [];
  const pageErrors = [];

  // ⭐ BLOQUEIO ANTES DE NAVEGAR. Só a origem que serve o artefato passa.
  if (allowPrefix) {
    await context.route('**/*', async (route, request) => {
      const u = request.url();
      if (u.startsWith(allowPrefix) || u.startsWith('data:') || u.startsWith('blob:') || u === 'about:blank') {
        await route.continue();
        return;
      }
      externalAttempts.push(u);
      await route.abort();
    });
  }

  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => pageErrors.push(String(e?.message || e).slice(0, 200)));
  page.on('response', (r) => {
    const u = r.url();
    if (allowPrefix ? !u.startsWith(allowPrefix) && !u.startsWith('data:') : false) externalSucceeded.push(u);
  });

  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 120000 }).catch((e) => {
    pageErrors.push(`navigation: ${String(e?.message || e).slice(0, 160)}`);
  });

  let targets = trajectory?.targets;
  if (!targets) {
    const maxScroll = await page.evaluate(() => Math.max(0, Math.max(document.body.scrollHeight, document.documentElement.scrollHeight) - window.innerHeight));
    targets = [];
    for (let y = STEP_PX; y <= maxScroll && targets.length < MAX_STEPS; y += STEP_PX) targets.push(y);
    if (!targets.length) targets = [0];
  }

  const run = await runTrajectory(page, { targets, outDir, allowNetwork: !allowPrefix });
  const hosts = (list) => [...new Set(list.map((u) => { try { return new URL(u).host; } catch { return u.slice(0, 40); } }))];

  const report = {
    label,
    target,
    viewport: VIEWPORT,
    trajectoryTargets: targets,
    geometry: run.geometry,
    editability: run.editability,
    frames: run.frames,
    independence: {
      blockedBeforeNavigation: Boolean(allowPrefix),
      externalAttempts: externalAttempts.length,
      externalAttemptHosts: hosts(externalAttempts).slice(0, 20),
      externalSucceeded: externalSucceeded.length,
      ownPackageMisses: ownOriginMisses.length,
      ownPackageMissSample: ownOriginMisses.slice(0, 10),
    },
    errors: { console: consoleErrors.length, page: pageErrors.length, sample: [...consoleErrors, ...pageErrors].slice(0, 6) },
  };
  await writeFile(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  await writeFile(path.join(outDir, 'trajectory.json'), JSON.stringify({ targets, viewport: VIEWPORT }, null, 2));

  await context.close(); await browser.close();
  if (served) await new Promise((d) => served.server.close(d));
  return report;
}

// SSIM quadro a quadro, com o instrumento JÁ VALIDADO do produto
// (computeSsimRgb, cruzado contra o ffmpeg com delta <= 0,0002).
async function compare(refDir, candDir) {
  const ref = JSON.parse(await readFile(path.join(refDir, 'report.json'), 'utf8'));
  const cand = JSON.parse(await readFile(path.join(candDir, 'report.json'), 'utf8'));
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage();
  await page.addScriptTag({ content: `window.__ssim = ${computeSsimRgb.toString()};` });

  const perFrame = [];
  for (const rf of ref.frames) {
    const cf = cand.frames.find((f) => f.index === rf.index);
    const a = path.join(refDir, rf.file);
    const b = cf ? path.join(candDir, cf.file) : null;
    if (!b || !existsSync(b)) { perFrame.push({ index: rf.index, target: rf.target, ssim: null, note: 'quadro ausente no candidato' }); continue; }
    const [da, db] = await Promise.all([readFile(a), readFile(b)]);
    const ssim = await page.evaluate(async ([aB64, bB64]) => {
      const load = (b64) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = `data:image/png;base64,${b64}`; });
      const [ia, ib] = await Promise.all([load(aB64), load(bB64)]);
      const w = Math.min(ia.naturalWidth, ib.naturalWidth), h = Math.min(ia.naturalHeight, ib.naturalHeight);
      const grab = (img) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, w, h).data; };
      return window.__ssim(grab(ia), grab(ib), w, h);
    }, [da.toString('base64'), db.toString('base64')]);
    perFrame.push({ index: rf.index, target: rf.target, refObserved: rf.observed, candObserved: cf.observed, ssim: Number(ssim.toFixed(4)) });
  }
  await browser.close();

  const measured = perFrame.filter((f) => typeof f.ssim === 'number');
  const missing = perFrame.length - measured.length;
  const out = {
    reference: ref.label, candidate: cand.label,
    // Dimensões INDEPENDENTES — nunca uma nota única.
    pageHeight: { reference: ref.geometry.pageHeight, candidate: cand.geometry.pageHeight, coverage: `${Math.round(100 * cand.geometry.pageHeight / (ref.geometry.pageHeight || 1))}%` },
    scrollReach: { reference: ref.geometry.maxScroll, candidate: cand.geometry.maxScroll },
    textChars: { reference: ref.geometry.textChars, candidate: cand.geometry.textChars },
    images: { reference: `${ref.geometry.imagesDecoded}/${ref.geometry.images}`, candidate: `${cand.geometry.imagesDecoded}/${cand.geometry.images}` },
    independence: cand.independence,
    // Terceira dimensão: quão previsível é EDITAR este artefato. Reportada
    // separada de propósito — um clone pode ser fiel e independente e ainda
    // ser péssimo de editar, que é exatamente o caso do site preservado.
    editability: {
      reference: ref.editability, candidate: cand.editability,
      candidateReachablePct: cand.editability?.inViewport
        ? `${Math.round(100 * cand.editability.reachable / cand.editability.inViewport)}%` : null,
      referenceReachablePct: ref.editability?.inViewport
        ? `${Math.round(100 * ref.editability.reachable / ref.editability.inViewport)}%` : null,
    },
    errors: cand.errors,
    ssim: { perFrame, min: measured.length ? Math.min(...measured.map((f) => f.ssim)) : null, framesMissing: missing },
  };
  console.log(JSON.stringify(out, null, 2));
  return out;
}

async function main() {
  const out = arg('--out', '_verbatim/run');
  const reference = arg('--reference');
  const candidate = arg('--candidate');
  const trajPath = arg('--trajectory');
  const cmp = process.argv.indexOf('--compare');

  if (cmp > -1) { await compare(process.argv[cmp + 1], process.argv[cmp + 2]); return; }

  const trajectory = trajPath && existsSync(trajPath) ? JSON.parse(await readFile(trajPath, 'utf8')) : null;

  if (reference) {
    const r = await measure({ label: `reference ${reference}`, outDir: out, url: reference, trajectory });
    console.log(JSON.stringify({ label: r.label, geometry: r.geometry, errors: r.errors, frames: r.frames.length }, null, 2));
    return;
  }
  if (candidate) {
    const [kind, ...rest] = candidate.split(':');
    const value = rest.join(':');
    if (kind === 'bundle') {
      const root = path.resolve(value);
      const assets = existsSync(path.join(root, 'assets')) ? path.join(root, 'assets') : root;
      if (!(await stat(assets).catch(() => null))) throw new Error(`bundle não encontrado: ${assets}`);
      const r = await measure({ label: `candidate bundle ${path.basename(root)}`, outDir: out, serveRoot: assets, trajectory });
      console.log(JSON.stringify({ label: r.label, geometry: r.geometry, independence: r.independence, errors: r.errors }, null, 2));
      return;
    }
    if (kind === 'file') {
      const file = path.resolve(value);
      const r = await measure({ label: `candidate file ${path.basename(file)}`, outDir: out, serveRoot: path.dirname(file), trajectory });
      console.log(JSON.stringify({ label: r.label, geometry: r.geometry, independence: r.independence, errors: r.errors }, null, 2));
      return;
    }
    throw new Error('--candidate precisa ser bundle:<dir> ou file:<arquivo.html>');
  }
  console.log('Use --reference <url> | --candidate bundle:<dir>|file:<html> | --compare <refDir> <candDir>');
}

main().catch((e) => { console.error(e); process.exit(1); });
