#!/usr/bin/env node
// COBERTURA CANÔNICA DE EDIÇÃO (spec 2026-10-02-programa-de-movimento-v0 §4; esquema canônico).
//
// Denominador: unidades visíveis da REFERÊNCIA (O), contadas em paradas fixas de rolagem —
// blocos de texto (texto direto), mídia (img/video/svg/canvas/picture) e containers com peso
// visual (fundo, borda, sombra, raio). Numerador: unidades visíveis do candidato que cumprem
// o esquema: id DESCRITIVO e ÚNICO, texto simples (sem marcação filha, nem partes de letra
// gravadas), alcançável pelo clique e sem pointer-events:none herdado.
// Uso: node scripts/cobertura-canonica.mjs --referencia <url> --candidato <pasta-assets> [--paradas 24]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif', '.mp4': 'video/mp4', '.webm': 'video/webm' };

function sonda() {
  const ID_DESCRITIVO = /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/;   // u-hero-titulo; nunca hash nem so numero
  const descritivo = (id) => ID_DESCRITIVO.test(id) && /[a-z]{3,}/.test(id.replace(/^u-/, '')) && !/^el-[0-9a-f]+$/.test(id);
  const PARTE = '.u-palavra,.u-letra,.u-linha';
  const norm = (t) => t.replace(/\s+/g, ' ').trim().toLowerCase();
  const textoDireto = (el) => Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim());
  // Container de texto DIVIDIDO (nosso tocador ou SplitText do site): todos os filhos sao
  // partes curtas inline — conta como UMA unidade de texto com o texto inteiro, e as partes
  // nao contam (revisao Claude: as letras inflavam o denominador e o texto cortado sumia).
  const ehParteCurta = (c) => c.matches(PARTE) || (c.tagName === 'SPAN' && c.textContent.trim().length <= 24 && !c.querySelector('img,svg,video'));
  const divididoEm = (el) => el.children.length > 0 && !textoDireto(el) && Array.from(el.children).every(ehParteCurta) && norm(el.textContent).length > 0;
  const MIDIA = /^(IMG|VIDEO|SVG|CANVAS)$/;
  const peso = (cs) => (cs.backgroundColor && !/rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor)) || (cs.backgroundImage && cs.backgroundImage !== 'none')
    || parseFloat(cs.borderTopWidth) > 0 || (cs.boxShadow && cs.boxShadow !== 'none') || parseFloat(cs.borderTopLeftRadius) > 0;
  const opacidadeAcumulada = (el) => { let o = 1; for (let p = el; p && p !== document.documentElement; p = p.parentElement) o *= parseFloat(getComputedStyle(p).opacity); return o; };
  const contagemIds = {};
  document.querySelectorAll('[id]').forEach((e) => { contagemIds[e.id] = (contagemIds[e.id] || 0) + 1; });
  const unidades = [];
  for (const el of document.querySelectorAll('body *')) {
    const tag = el.tagName.toUpperCase();
    if (el.parentElement && divididoEm(el.parentElement)) continue;   // parte de texto dividido
    if (el.closest('svg') && tag !== 'SVG') continue;
    const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
    if (cs.visibility === 'hidden' || cs.display === 'none' || opacidadeAcumulada(el) < 0.05) continue;
    const ehTexto = textoDireto(el) || divididoEm(el); const ehMidia = MIDIA.test(tag); const ehBloco = !ehTexto && !ehMidia && peso(cs);
    if (!ehTexto && !ehMidia && !ehBloco) continue;
    // CHAVE para parear referencia x candidato e contar cada unidade UMA vez (revisao Claude, P0):
    // texto pelo texto normalizado; midia pelas dimensoes naturais; bloco pela caixa na pagina.
    const yPag = Math.round((r.top + scrollY) / 40); const xPag = Math.round(r.left / 40);
    let chave;
    if (ehTexto) chave = 't:' + norm(el.textContent).slice(0, 120);
    else if (tag === 'IMG') chave = 'm:img:' + el.naturalWidth + 'x' + el.naturalHeight + ':' + yPag;
    else if (tag === 'VIDEO') chave = 'm:video:' + yPag + ':' + xPag;
    else if (ehMidia) chave = 'm:' + tag.toLowerCase() + ':' + Math.round(r.width / 20) + 'x' + Math.round(r.height / 20) + ':' + yPag + ':' + xPag;
    else chave = 'b:' + Math.round(r.width / 40) + 'x' + Math.round(r.height / 40) + ':' + yPag + ':' + xPag;
    let falha = null;
    if (!el.id) falha = 'semId';
    else if (!descritivo(el.id)) falha = 'idNaoDescritivo';
    else if (contagemIds[el.id] > 1) falha = 'idRepetido';
    else if (textoDireto(el) && Array.from(el.children).some((c) => !c.matches(PARTE + ',br'))) falha = 'textoComMarcacao';
    else {
      // Alcance pelo CLIQUE real: elementFromPoint ja respeita pointer-events (um filho com
      // pointer-events:auto sob pai none e clicavel) — revisao Claude.
      const cx = Math.max(1, Math.min(innerWidth - 1, r.left + Math.min(8, r.width / 2)));
      const cy = Math.max(1, Math.min(innerHeight - 1, r.top + r.height / 2));
      const hit = document.elementFromPoint(cx, cy);
      if (!(hit && (hit === el || el.contains(hit)))) falha = 'inalcancavel';
    }
    unidades.push({ chave, falha });
  }
  return unidades;
}

