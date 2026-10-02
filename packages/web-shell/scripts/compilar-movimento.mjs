#!/usr/bin/env node
// COMPILADOR DE MOVIMENTO POR OBSERVAÇÃO (plano §165; "compilar por observação", Sol 2026-08-10).
//
// O movimento NÃO é estimado por um modelo: é lido das animações GSAP/ScrollTrigger VIVAS da
// captura nativa (alvos, valores de início e fim amostrados no próprio tween, duração, curva,
// trecho exato de rolagem, arrasto, pin) e escrito como fichas do programa de movimento v0.
// Os alvos do site são ligados aos nós da página canônica pelo CONTEÚDO que contêm: o
// extrator de inventário marca cada peça (data-u-chave) na captura viva; na canônica, cada nó
// com id tem as vagas (data-u-conteudo) do seu subtrecho; liga-se pelo maior Jaccard.
// Letras/palavras animadas (partes de texto dividido) viram UMA ficha no texto inteiro com
// `dividir` e `intervalo`. Lottie, canvas e objetos não-DOM ficam no relatório.
// Uso: node scripts/compilar-movimento.mjs --captura <assets-nativa> --extrator <inventario-conteudo.mjs>
//        --canonico <assets-canonica> [--saida motion.json] [--manter-lottie]
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { servir } from './inventario-conteudo.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };

// O MESMO `coletar` do extrator que gerou o inventário do agente, com uma marca em cada peça.
export async function coletarMarcando(extrator) {
  const src = await readFile(extrator, 'utf8');
  const i = src.indexOf('function coletar(origem) {'); const j = src.indexOf('\nexport async function inventariar');
  if (i < 0 || j < 0) throw new Error('coletar() nao encontrado no extrator');
  let corpo = src.slice(i, j);
  corpo = corpo.replace(/chave: chave\('([a-z])'\)/g, "chave: __marca(el, chave('$1'))");
  corpo = corpo.replace(/chave: `l-\$\{String\(out\.lotties\.length \+ 1\)\.padStart\(4, '0'\)\}`/g, "chave: __marca(el, `l-${String(out.lotties.length + 1).padStart(4, '0')}`)");
  return corpo;
}

