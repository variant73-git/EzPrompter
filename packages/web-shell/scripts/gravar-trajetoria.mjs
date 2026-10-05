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

export function medir(atributo) {
  const out = {};
  for (const el of document.querySelectorAll(`[${atributo}]`)) {
    const k = el.getAttribute(atributo); const r = el.getBoundingClientRect();
    if (r.width < 1 && r.height < 1) { out[k] = null; continue; }
    let op = 1; for (let p = el; p && p !== document.documentElement; p = p.parentElement) op *= parseFloat(getComputedStyle(p).opacity);
    out[k] = { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, op };
  }
  return out;
}

// ⭐ LEITURA DIRETA (v3, 2026-10-02). Quando a estrutura canonica E o esqueleto do site
// (normalizar-clone.mjs), cada elemento do site tem um gemeo com o mesmo papel; entao se le o
// estado PROPRIO de cada um (transformacao decomposta, opacidade, visibilidade, recorte) e se
// grava em valores ABSOLUTOS. A v1 (acima) media DIFERENCA de caixa contra uma pagina parada,
// que so faz sentido quando as estruturas divergem. Sobre o esqueleto ela errava de tres jeitos
// (medido no farmminerals, SSIM identico com e sem as 603 fichas): o tocador aplica x/y
// ABSOLUTOS sobre a transformacao congelada, a revelacao era lida no MEIO (0 -> 0,1 em vez de
// 0 -> 1) e a visibilidade nao era lida (a secao que cobre o hero fica `hidden` no topo).
// Alem da transformacao: propriedades que o MOTOR do site escreve inline (Webflow IX e GSAP
// escrevem em style="") — farmminerals: as 15 celulas creme que cobrem o hero animam `height`
// de 0% a 100% pela rolagem. So entra o que esteve inline em alguma leitura (uma altura que muda
// porque o filho cresceu e layout, nao animacao); o valor gravado e o COMPUTADO (px, rgb).
export const PROPS_INLINE = { width: 'width', height: 'height', 'background-color': 'backgroundColor', color: 'color', 'border-color': 'borderColor', filter: 'filter', 'border-radius': 'borderRadius', 'letter-spacing': 'letterSpacing', 'background-position': 'backgroundPosition', top: null, left: null, right: null, bottom: null, 'max-height': null, 'max-width': null };
export function medirProprio(atributo) {
  const out = {};
  const NOMES = Object.keys(window.__uPropsInline || {});
  const vistos = (window.__uInlineVisto ||= new WeakMap());
  for (const el of document.querySelectorAll(`[${atributo}]`)) {
    const k = el.getAttribute(atributo); const cs = getComputedStyle(el);
    if (cs.display === 'none') { out[k] = null; continue; }
    let a = 1, b = 0, c = 0, d = 1, e = 0, f = 0, tres = false;
    const t = cs.transform;
    if (t && t !== 'none') {
      const v = t.slice(t.indexOf('(') + 1, -1).split(',').map(Number);
      if (t.startsWith('matrix3d')) { [a, b] = v; [c, d] = [v[4], v[5]]; [e, f] = [v[12], v[13]]; tres = Math.abs(v[2]) + Math.abs(v[6]) + Math.abs(v[8]) + Math.abs(v[9]) + Math.abs(v[3]) + Math.abs(v[7]) + Math.abs(v[11]) > 1e-6 || Math.abs(v[10] - 1) > 1e-6; } else [a, b, c, d, e, f] = v;
    }
    const sx = Math.hypot(a, b);
    let visto = vistos.get(el);
    for (const nm of NOMES) if (el.style.getPropertyValue(nm)) { if (!visto) vistos.set(el, (visto = new Set())); visto.add(nm); }
    let css;
    if (visto) { css = {}; for (const nm of visto) css[nm] = cs.getPropertyValue(nm); }
    // visibilidade e HERDADA: `vis` e a PROPRIA (so 0 quando o pai esta visivel e este nao — a
    // herdada fica com o pai, senao cada descendente ganhava ficha propria, revisao Claude #6);
    // `vef` e a efetiva (o que se ve), usada so para comparar
    const pai = el.parentElement; const pvis = pai ? getComputedStyle(pai).visibility : 'visible';
    // cor de fundo CALCULADA de todos (landonorris: o fundo da pagina muda com a rolagem por classe, sem
    // escrever no style); cor do texto so do <body> — e a raiz da heranca, a dos outros so muda por ele
    out[k] = { x: e, y: f, sx, sy: sx ? (a * d - b * c) / sx : 0, r: Math.atan2(b, a) * 180 / Math.PI, op: parseFloat(cs.opacity), vis: cs.visibility === 'hidden' && pvis !== 'hidden' ? 0 : 1, vef: cs.visibility === 'hidden' ? 0 : 1, clip: cs.clipPath, tres, bg: cs.backgroundColor, ...(el === document.body ? { cor: cs.color } : {}), ...(css ? { css } : {}) };
  }
  return out;
}