async function percorrer(url, paradas) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
    await page.goto(url, { waitUntil: 'load', timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(4000);
    const max = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
    // Cada unidade conta UMA vez no percurso (chave); canonica se for canonica em ALGUMA parada.
    const porChave = new Map();
    for (let i = 0; i < paradas; i += 1) {
      const y = Math.round((max * i) / Math.max(1, paradas - 1));
      await page.evaluate((v) => window.scrollTo(0, v), y); await page.waitForTimeout(1500);
      for (const u of await page.evaluate(sonda)) {
        const prev = porChave.get(u.chave);
        if (prev === undefined || (prev !== null && u.falha === null)) porChave.set(u.chave, u.falha);
      }
    }
    const motivos = {}; let canonicas = 0;
    for (const f of porChave.values()) { if (f === null) canonicas += 1; else motivos[f] = (motivos[f] || 0) + 1; }
    return { unidades: porChave.size, canonicas, motivos, chaves: porChave };
  } finally { await browser.close(); }
}

async function servir(pasta) {
  const srv = createServer(async (req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
    try { const b = await readFile(path.join(pasta, p)); res.writeHead(200, { 'content-type': TIPOS[path.extname(p).toLowerCase()] || 'application/octet-stream' }); res.end(b); } catch { res.writeHead(404); res.end(); }
  });
  await new Promise((d) => srv.listen(0, '127.0.0.1', d));
  return { srv, url: `http://127.0.0.1:${srv.address().port}/index.html` };
}

const paradas = Number(arg('--paradas', 24));
const ref = arg('--referencia'); const cand = arg('--candidato');
const O = ref ? await percorrer(ref, paradas) : null;
let R = null;
if (cand) { const { srv, url } = await servir(path.resolve(cand)); try { R = await percorrer(url, paradas); } finally { srv.close(); } }
const resumo = (x) => x && { unidades: x.unidades, canonicas: x.canonicas, motivos: x.motivos };
const saida = { referencia: resumo(O), candidato: resumo(R) };
if (O && R) {
  // PAREADA: unidades da referencia que existem no candidato E la sao canonicas.
  let achadas = 0; let canonicas = 0; const faltando = [];
  for (const k of O.chaves.keys()) {
    if (!R.chaves.has(k)) { if (faltando.length < 15) faltando.push(k); continue; }
    achadas += 1; if (R.chaves.get(k) === null) canonicas += 1;
  }
  saida.cobertura = {
    valor: Number((canonicas / Math.max(1, O.unidades)).toFixed(3)),
    unidadesDaReferencia: O.unidades, encontradasNoCandidato: achadas, canonicasNoCandidato: canonicas,
    amostraNaoEncontradas: faltando,
    nota: 'pareada por chave (texto normalizado; midia por dimensao/posicao; bloco por caixa) — cada unidade conta uma vez; persistencia apos reload NAO medida (ids estaticos no HTML)',
  };
}
console.log(JSON.stringify(saida, null, 2));
