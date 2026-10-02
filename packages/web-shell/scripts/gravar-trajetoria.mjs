#!/usr/bin/env node
// CAMINHO 1 — GRAVADOR DE TRAJETÓRIA (plano §166/§167): compila o movimento OBSERVANDO a página
// renderizada, qualquer que seja o motor que a anima (GSAP, Webflow, CSS, código próprio).
//
// Cada peça de conteúdo existe nos DOIS lados com a mesma chave: `data-u-chave` na captura
// nativa (marcada pelo mesmo `coletar` do inventário) e `data-u-conteudo` na canônica. Ao longo
// de toda a rolagem, a cada PASSO px, mede-se na captura VIVA (scripts rodando, rolagem suave
// substituída pela nativa) o centro, a largura e a opacidade acumulada de cada peça — duas
// vezes, a ASSENTA ms e a MEDIDO ms, para separar movimento de ROLAGEM (igual nas duas
// leituras) de movimento de TEMPO (revelação disparada, laço). A canônica é medida PARADA (sem
// JavaScript). O movimento é a DIFERENÇA que varia; a parte constante (diferença de layout)
// não vira ficha.
// Uso: node scripts/gravar-trajetoria.mjs --captura <assets-nativa> --extrator <inventario.mjs>
//        --canonico <assets-canonica> [--passo 100] [--manter-lottie]
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { servir } from './inventario-conteudo.mjs';
import { coletarMarcando } from './compilar-movimento.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const ASSENTA = 300; const MEDIDO = 1100;
// Limiares do que conta como movimento (px de tela, fração de escala, opacidade).
const MIN_PX = 3; const MIN_ESCALA = 0.02; const MIN_OPAC = 0.05;

function medir(atributo) {
  const out = {};
  for (const el of document.querySelectorAll(`[${atributo}]`)) {
    const k = el.getAttribute(atributo); const r = el.getBoundingClientRect();
    if (r.width < 1 && r.height < 1) { out[k] = null; continue; }
    let op = 1; for (let p = el; p && p !== document.documentElement; p = p.parentElement) op *= parseFloat(getComputedStyle(p).opacity);
    out[k] = { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, op };
  }
  return out;
}

async function rolarE(page, y) { await page.evaluate((v) => window.scrollTo(0, v), y); }

export async function gravar({ captura, extrator, canonico, passo = 100 }) {
  const corpo = await coletarMarcando(extrator);
  const { srv, origem } = await servir(path.resolve(captura));
  const canonSrv = await servir(path.resolve(canonico));
  const browser = await chromium.launch();
  try {
    // captura VIVA, com a rolagem suave trocada por uma de mentira (rolagem exata por posição)
    const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    await page.addInitScript(() => {
      const Falso = function () { this.on = () => {}; this.raf = () => {}; this.destroy = () => {}; this.start = () => {}; this.stop = () => {}; this.scrollTo = (y) => window.scrollTo(0, typeof y === 'number' ? y : 0); this.resize = () => {}; };
      Object.defineProperty(window, 'Lenis', { configurable: true, get: () => Falso, set: () => {} });
    });
    await page.goto(`${origem}/index.html`, { waitUntil: 'load', timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(3000);
    await page.evaluate(`window.__marca = (el, k) => { try { el.setAttribute('data-u-chave', k); } catch (e) {} return k; }; (${corpo.replace(/__marca\(/g, 'window.__marca(')})(${JSON.stringify(origem)}); true`);
    const max = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
    // canônica PARADA
    const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 1200 } });
    const cp = await ctx.newPage();
    await cp.goto(`${canonSrv.origem}/index.html`, { waitUntil: 'load', timeout: 60000 }).catch(() => {});
    await cp.waitForTimeout(1500);
    const ids = await cp.evaluate(() => Object.fromEntries(Array.from(document.querySelectorAll('[data-u-conteudo]')).map((e) => [e.getAttribute('data-u-conteudo'), e.id || null])));
    // pai de cada peca na canonica (a vaga mais proxima acima): o filho grava so o que difere do pai
    const pais = await cp.evaluate(() => Object.fromEntries(Array.from(document.querySelectorAll('[data-u-conteudo]')).map((e) => { const p = e.parentElement && e.parentElement.closest('[data-u-conteudo]'); return [e.getAttribute('data-u-conteudo'), p ? p.getAttribute('data-u-conteudo') : null]; })));
    const amostras = [];
    for (let y = 0; y <= max; y += passo) {
      await rolarE(page, y); await page.waitForTimeout(ASSENTA); const a = await page.evaluate(medir, 'data-u-chave');
      await page.waitForTimeout(MEDIDO - ASSENTA); const b = await page.evaluate(medir, 'data-u-chave');
      await rolarE(cp, y); await cp.waitForTimeout(50); const c = await cp.evaluate(medir, 'data-u-conteudo');
      amostras.push({ y, a, b, c });
    }
    return { amostras, ids, pais, max };
  } finally { await browser.close(); srv.close(); canonSrv.srv.close(); }
}

