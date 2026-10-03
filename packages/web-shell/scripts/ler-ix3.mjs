// CAMINHO 2 — leitor DECLARATIVO das interacoes do Webflow (IX3, "Interactions with GSAP") para
// fichas do programa de movimento (docs/superpowers/specs/2026-10-02-programa-de-movimento-v0.md).
//
// O site declara cada interacao como DADO num `ix3.getInstance().register(interacoes, linhas)`:
// gatilho (rolagem com a config do ScrollTrigger, carga, clique), alvos (classe, seletor,
// atributo, instancia, relativos ao gatilho) e linhas de tempo com acoes de/para, duracao,
// posicao, escalonamento, curva e divisao de texto. Aqui esse dado e lido (num contexto vm SEM
// globais: e literal, sem funcoes) e traduzido. Os alvos sao resolvidos NA PAGINA DA CAPTURA,
// na mesma sessao da normalizacao, onde cada elemento ja leva o id canonico (`data-u-id`).
//
// Valores do runtime do Webflow lidos do proprio bundle (webflow.schunk, farmminerals 2026-10):
//   tt: 0 = to, 1 = from, 2 = fromTo, 3 = set;  ease: indice em CURVAS_IX3 (ordem do runtime);
//   duracao ausente = DEFAULTS.DURATION = 0,5 s (MEDIDO no site vivo: os tweens que o IX3 monta para
//   uma acao sem `duration` tem duration() 0,5; a curva de indice 8 sai power3.out — 2026-10-02);
//   immediateRender desligado na acao que repete uma propriedade ja animada do MESMO alvo.
// Fora (contados, nunca escritos): clique (escopo da captura = layout, rolagem, hover), display,
// Lottie controlada pela linha, mascara da divisao de texto, gatilho/alvo de tipo desconhecido.
import vm from 'node:vm';

export const CURVAS_IX3 = ['none', 'power1.in', 'power1.out', 'power1.inOut', 'power2.in', 'power2.out', 'power2.inOut', 'power3.in', 'power3.out', 'power3.inOut', 'power4.in', 'power4.out', 'power4.inOut', 'back.in', 'back.out', 'back.inOut', 'bounce.in', 'bounce.out', 'bounce.inOut', 'circ.in', 'circ.out', 'circ.inOut', 'elastic.in', 'elastic.out', 'elastic.inOut', 'expo.in', 'expo.out', 'expo.inOut', 'sine.in', 'sine.out', 'sine.inOut'];
export const DURACAO_PADRAO = 0.5;

// fecha o parentese da chamada respeitando strings (o literal nao tem funcoes nem regex)
function fecharChamada(js, abre) {
  let d = 0; let q = null;
  for (let j = abre; j < js.length; j += 1) {
    const c = js[j];
    if (q) { if (c === '\\') { j += 1; continue; } if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '(' || c === '[' || c === '{') d += 1;
    else if (c === ')' || c === ']' || c === '}') { d -= 1; if (d === 0) return j; }
  }
  return -1;
}

export function extrairRegistro(js) {
  const interacoes = []; const linhas = []; const falhas = [];
  for (let i = js.indexOf('.register(['); i >= 0; i = js.indexOf('.register([', i + 1)) {
    const abre = i + '.register'.length; const fecha = fecharChamada(js, abre);
    if (fecha < 0) { falhas.push('chamada sem fim'); continue; }
    const corpo = js.slice(abre + 1, fecha);
    if (/\bfunction\b|=>/.test(corpo)) { falhas.push('register com codigo (nao e dado)'); continue; }
    try {
      const [ints, tls] = vm.runInNewContext(`[${corpo}]`, Object.create(null), { timeout: 1000 });
      if (Array.isArray(ints) && ints.every((x) => x && x.triggers)) { interacoes.push(...ints); if (Array.isArray(tls)) linhas.push(...tls); } else falhas.push('register de outra coisa');
    } catch (e) { falhas.push('nao avaliou: ' + e.message); }
  }
  return { interacoes, linhas, falhas };
}