const LIM = { px: 1, esc: 0.005, rot: 0.5, op: 0.01 };
function cssDifere(u, v) {
  if (!u || !v) return false;   // o canal nasce na 1a leitura inline; antes dela vale o primeiro valor visto
  for (const nm of Object.keys(u)) {
    if (!(nm in v)) continue;
    const a = parseFloat(u[nm]); const b = parseFloat(v[nm]);
    if (/^-?[\d.]+px$/.test(u[nm]) && /^-?[\d.]+px$/.test(v[nm])) { if (Math.abs(a - b) > LIM.px) return true; } else if (u[nm] !== v[nm]) return true;
  }
  return false;
}
export function difere(p, q) {
  if (!p || !q) return Boolean(p) !== Boolean(q);
  if (p.vef === 0 && q.vef === 0) return false;   // dois estados invisiveis sao o mesmo para quem ve
  return cssDifere(p.css, q.css) || Math.abs(p.x - q.x) > LIM.px || Math.abs(p.y - q.y) > LIM.px || Math.abs(p.sx - q.sx) > LIM.esc || Math.abs(p.sy - q.sy) > LIM.esc
    || Math.abs(p.r - q.r) > LIM.rot || Math.abs(p.op - q.op) > LIM.op || p.vis !== q.vis || p.clip !== q.clip
    || (p.bg !== undefined && q.bg !== undefined && p.bg !== q.bg) || (p.cor !== undefined && q.cor !== undefined && p.cor !== q.cor);
}

// quais canais variam entre estados; visibilidade que muda vira autoAlpha (opacidade + visibilidade)
function canais(estados) {
  const v = (fn, lim) => estados.some((s) => Math.abs(fn(s) - fn(estados[0])) > lim);
  const vis = estados.some((s) => s.vis !== estados[0].vis);
  const ch = [];
  if (v((s) => s.x, LIM.px)) ch.push('x'); if (v((s) => s.y, LIM.px)) ch.push('y');
  const sxv = v((s) => s.sx, LIM.esc); const syv = v((s) => s.sy, LIM.esc);
  if (sxv || syv) { if (estados.every((s) => Math.abs(s.sx - s.sy) <= LIM.esc)) ch.push('scale'); else ch.push('scaleX', 'scaleY'); }
  if (v((s) => s.r, LIM.rot)) ch.push('rotation');
  if (vis) ch.push('autoAlpha'); else if (v((s) => s.op, LIM.op)) ch.push('opacity');
  if (estados.some((s) => s.clip !== estados[0].clip) && estados.every((s) => s.clip && s.clip !== 'none')) ch.push('clipPath');
  if (estados.every((s) => s.bg !== undefined) && estados.some((s) => s.bg !== estados[0].bg)) ch.push('backgroundColor');
  if (estados.every((s) => s.cor !== undefined) && estados.some((s) => s.cor !== estados[0].cor)) ch.push('color');
  const nomes = new Set(); estados.forEach((s) => s.css && Object.keys(s.css).forEach((nm) => nomes.add(nm)));
  for (const nm of nomes) {
    if ((nm === 'background-color' && ch.includes('backgroundColor')) || (nm === 'color' && ch.includes('color'))) continue;   // ja no canal calculado
    const vals = estados.map((s) => s.css && s.css[nm]).filter((v) => v !== undefined);
    const muda = vals.some((v, i) => i && cssDifere({ [nm]: v }, { [nm]: vals[0] }));
    if (muda) ch.push('css:' + nm);
  }
  return ch;
}
const r3 = (n) => Math.round(n * 1000) / 1000;
function valores(s, ch) {
  const o = {};
  for (const c of ch) {
    if (c === 'x') o.x = r3(s.x); else if (c === 'y') o.y = r3(s.y); else if (c === 'scale') o.scale = r3(s.sx);
    else if (c === 'scaleX') o.scaleX = r3(s.sx); else if (c === 'scaleY') o.scaleY = r3(s.sy); else if (c === 'rotation') o.rotation = r3(s.r);
    else if (c === 'backgroundColor') o.backgroundColor = s.bg; else if (c === 'color') o.color = s.cor;
    else if (c === 'autoAlpha') o.autoAlpha = s.vis ? r3(s.op) : 0; else if (c === 'opacity') o.opacity = r3(s.op); else if (c === 'clipPath') o.clipPath = s.clip;
    else if (c.startsWith('css:')) { const nm = c.slice(4); const g = PROPS_INLINE[nm]; if (g && s.css && s.css[nm] !== undefined) o[g] = s.css[nm]; }
  }
  return o;
}