function lerAnimacoes() {
  const g = window.gsap; if (!g) return { erro: 'gsap ausente na captura' };
  const CONTROLE = new Set(['duration', 'delay', 'ease', 'stagger', 'repeat', 'yoyo', 'repeatDelay', 'onComplete', 'onStart', 'onUpdate', 'onRepeat', 'onReverseComplete', 'onInterrupt', 'scrollTrigger', 'paused', 'immediateRender', 'overwrite', 'id', 'data', 'callbackScope', 'runBackwards', 'startAt', 'keyframes', 'inherit', 'lazy', 'yoyoEase', 'onCompleteParams', 'onUpdateParams', 'onStartParams', 'onRepeatParams', 'autoRound', 'modifiers', 'snap', 'reversed', 'defaults', 'smoothChildTiming', 'css', 'force3D', 'transformOrigin', 'svgOrigin', 'clearProps']);
  const chavesDe = (el) => { const ks = el.matches('[data-u-chave]') ? [el.getAttribute('data-u-chave')] : []; el.querySelectorAll('[data-u-chave]').forEach((d) => ks.push(d.getAttribute('data-u-chave'))); return ks; };
  const descreverAlvo = (t) => {
    if (!(t instanceof Element)) return { naoDom: true };
    const ks = chavesDe(t);
    const textoPai = ks.length ? null : (t.closest('[data-u-chave^="t-"]') && t.closest('[data-u-chave^="t-"]').getAttribute('data-u-chave'));
    return { chaves: ks, textoPai, tag: t.tagName.toLowerCase(), tamanhoParte: t.textContent.trim().length };
  };
  const st = (s) => s ? { start: Math.round(s.start), end: Math.round(s.end), scrub: s.vars.scrub === undefined ? false : s.vars.scrub, pin: Boolean(s.pin), pinChaves: s.pin instanceof Element ? chavesDe(s.pin) : [], acoes: s.vars.toggleActions || null } : null;
  const folhas = [];
  const andar = (anim, raiz, rel) => {
    if (anim.getChildren) { anim.getChildren(false, true, true).forEach((k) => andar(k, raiz, rel + k.startTime())); return; }
    const alvos = (anim.targets ? anim.targets() : []);
    const props = new Set(); Object.keys(anim.vars || {}).forEach((k) => { if (!CONTROLE.has(k)) props.add(k); });
    if (anim.vars && anim.vars.css && typeof anim.vars.css === 'object') Object.keys(anim.vars.css).forEach((k) => props.add(k));
    // VALORES OBSERVADOS: amostra o proprio tween no inicio e no fim, e restaura.
    let de = {}; let para = {}; const t0 = anim.totalTime();
    try {
      const alvo = alvos.find((x) => x instanceof Element);
      if (alvo) {
        anim.progress(0, true); props.forEach((p) => { de[p] = g.getProperty(alvo, p); });
        anim.progress(1, true); props.forEach((p) => { para[p] = g.getProperty(alvo, p); });
      }
    } catch (e) { de = {}; para = {}; }
    try { anim.totalTime(t0, true); } catch (e) { /* segue */ }
    const v = anim.vars || {}; const rv = (raiz && raiz.vars) || {};
    const stg = v.stagger; const intervalo = typeof stg === 'number' ? stg : (stg && typeof stg === 'object' ? (stg.each !== undefined ? stg.each : (stg.amount !== undefined && alvos.length > 1 ? stg.amount / (alvos.length - 1) : null)) : null);
    const ease = typeof v.ease === 'string' ? v.ease : (v.ease ? 'funcao' : (rv.defaults && typeof rv.defaults.ease === 'string' ? rv.defaults.ease : 'power1.out'));
    folhas.push({
      alvos: alvos.map(descreverAlvo), props: Array.from(props), de, para,
      duracao: anim.duration(), inicioRel: rel, duracaoRaiz: raiz ? raiz.duration() : anim.duration(), inicioRaiz: raiz ? raiz.startTime() : anim.startTime(),
      curva: ease, intervalo, repetir: v.repeat !== undefined ? v.repeat : (rv.repeat !== undefined ? rv.repeat : 0), vaiVolta: Boolean(v.yoyo || rv.yoyo),
      st: st(anim.scrollTrigger || (raiz && raiz.scrollTrigger)),
    });
  };
  g.globalTimeline.getChildren(false, true, true).forEach((r) => andar(r, r.getChildren ? r : null, 0));
  const todos = window.ScrollTrigger ? window.ScrollTrigger.getAll() : [];
  const soCallbacks = todos.filter((s) => !s.animation).length;
  // PINS de TODO gatilho (com ou sem animacao): no farmminerals os pins vivem em gatilhos
  // movidos por callback, invisiveis pela leitura de tweens.
  const pins = todos.filter((s) => s.pin).map((s) => st(s));
  return { folhas, pins, scrollTriggersSemAnimacao: soCallbacks };
}

const PROPS = new Set(['x', 'y', 'xPercent', 'yPercent', 'scale', 'scaleX', 'scaleY', 'rotate', 'rotation', 'skewX', 'skewY', 'opacity', 'autoAlpha', 'color', 'backgroundColor', 'borderColor', 'clipPath', 'filter', 'width', 'height', 'backgroundPosition', 'borderRadius', 'letterSpacing']);
const igual = (a, b) => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-3 : String(a) === String(b));
const num = (v) => (typeof v === 'number' ? Number(v.toFixed(4)) : v);

function mapeador(canonicos) {
  return (chaves) => {
    if (!chaves || !chaves.length) return null;
    const K = new Set(chaves); let melhor = null; let nota = 0; let tam = Infinity;
    for (const c of canonicos) {
      let inter = 0; for (const k of c.chaves) if (K.has(k)) inter += 1;
      if (!inter) continue;
      const j = inter / (K.size + c.chaves.length - inter);
      if (j > nota + 1e-9 || (Math.abs(j - nota) < 1e-9 && c.chaves.length < tam)) { melhor = c.id; nota = j; tam = c.chaves.length; }
    }
    return nota >= 0.5 ? melhor : null;
  };
}