const mediana = (v) => { const s = v.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

export function fichasDaTrajetoria({ amostras, ids, pais = {} }, passo) {
  const chaves = new Set(); amostras.forEach((s) => Object.keys(s.b).forEach((k) => { if (s.c[k] !== undefined) chaves.add(k); }));
  const fichas = []; const rel = { pecas: chaves.size, comMovimentoDeRolagem: 0, comMovimentoDeTempo: 0, semId: 0, semMovimento: 0 }; let n = 0;
  // pais antes dos filhos
  const prof = (k) => { let d = 0; for (let p = pais[k]; p; p = pais[p]) d += 1; return d; };
  const ordem = [...chaves].sort((x, y) => prof(x) - prof(y));
  const animado = new Map();   // chave -> Map(y -> {x, yy, op}) do que JA foi gravado
  const herdado = (k, y) => { let x = 0; let yy = 0; let op = 1; for (let p = pais[k]; p; p = pais[p]) { const m = animado.get(p); const v = m && m.get(y); if (v) { x += v.x; yy += v.yy; op *= v.op; } } return { x, yy, op }; };
  for (const k of ordem) {
    const serie = amostras.map((s) => ({ y: s.y, a: s.a[k], b: s.b[k], c: s.c[k] })).filter((p) => p.b && p.c);
    if (serie.length < 3) continue;
    // so onde a peca esta na tela (ou perto): fora dela a posicao e irrelevante
    const util = serie.filter((p) => p.b.cy > -600 && p.b.cy < 1800);
    if (util.length < 3) continue;
    const dx = util.map((p) => p.b.cx - p.c.cx); const dy = util.map((p) => p.b.cy - p.c.cy);
    const mx = mediana(dx); const my = mediana(dy);
    const q = util.map((p, i) => { const h = herdado(k, p.y); return { y: p.y, x: dx[i] - mx - h.x, yy: dy[i] - my - h.yy, s: p.c.w ? p.b.w / p.c.w : 1, op: h.op > 0.01 ? Math.min(1, p.b.op / h.op) : p.b.op, tempo: p.a && (Math.abs(p.a.cx - p.b.cx) > MIN_PX || Math.abs(p.a.cy - p.b.cy) > MIN_PX || Math.abs(p.a.op - p.b.op) > MIN_OPAC) }; });
    const sMed = mediana(q.map((p) => p.s));
    const varia = (p) => Math.abs(p.x) > MIN_PX || Math.abs(p.yy) > MIN_PX || Math.abs(p.s / sMed - 1) > MIN_ESCALA || p.op < 1 - MIN_OPAC;
    const ativos = q.filter(varia);
    if (!ativos.length) { rel.semMovimento += 1; continue; }
    const id = ids[k]; if (!id) { rel.semId += 1; continue; }
    // movimento de TEMPO disparado pela rolagem (revelacao): a peca ainda mudava entre as leituras
    const disparos = q.filter((p) => p.tempo);
    if (disparos.length) {
      rel.comMovimentoDeTempo += 1;
      const p0 = disparos[0];
      const amostra = amostras.find((s) => s.y === p0.y); const A = amostra.a[k]; const B = amostra.b[k]; const C = amostra.c[k];
      if (A && B && C) {
        const de = {}; const para = {};
        const ax = A.cx - B.cx; const ay = A.cy - B.cy;
        if (Math.abs(ax) > MIN_PX) { de.x = Math.round(ax); para.x = 0; }
        if (Math.abs(ay) > MIN_PX) { de.y = Math.round(ay); para.y = 0; }
        if (Math.abs(A.op - B.op) > MIN_OPAC) { de.opacity = Number(A.op.toFixed(3)); para.opacity = Number(B.op.toFixed(3)); }
        if (Object.keys(para).length) {
          fichas.push({ id: `m-traj-${String(++n).padStart(3, '0')}`, alvo: '#' + id, de, para, duracao: 0.8, curva: 'power2.out', motor: { tipo: 'rolagem', inicio: Math.max(0, p0.y - passo), fim: p0.y + 1200, arrasto: false, acoes: 'play none none none' } });
          continue;
        }
      }
    }
    // movimento de ROLAGEM: quadros ao longo do trecho ativo (amostras uniformes em px)
    rel.comMovimentoDeRolagem += 1;
    const i0 = Math.max(0, q.indexOf(ativos[0]) - 1); const i1 = Math.min(q.length - 1, q.indexOf(ativos[ativos.length - 1]) + 1);
    const trecho = q.slice(i0, i1 + 1);
    const quadros = trecho.map((p) => {
      const f = {};
      f.x = Math.round(p.x); f.y = Math.round(p.yy);
      const s = p.s / sMed; if (Math.abs(s - 1) > MIN_ESCALA || trecho.some((t) => Math.abs(t.s / sMed - 1) > MIN_ESCALA)) f.scale = Number(s.toFixed(3));
      f.opacity = Number(Math.min(1, p.op).toFixed(3));
      return f;
    });
    if (quadros.length < 2) continue;
    animado.set(k, new Map(trecho.map((p) => [p.y, { x: p.x, yy: p.yy, op: Math.min(1, p.op) }])));
    fichas.push({ id: `m-traj-${String(++n).padStart(3, '0')}`, alvo: '#' + id, quadros, curva: 'none', motor: { tipo: 'rolagem', inicio: trecho[0].y, fim: trecho[trecho.length - 1].y, arrasto: true } });
  }
  return { fichas, relatorio: rel };
}

if (process.argv[1] && process.argv[1].endsWith('gravar-trajetoria.mjs')) {
  const canonico = arg('--canonico'); const passo = Number(arg('--passo', 100));
  const t0 = Date.now();
  const dados = await gravar({ captura: arg('--captura'), extrator: arg('--extrator'), canonico, passo });
  const { fichas, relatorio } = fichasDaTrajetoria(dados, passo);
  const prog = { versao: 0, fichas };
  if (process.argv.includes('--manter-lottie')) {
    try { const antigo = JSON.parse(await readFile(path.join(canonico, 'motion.json'), 'utf8')); prog.fichas = fichas.concat((antigo.fichas || []).filter((f) => f.tipo === 'lottie')); } catch { /* sem programa */ }
  }
  await writeFile(path.join(canonico, 'motion.json'), JSON.stringify(prog, null, 1));
  console.log(JSON.stringify({ ...relatorio, amostras: dados.amostras.length, fichasEscritas: prog.fichas.length, segundos: Math.round((Date.now() - t0) / 1000) }, null, 1));
}