// roda NA PAGINA (page.evaluate): devolve, por instancia de gatilho, os ids canonicos dos alvos
export function resolverNaPagina({ interacoes, linhas, largura }) {
  const bp = largura >= 992 ? 'main' : largura >= 768 ? 'medium' : largura >= 480 ? 'small' : 'tiny';
  const porId = Object.fromEntries(linhas.map((t) => [t.id, t]));
  const inst = Array.from(document.querySelectorAll('[data-wf-target]')).map((e) => { let v = []; try { v = JSON.parse(e.getAttribute('data-wf-target')); } catch (x) { /* fica vazio */ } return [e, Array.isArray(v) ? v : []]; });
  const base = (tipo, val, T) => {
    try {
      if (tipo === 'wf:trigger-only') return T ? [T] : [];
      if (tipo === 'wf:class') { const cls = [].concat(val).flatMap((v) => String(v).split('.')).filter(Boolean); return cls.length ? Array.from(document.getElementsByClassName(cls.join(' '))) : []; }
      if (tipo === 'wf:selector' || tipo === 'wf:attribute') return Array.from(document.querySelectorAll(val));
      if (tipo === 'wf:any-element') return Array.from(document.body.querySelectorAll(val || '*'));
      if (tipo === 'wf:inst') return inst.filter(([, v]) => v.some((p) => Array.isArray(p) && p[0] === val[0] && p[1] === val[1])).map(([e]) => e);
    } catch (x) { return null; }
    return null;   // tipo desconhecido
  };
  const resolver = (spec, T) => {
    const [tipo, val, op = {}] = spec || [];
    let els = base(tipo, val, T); if (els === null) return null;
    const r = op.relationship || 'none';
    if (r === 'within' || r === 'direct-child-of') {
      const refs = op.filterBy ? resolver(op.filterBy, T) : (T ? [T] : []);
      if (!refs) return null;
      els = els.filter((e) => refs.some((x) => (r === 'within' ? x !== e && x.contains(e) : e.parentElement === x)));
    } else if (r !== 'none') return null;
    if (op.firstMatchOnly) els = els.slice(0, 1);
    return els;
  };
  const pulos = { apagadas: 0, porTamanhoDeTela: 0, cliques: 0, gatilhoDesconhecido: 0 };
  const instancias = [];
  for (const it of interacoes) {
    if (it.deleted) { pulos.apagadas += 1; continue; }
    if ((it.conditionalPlayback || []).some((c) => c && c.type === 'breakpoint' && c.behavior === 'dont-animate' && (c.breakpoints || []).includes(bp))) { pulos.porTamanhoDeTela += 1; continue; }
    const [tipoG, cfg = {}, alvoG] = (it.triggers || [])[0] || [];
    if (tipoG === 'wf:click') { pulos.cliques += 1; continue; }
    if (tipoG !== 'wf:scroll' && tipoG !== 'wf:load') { pulos.gatilhoDesconhecido += 1; continue; }
    const Ts = tipoG === 'wf:load' ? [null] : (alvoG ? resolver(alvoG, null) : null);
    if (!Ts) { pulos.gatilhoDesconhecido += 1; continue; }
    Ts.forEach((T, k) => {
      for (const tid of it.timelineIds || []) {
        const tl = porId[tid]; if (!tl || tl.deleted) continue;
        const acoes = (tl.actions || []).map((a, ai) => {
          let els = []; let desconhecido = false;
          for (const spec of a.targets || []) { const r = resolver(spec, T); if (r === null) desconhecido = true; else els.push(...r); }
          els = Array.from(new Set(els));
          const ids = els.map((e) => e.getAttribute('data-u-id')).filter(Boolean);
          return { ai, ids, semId: els.length - ids.length, desconhecido };
        });
        instancias.push({ interacao: it.id, linha: tid, k, tipo: tipoG, cfg, gatilho: T ? T.getAttribute('data-u-id') : null, acoes });
      }
    });
  }
  return { instancias, pulos };
}

const seg = (v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? (v.endsWith('ms') ? parseFloat(v) / 1000 : parseFloat(v)) : undefined);
const PERCENTUAIS = new Set(['opacity', 'autoAlpha']);
const PROPS_IX3 = new Set(['x', 'y', 'xPercent', 'yPercent', 'scale', 'scaleX', 'scaleY', 'rotation', 'rotate', 'skewX', 'skewY', 'opacity', 'autoAlpha', 'width', 'height', 'backgroundColor', 'color', 'borderColor', 'borderRadius', 'filter', 'clipPath', 'letterSpacing', 'backgroundPosition']);
const limpo = (s) => String(s).replace(/[^\w-]+/g, '-');
function valor(prop, v) {
  if (v === null || v === undefined || v === '') return undefined;
  if (PERCENTUAIS.has(prop) && typeof v === 'string' && /%$/.test(v)) return parseFloat(v) / 100;
  if (typeof v === 'string' && /^-?[\d.]+$/.test(v)) return Number(v);
  return v;
}