export async function compilar({ captura, extrator, canonico }) {
  const corpo = await coletarMarcando(extrator);
  const { srv, origem } = await servir(path.resolve(captura));
  const browser = await chromium.launch();
  try {
    // 1. a captura VIVA (scripts do site rodando), marcada pelo mesmo coletar do inventario
    const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    await page.goto(`${origem}/index.html`, { waitUntil: 'load', timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(3000);
    const max = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < max; y += 900) { await page.evaluate((v) => window.scrollTo(0, v), y); await page.waitForTimeout(250); }
    await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(800);
    await page.evaluate(`window.__marca = (el, k) => { try { el.setAttribute('data-u-chave', k); } catch (e) {} return k; }; window.__marcaRun = (${corpo.replace(/__marca\(/g, 'window.__marca(')})(${JSON.stringify(origem)}); true`);
    const lido = await page.evaluate(lerAnimacoes);
    // 2. a canonica (so leitura): cada no com id e as vagas do seu subtrecho
    const ctx = await browser.newContext({ javaScriptEnabled: false });
    const cp = await ctx.newPage();
    await cp.setContent(await readFile(path.join(canonico, 'index.html'), 'utf8'));
    const canonicos = await cp.evaluate(() => Array.from(document.querySelectorAll('[id]')).map((el) => {
      const ks = el.matches('[data-u-conteudo]') ? [el.getAttribute('data-u-conteudo')] : [];
      el.querySelectorAll('[data-u-conteudo]').forEach((d) => ks.push(d.getAttribute('data-u-conteudo')));
      return { id: el.id, chaves: ks };
    }).filter((c) => c.chaves.length));
    return { lido, canonicos };
  } finally { await browser.close(); srv.close(); }
}

export function escreverFichas({ lido, canonicos }) {
  const mapear = mapeador(canonicos);
  const fichas = []; const rel = { folhas: 0, compiladas: 0, semAlvo: 0, alvosNaoMapeados: 0, naoDom: 0, propsDescartadas: {}, curvasFuncao: 0, pins: 0, scrollTriggersSemAnimacao: lido.scrollTriggersSemAnimacao || 0 };
  const pinsVistos = new Set(); let n = 0;
  const minCarga = Math.min(...lido.folhas.filter((f) => !f.st).map((f) => f.inicioRaiz + f.inicioRel), Infinity);
  for (const f of lido.folhas || []) {
    rel.folhas += 1;
    const de = {}; const para = {};
    for (const p of f.props) {
      if (!PROPS.has(p)) { rel.propsDescartadas[p] = (rel.propsDescartadas[p] || 0) + 1; continue; }
      if (f.de[p] === undefined || f.para[p] === undefined || igual(f.de[p], f.para[p])) continue;
      de[p] = num(f.de[p]); para[p] = num(f.para[p]);
    }
    if (!Object.keys(para).length && !(f.st && f.st.pin)) continue;
    // alvos: partes de UM texto dividido -> o texto inteiro com dividir
    const dom = f.alvos.filter((a) => !a.naoDom); rel.naoDom += f.alvos.length - dom.length;
    let alvo = null; let dividir = null;
    const pais = new Set(dom.map((a) => a.textoPai).filter(Boolean));
    if (dom.length && dom.every((a) => !a.chaves.length && a.textoPai) && pais.size === 1) {
      const id = mapear([[...pais][0]]); if (id) { alvo = '#' + id; dividir = dom.every((a) => a.tamanhoParte <= 2) ? 'chars' : 'words'; }
    } else {
      const ids = []; for (const a of dom) { const id = mapear(a.chaves.length ? a.chaves : (a.textoPai ? [a.textoPai] : [])); if (id) { if (!ids.includes(id)) ids.push(id); } else rel.alvosNaoMapeados += 1; }
      if (ids.length) alvo = ids.length === 1 ? '#' + ids[0] : ids.map((i) => '#' + i);
    }
    if (!alvo) { rel.semAlvo += 1; continue; }
    if (f.curva === 'funcao') rel.curvasFuncao += 1;
    const ficha = { id: `m-obs-${String(++n).padStart(3, '0')}`, alvo, de, para, duracao: num(f.duracao), curva: f.curva === 'funcao' ? 'none' : f.curva };
    if (dividir) ficha.dividir = dividir;
    if (f.intervalo) ficha.intervalo = num(f.intervalo);
    if (f.st) {
      const s = f.st; const span = Math.max(1, s.end - s.start); const dr = f.duracaoRaiz || f.duracao || 1;
      if (s.scrub) {
        ficha.motor = { tipo: 'rolagem', inicio: Math.round(s.start + (f.inicioRel / dr) * span), fim: Math.round(s.start + ((f.inicioRel + f.duracao) / dr) * span), arrasto: s.scrub === true ? true : num(s.scrub) };
      } else {
        ficha.motor = { tipo: 'rolagem', inicio: s.start, fim: s.end, arrasto: false, acoes: s.acoes || 'play none none none' };
        if (f.inicioRel) ficha.atraso = num(f.inicioRel);
      }
      if (s.pin) {
        const chave = `${s.start}:${s.end}`;
        if (!pinsVistos.has(chave)) {
          pinsVistos.add(chave); const id = mapear(s.pinChaves);
          if (id) { fichas.push({ id: `m-obs-pin-${pinsVistos.size}`, alvo: '#' + id, para: {}, motor: { tipo: 'rolagem', inicio: s.start, fim: s.end, arrasto: true, fixar: true } }); rel.pins += 1; }
        }
      }
      if (!Object.keys(para).length) continue;
    } else if (f.repetir === -1) {
      ficha.motor = { tipo: 'tempo' }; ficha.repetir = -1; if (f.vaiVolta) ficha.vaiVolta = true;
    } else {
      ficha.motor = { tipo: 'carga', atraso: num(Math.max(0, f.inicioRaiz + f.inicioRel - (Number.isFinite(minCarga) ? minCarga : 0))) };
    }
    if (f.repetir && f.repetir > 0) ficha.repetir = f.repetir;
    fichas.push(ficha); rel.compiladas += 1;
  }
  for (const s of lido.pins || []) {
    const chave = `${s.start}:${s.end}`; if (pinsVistos.has(chave)) continue;
    pinsVistos.add(chave); const id = mapear(s.pinChaves);
    if (id) { fichas.push({ id: `m-obs-pin-${pinsVistos.size}`, alvo: '#' + id, para: {}, motor: { tipo: 'rolagem', inicio: s.start, fim: s.end, arrasto: true, fixar: true } }); rel.pins += 1; }
    else rel.pinsNaoMapeados = (rel.pinsNaoMapeados || 0) + 1;
  }
  return { fichas, relatorio: rel };
}

if (process.argv[1] && process.argv[1].endsWith('compilar-movimento.mjs')) {
  const canonico = arg('--canonico'); const saida = arg('--saida', path.join(canonico, 'motion.json'));
  const dados = await compilar({ captura: arg('--captura'), extrator: arg('--extrator'), canonico });
  if (dados.lido.erro) { console.error(dados.lido.erro); process.exit(1); }
  const { fichas, relatorio } = escreverFichas(dados);
  let prog = { versao: 0, fichas };
  if (process.argv.includes('--manter-lottie')) {
    try { const antigo = JSON.parse(await readFile(path.join(canonico, 'motion.json'), 'utf8')); prog.fichas = fichas.concat((antigo.fichas || []).filter((f) => f.tipo === 'lottie')); if (antigo.rolagemSuave) prog.rolagemSuave = antigo.rolagemSuave; } catch { /* sem programa anterior */ }
  }
  await writeFile(saida, JSON.stringify(prog, null, 1));
  console.log(JSON.stringify({ ...relatorio, fichasEscritas: prog.fichas.length }, null, 1));
}