// o canal inline aparece na 1a leitura em que o motor o escreveu; antes dela vale o 1o valor visto
export function preencherCss(serie) {
  const nomes = new Set(); serie.forEach((s) => s && s.css && Object.keys(s.css).forEach((nm) => nomes.add(nm)));
  for (const nm of nomes) {
    const prim = serie.find((s) => s && s.css && s.css[nm] !== undefined).css[nm];
    let ult = prim;
    for (const s of serie) { if (!s) continue; s.css ||= {}; if (s.css[nm] === undefined) s.css[nm] = ult; else ult = s.css[nm]; }
  }
}
// canal que o tocador nao anima (top/left...): contado e retirado, nunca escrito
function contarFora(ch, rel) { const fora = (c) => c.startsWith('css:') && !PROPS_INLINE[c.slice(4)]; for (const c of ch) if (fora(c)) rel.canaisForaDoContrato[c.slice(4)] = (rel.canaisForaDoContrato[c.slice(4)] || 0) + 1; return ch.filter((c) => !fora(c)); }

// amostras: [{ y, a, b }] com a/b = medirProprio por etiqueta; mapa: etiqueta -> id canonico;
// lacos: etiquetas que mudam com a pagina PARADA (laco de tempo: v3 nao grava)
export function fichasPorLeitura({ amostras, mapa, lacos = new Set() }, passo) {
  const chaves = new Set(); amostras.forEach((s) => Object.keys(s.b).forEach((k) => chaves.add(k)));
  const rel = { pecas: chaves.size, semMovimento: 0, semId: 0, revelacoes: 0, rolagens: 0, lacosNaoGravados: 0, mudaDisplay: 0, transitorios: 0, tres: 0 };
  const fichas = []; let n = 0;
  rel.canaisForaDoContrato = {};
  for (const k of chaves) {
    const B = amostras.map((s) => s.b[k]); const A = amostras.map((s) => s.a[k]);
    preencherCss(B);
    const idx = B.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) continue;
    if (B.some((v) => v === null)) { rel.mudaDisplay += 1; continue; }
    const mud = []; for (let j = 1; j < idx.length; j += 1) if (difere(B[idx[j]], B[idx[j - 1]])) mud.push(idx[j]);
    const tempo = idx.filter((i) => A[i] && difere(A[i], B[i]));
    if (!mud.length && !tempo.length) { rel.semMovimento += 1; continue; }
    const id = mapa[k]; if (!id) { rel.semId += 1; continue; }
    if (lacos.has(k)) { rel.lacosNaoGravados += 1; continue; }
    if (!mud.length) { rel.transitorios += 1; continue; }
    if (idx.some((i) => B[i].tres)) rel.tres += 1;
    const antes = idx.filter((i) => i < mud[0]).pop();
    const janela = mud[mud.length - 1] - mud[0];
    const revelacao = antes !== undefined && tempo.length && janela <= 3 && tempo.every((t) => t >= mud[0] - 1 && t <= mud[mud.length - 1] + 1);
    if (revelacao) {
      // REVELACAO: disparada pela rolagem, corre no tempo; o fim e o estado ASSENTADO (ultima leitura)
      const de = B[antes]; const para = B[idx[idx.length - 1]];
      const ch = contarFora(canais([de, para]), rel); if (!ch.length) { rel.transitorios += 1; continue; }
      const inicio = Math.max(0, Math.round(amostras[mud[0]].y - passo / 2));
      fichas.push({ id: `m-leit-${String(++n).padStart(3, '0')}`, alvo: '#' + id, de: valores(de, ch), para: valores(para, ch), duracao: 0.8, curva: 'power2.out', motor: { tipo: 'rolagem', inicio, fim: inicio + passo, arrasto: false, acoes: 'play none none none' } });
      rel.revelacoes += 1; continue;
    }
    // ROLAGEM: quadros a cada `passo` px do trecho ativo. O 1o segmento do GSAP vai do estado atual
    // ao 1o quadro, entao o inicio recua um passo para o quadro i cair exatamente em y(i0 + i).
    const i0 = antes !== undefined ? antes : mud[0]; const i1 = mud[mud.length - 1];
    const trecho = []; let ult = B[i0];
    for (let i = i0; i <= i1; i += 1) { if (B[i]) ult = B[i]; trecho.push(ult); }
    const ch = contarFora(canais(trecho), rel); if (!ch.length || trecho.length < 2) { rel.transitorios += 1; continue; }
    let qs = trecho; let inicio = amostras[i0].y - passo;
    // movimento que comeca no TOPO (i0 = 0): recuar um passo daria rolagem negativa, e o 0 grampeado
    // espremia os quadros (o k-esimo chegava ate um passo atrasado, revisao Claude #7). O 1o quadro
    // E o estado em repouso da canonica: sai, e o arrasto comeca em y(i0).
    if (inicio < 0) { qs = trecho.slice(1); inicio = amostras[i0].y; }
    const motor = { tipo: 'rolagem', inicio, fim: amostras[i1].y, arrasto: true };
    if (qs.length === 1) fichas.push({ id: `m-leit-${String(++n).padStart(3, '0')}`, alvo: '#' + id, para: valores(qs[0], ch), curva: 'none', motor });
    else fichas.push({ id: `m-leit-${String(++n).padStart(3, '0')}`, alvo: '#' + id, quadros: qs.map((s) => ({ ...valores(s, ch), ease: 'none' })), curva: 'none', motor });
    rel.rolagens += 1;
  }
  return { fichas, relatorio: rel };
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

export function fichasDaTrajetoria({ amostras, ids, pais = {} }, passo, { semBase = false } = {}) {
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
    // semBase: a canonica e o PROPRIO site congelado no topo — toda diferenca e movimento
    const mx = semBase ? 0 : mediana(dx); const my = semBase ? 0 : mediana(dy);
    const q = util.map((p, i) => { const h = herdado(k, p.y); return { y: p.y, x: dx[i] - mx - h.x, yy: dy[i] - my - h.yy, s: p.c.w ? p.b.w / p.c.w : 1, op: h.op > 0.01 ? Math.min(1, p.b.op / h.op) : p.b.op, tempo: p.a && (Math.abs(p.a.cx - p.b.cx) > MIN_PX || Math.abs(p.a.cy - p.b.cy) > MIN_PX || Math.abs(p.a.op - p.b.op) > MIN_OPAC) }; });
    const sMed = semBase ? 1 : mediana(q.map((p) => p.s));
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