export function fichasDoIx3({ linhas }, { instancias }) {
  const porId = Object.fromEntries(linhas.map((t) => [t.id, t]));
  const rel = { linhas: 0, fichas: 0, acoesSemAlvo: 0, alvosSemId: 0, alvoDesconhecido: 0, foraDoContrato: {}, mascaras: 0, divisoes: 0 };
  const fichas = [];
  for (const ins of instancias) {
    const tl = porId[ins.linha]; if (!tl) continue;
    const st = (ins.cfg && ins.cfg.scrollTriggerConfig) || {};
    const motor = ins.tipo === 'wf:load' ? { tipo: 'carga' } : {
      // clamp (o runtime faz `clamp(${start})`): sem ele, elemento ja na 1a tela comeca em rolagem
      // NEGATIVA (o arrasto nasce no meio; a revelacao dispara na carga, nao no 1o pixel rolado)
      tipo: 'rolagem', ...(ins.gatilho ? { gatilho: '#' + ins.gatilho } : {}),
      inicio: st.clamp ? `clamp(${st.start || 'top bottom'})` : st.start || 'top bottom', fim: st.clamp ? `clamp(${st.end || 'bottom top'})` : st.end || 'bottom top',
      arrasto: st.scrub === null || st.scrub === undefined || st.scrub === false ? false : st.scrub === true ? true : Number(st.scrub),
      acoes: [st.enter, st.leave, st.enterBack, st.leaveBack].map((x) => x || 'none').join(' '),
    };
    if (motor.tipo === 'rolagem' && !ins.gatilho) { rel.alvoDesconhecido += 1; continue; }
    const nomeLinha = limpo(`ix-${ins.interacao}-${ins.linha}-${ins.k}`);
    const vistos = new Map();   // chave do alvo -> props ja animadas (regra do immediateRender do runtime)
    let n = 0;
    (tl.actions || []).forEach((a, ai) => {
      const r = ins.acoes[ai]; if (!r) return;
      rel.alvosSemId += r.semId; if (r.desconhecido) rel.alvoDesconhecido += 1;
      if (!r.ids.length) { rel.acoesSemAlvo += 1; return; }
      const tt = a.tt ?? 0; const de = {}; const para = {};
      for (const [grupo, props] of Object.entries(a.properties || {})) {
        for (const [p, v] of Object.entries(props || {})) {
          if (!PROPS_IX3.has(p) || !Array.isArray(v)) { const k = `${grupo}.${p}`; rel.foraDoContrato[k] = (rel.foraDoContrato[k] || 0) + 1; continue; }
          const a0 = valor(p, v[0]); const a1 = valor(p, v[v.length - 1]);
          if ((tt === 1 || tt === 2) && a0 !== undefined) de[p] = a0;
          if (tt !== 1 && a1 !== undefined) para[p] = a1;
        }
      }
      if (!Object.keys(de).length && !Object.keys(para).length) return;
      const t = a.timing || {};
      const f = { id: limpo(`m-${ins.interacao}-${a.id}-${ins.k}`), linha: nomeLinha, posicao: Math.max(0, seg(t.position) ?? 0), alvo: r.ids.length === 1 ? '#' + r.ids[0] : r.ids.map((x) => '#' + x), motor };
      if (Object.keys(de).length) f.de = de;
      if (Object.keys(para).length) f.para = para;
      f.duracao = tt === 3 ? 0 : seg(t.duration) ?? DURACAO_PADRAO;
      if (typeof t.ease === 'number' && CURVAS_IX3[t.ease]) f.curva = CURVAS_IX3[t.ease]; else if (typeof t.ease === 'string') f.curva = t.ease;
      if (t.stagger) {
        const s = t.stagger; const iv = {};
        if (s.each != null) iv.cada = seg(s.each); else if (s.amount != null) iv.total = seg(s.amount);
        if (typeof s.from === 'string') iv.de = s.from;
        if (iv.cada != null || iv.total != null) { f.intervalo = iv; if (f.duracao === 0) f.duracao = 0.001; }
      }
      if (a.splitText && a.splitText.type) { const tipo = String(a.splitText.type).split(/[\s,]+/)[0]; if (['chars', 'words', 'lines'].includes(tipo)) { f.dividir = tipo; rel.divisoes += 1; } if (a.splitText.mask) rel.mascaras += 1; }
      // immediateRender: a acao que REPETE uma propriedade ja animada do mesmo alvo nao pre-renderiza
      const chave = JSON.stringify(a.targets) + '|' + (f.dividir || '');
      const ja = vistos.get(chave) || new Set(); let repete = false;
      for (const p of new Set([...Object.keys(de), ...Object.keys(para)])) { if (ja.has(p)) repete = true; ja.add(p); }
      vistos.set(chave, ja);
      if (repete && tt !== 0) f.imediato = false;
      fichas.push(f); n += 1;
    });
    if (n) rel.linhas += 1;
  }
  rel.fichas = fichas.length;
  return { fichas, relatorio: rel };
}
