// CAMINHO 2 para sites GSAP — leitor das animacoes VIVAS (plano §169: o "2" e um leitor por motor;
// Webflow IX3 em ler-ix3.mjs). Num site GSAP o movimento nao esta declarado em dado: esta no
// globalTimeline em execucao. Aqui cada animacao viva e lida NA PAGINA DA CAPTURA, na mesma sessao
// da normalizacao — cada elemento ja leva o id canonico (`data-u-id`) e cada parte de texto
// dividido a sua chave (`mapaPartes`: etiqueta -> id--{l|w|c}N) — e vira fichas do programa:
//   - a animacao que tem gatilho de rolagem (ela ou um ancestral) vira UMA linha de tempo com o
//     motor desse gatilho (inicio/fim em TEXTO quando o site os escreveu assim — relativos, seguem
//     o layout —, senao em px); cada folha entra na sua `posicao` (tempo dentro do dono);
//   - sem gatilho: repeticao infinita = motor `tempo` (os lacos: letreiros, rotacoes); senao `carga`;
//   - de/para AMOSTRADOS no proprio tween (progress 0 e 1, e restaura), nao inferidos dos vars;
//   - alvo que e parte de texto dividido -> o texto inteiro com `dividir` (nivel da parte).
// Fora (contado, nunca escrito): animacao pausada (tocada por clique/hover/codigo — sem gatilho
// legivel), alvo nao-DOM (objeto de quadro de canvas: o caminho 3 cobre), fixacao (pin: a
// estrutura normalizada ja traz o espaco do pin, e o tocador fixaria de novo), curva funcao.

const CONTROLE = new Set(['duration', 'delay', 'ease', 'stagger', 'repeat', 'yoyo', 'repeatDelay', 'onComplete', 'onStart', 'onUpdate', 'onRepeat', 'onReverseComplete', 'onInterrupt', 'scrollTrigger', 'paused', 'immediateRender', 'overwrite', 'id', 'data', 'callbackScope', 'runBackwards', 'startAt', 'keyframes', 'inherit', 'lazy', 'yoyoEase', 'onCompleteParams', 'onUpdateParams', 'onStartParams', 'onRepeatParams', 'onReverseCompleteParams', 'autoRound', 'modifiers', 'snap', 'reversed', 'defaults', 'smoothChildTiming', 'css', 'force3D', 'transformOrigin', 'svgOrigin', 'clearProps', 'draggable', 'parent', 'repeatRefresh']);

// roda NA PAGINA (page.evaluate)
export function lerGsapNaPagina({ mapaPartes, controle }) {
  const g = window.gsap; if (!g) return { erro: 'gsap ausente' };
  const CTRL = new Set(controle);
  const pulos = { pausadas: 0, semFolhaDom: 0, curvasFuncao: 0, alvosSemId: 0, alvosNaoDom: 0 };
  const alvoDe = (t) => {
    if (!(t instanceof Element)) { pulos.alvosNaoDom += 1; return null; }
    const id = t.getAttribute('data-u-id'); if (id) return { id };
    const rec = t.getAttribute('data-u-rec'); const p = rec && mapaPartes[rec];
    if (p) { const [dono, k] = p.split('--'); return { id: dono, nivel: k[0] }; }
    pulos.alvosSemId += 1; return null;
  };
  const stDe = (s) => {
    const trig = s.trigger instanceof Element ? s.trigger.getAttribute('data-u-id') : null;
    const txt = (v) => (typeof v === 'string' ? v : null);
    // RECURSOS QUE O TOCADOR NAO REPRODUZ (medido no gsap.com: a secao horizontal FIXA a tela e os
    // gatilhos de dentro dela contam a rolagem HORIZONTAL): a linha que os usa nao vira ficha — fica
    // com a observacao (caminho 1), que mede o resultado na tela em vez de reescrever errado
    // FIXACAO (pin) e ROLAGEM HORIZONTAL (containerAnimation) agora sao reproduzidas pelo tocador:
    // a fixacao com o espaco que a estrutura normalizada ja traz (o espacador do GSAP foi assado nela),
    // o gatilho de dentro contando o deslizamento da linha conteiner
    const naoReproduz = [];
    if (typeof s.vars.start === 'function' || typeof s.vars.end === 'function') naoReproduz.push('inicioPorFuncao');
    const ca = s.vars.containerAnimation || null;
    if (ca && !(txt(s.vars.start) && txt(s.vars.end))) naoReproduz.push('rolagemHorizontalSemTexto');   // dentro do conteiner so vale o texto relativo
    let fixar;
    if (s.pin) { const pid = s.pin instanceof Element ? s.pin.getAttribute('data-u-id') : null; if (s.pin === s.trigger) fixar = true; else if (pid) fixar = '#' + pid; else naoReproduz.push('fixacaoSemId'); }
    return { gatilho: trig, inicio: trig && txt(s.vars.start) ? s.vars.start : Math.round(s.start), fim: trig && txt(s.vars.end) ? s.vars.end : Math.round(s.end), scrub: s.vars.scrub === undefined ? false : s.vars.scrub, acoes: s.vars.toggleActions || null, fixar, conteiner: ca ? idDe(ca) : undefined, naoReproduz };
  };
  const linhas = [];
  // id estavel de cada DONO (a linha conteiner pode ser lida depois da que depende dela)
  const ids = new WeakMap(); let proximo = 0;
  const idDe = (a) => { if (!ids.has(a)) ids.set(a, ++proximo); return ids.get(a); };
  const temGatilho = (a) => Boolean(a.scrollTrigger) || (a.getChildren ? a.getChildren(true, true, true).some((k) => k.scrollTrigger) : false);
  const temDom = (a) => (a.getChildren ? a.getChildren(true, true, false).some((k) => (k.targets ? k.targets() : []).some((x) => x instanceof Element)) : (a.targets ? a.targets() : []).some((x) => x instanceof Element));
  const ler = (el, props) => { const o = {}; props.forEach((p) => { o[p] = g.getProperty(el, p); }); return o; };
  const iguais = (u, v) => Object.keys(u).every((k) => (typeof u[k] === 'number' && typeof v[k] === 'number' ? Math.abs(u[k] - v[k]) < 1e-3 : String(u[k]) === String(v[k])));
  for (const raiz of g.globalTimeline.getChildren(false, true, true)) {
    // pausada SEM gatilho de rolagem = tocada por clique/hover/codigo: sem controlador legivel, fica
    // com a observacao (Astra: "pausada + infinita" nao prova que o site a toca — inventava movimento)
    if (raiz.paused() && !temGatilho(raiz)) { if (temDom(raiz)) pulos.pausadas += 1; else pulos.internas = (pulos.internas || 0) + 1; continue; }
    // a folha, o seu DONO (o ancestral mais proximo, ou ela, com gatilho de rolagem) e o RELOGIO:
    // `pos` = inicio da folha no tempo do dono, `esc` = quanto 1 s local vale no tempo do dono
    // (Astra: somar startTime() ignorava timeScale de cada nivel)
    const folhas = [];
    // pos/esc no tempo LOCAL do dono (o que dono.totalTime() entende); a velocidade do PROPRIO dono
    // entra so na hora de escrever a ficha (Astra r2: a amostra caia no instante errado)
    const andar = (a, dono, pos, esc) => {
      if (a.scrollTrigger) { dono = a; pos = 0; esc = 1; }
      if (a.getChildren) { a.getChildren(false, true, true).forEach((k) => andar(k, dono, pos + k.startTime() * esc, esc / (k.timeScale ? k.timeScale() : 1))); return; }
      folhas.push({ a, dono, pos, esc });
    };
    andar(raiz, null, 0, 1);
    const grupos = new Map();
    for (const f of folhas) { const k = f.dono || raiz; if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(f); }
    for (const [dono, fs] of grupos) {
      const st = dono.scrollTrigger ? stDe(dono.scrollTrigger) : null;
      if (st && st.naoReproduz.length) { for (const k of st.naoReproduz) pulos[k] = (pulos[k] || 0) + 1; continue; }
      // valores AMOSTRADOS renderizando o DONO (a acao que vem depois de outra no mesmo alvo so tem
      // valor de partida quando a anterior ja rodou); uma ITERACAO so (Astra: amostrar atraves das
      // repeticoes devolvia o vai-e-volta ao comeco e a ficha sumia como "sem mudanca")
      const tDono = dono.totalTime();
      const toca = 1 / (dono.timeScale ? dono.timeScale() : 1);   // tempo local do dono -> tempo de tocar
      const itens = [];
      for (const { a, pos, esc } of fs) {
        // o motor de interacoes do Webflow (IX3) e feito de GSAP: as acoes dele trazem `data.id`
        // 'ta-…' e ja sao lidas como DADO por ler-ix3.mjs
        if (a.vars && a.vars.data && typeof a.vars.data.id === 'string' && /^ta-/.test(a.vars.data.id)) { pulos.doIx3 = (pulos.doIx3 || 0) + 1; continue; }
        const alvos = a.targets ? a.targets() : [];
        const v = a.vars || {};
        const props = new Set(); Object.keys(v).forEach((k) => { if (!CTRL.has(k)) props.add(k); });
        if (v.css && typeof v.css === 'object') Object.keys(v.css).forEach((k) => props.add(k));
        // KEYFRAMES do GSAP: as propriedades vem de dentro deles e o movimento e amostrado em quadros
        const kf = v.keyframes;
        if (kf && typeof kf === 'object') (Array.isArray(kf) ? kf : Object.values(kf).some((x) => x && typeof x === 'object' && !Array.isArray(x)) ? Object.values(kf) : [kf]).forEach((o) => o && typeof o === 'object' && Object.keys(o).forEach((k) => { if (!CTRL.has(k) && k !== 'easeEach') props.add(k); }));
        if (!props.size) { pulos.semPropriedade = (pulos.semPropriedade || 0) + 1; continue; }
        const stg = v.stagger;
        const baseLocal = typeof v.duration === 'number' ? v.duration : (stg ? 0.5 : a.duration());   // duracao de UM alvo
        const totalLocal = a.duration();   // com o escalonamento
        const ini = pos; const fimTodos = ini + totalLocal * esc; const fimUm = ini + baseLocal * esc;
        const set = totalLocal === 0;
        // cada alvo amostrado SEPARADO (Astra: o 1o alvo era aplicado a todos)
        const porAlvo = [];
        try {
          const els = alvos.filter((x) => x instanceof Element);
          // set no instante 0: o "antes" e um instante NEGATIVO (no 0 o set ja aplicou — Astra r2)
          dono.totalTime(set ? ini - 1e-4 : ini, true); const des = els.map((el) => ler(el, props));
          let quadros = null;
          if (kf && !set) { const N = 12; quadros = els.map(() => []); for (let q = 1; q <= N; q += 1) { dono.totalTime(ini + ((fimUm - ini) * q) / N, true); els.forEach((el, k) => quadros[k].push(ler(el, props))); } }
          dono.totalTime(set ? ini + 1e-4 : fimTodos, true); const paras = els.map((el) => ler(el, props));
          els.forEach((el, k) => porAlvo.push({ alvo: alvoDe(el), de: des[k], para: paras[k], quadros: quadros ? quadros[k] : null }));
        } catch (e) { pulos.falhaAmostra = (pulos.falhaAmostra || 0) + 1; continue; }
        const validos = porAlvo.filter((x) => x.alvo);
        pulos.alvosNaoDom += alvos.filter((x) => !(x instanceof Element)).length;
        if (!validos.length) { pulos.semFolhaDom += 1; continue; }
        const rv = (dono && dono.vars) || {};
        let ease = typeof v.ease === 'string' ? v.ease : v.ease ? null : (rv.defaults && typeof rv.defaults.ease === 'string' ? rv.defaults.ease : 'power1.out');
        if (ease === null) { pulos.curvasFuncao += 1; ease = 'none'; }
        const k_ = esc * toca;   // tempo local da folha -> tempo de tocar
        const intervalo = typeof stg === 'number' ? { cada: stg * k_ } : stg && typeof stg === 'object' ? { cada: stg.each != null ? stg.each * k_ : undefined, total: stg.amount != null ? stg.amount * k_ : undefined, de: typeof stg.from === 'string' ? stg.from : undefined, ordemComplexa: stg.from !== undefined && !['start', 'end', 0].includes(stg.from) || Boolean(stg.grid) } : null;
        const comum = { posicao: ini * toca, duracao: set ? 0 : baseLocal * k_, curva: ease, repetir: v.repeat, vaiVolta: Boolean(v.yoyo), atrasoRepeticao: typeof v.repeatDelay === 'number' && v.repeatDelay > 0 ? v.repeatDelay * k_ : undefined, imediato: v.immediateRender === false ? false : undefined };
        // partes de UM texto, ou alvos que fazem a MESMA trajetoria -> uma ficha (com escalonamento);
        // senao uma ficha por alvo, cada uma no seu instante
        const mesmaTrajetoria = (x) => iguais(x.de, validos[0].de) && iguais(x.para, validos[0].para) && (!x.quadros || x.quadros.every((q, i) => iguais(q, validos[0].quadros[i])));
        const mesmo = validos.every(mesmaTrajetoria);
        // trajetorias IGUAIS (inclusive partes de um texto) -> uma ficha com escalonamento
        if (mesmo || validos.length === 1) itens.push({ ...comum, alvos: validos.map((x) => x.alvo), de: validos[0].de, para: validos[0].para, quadros: validos[0].quadros, intervalo });
        // diferentes: partes de texto ou ordem que o tocador nao reproduz (centro, bordas, acaso, grade)
        // -> fica com a observacao (Astra r2: saiam todas no instante 0)
        else if (validos.some((x) => x.alvo.nivel) || (intervalo && intervalo.ordemComplexa)) { pulos.alvosDistintosNaoReproduz = (pulos.alvosDistintosNaoReproduz || 0) + 1; }
        else {
          pulos.alvosDistintos = (pulos.alvosDistintos || 0) + 1;
          const cada = intervalo ? (intervalo.cada != null ? intervalo.cada : intervalo.total != null && validos.length > 1 ? intervalo.total / (validos.length - 1) : 0) : 0;
          validos.forEach((x, k) => itens.push({ ...comum, posicao: comum.posicao + (intervalo ? (intervalo.de === 'end' ? validos.length - 1 - k : k) * cada : 0), alvos: [x.alvo], de: x.de, para: x.para, quadros: x.quadros, intervalo: null }));
        }
      }
      try { dono.totalTime(tDono, true); } catch (e) { /* segue */ }
      if (!itens.length) continue;
      linhas.push({ id: idDe(dono), st, repeticao: dono.vars ? dono.vars.repeat : undefined, vaiVolta: Boolean(dono.vars && dono.vars.yoyo), atrasoRepeticao: dono.vars && typeof dono.vars.repeatDelay === 'number' ? dono.vars.repeatDelay * toca : undefined, atraso: !dono.scrollTrigger && dono === raiz && typeof raiz.vars.delay === 'number' ? raiz.vars.delay : 0, itens });
    }
  }
  return { linhas, pulos };
}

const PROPS = new Set(['x', 'y', 'xPercent', 'yPercent', 'scale', 'scaleX', 'scaleY', 'rotate', 'rotation', 'skewX', 'skewY', 'opacity', 'autoAlpha', 'color', 'backgroundColor', 'borderColor', 'clipPath', 'filter', 'width', 'height', 'backgroundPosition', 'borderRadius', 'letterSpacing']);
const NIVEL = { l: 'lines', w: 'words', c: 'chars' };
const igual = (a, b) => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-3 : String(a) === String(b));
const num = (v) => (typeof v === 'number' ? Number(v.toFixed(4)) : v);
const limpo = (s) => String(s).replace(/[^\w-]+/g, '-');

export function fichasDoGsap(lido) {
  const rel = { linhas: 0, fichas: 0, foraDoContrato: {}, semMudanca: 0, ...(lido.pulos || {}) };
  const fichas = []; let nl = 0;
  const existentes = new Set((lido.linhas || []).map((L) => L.id));
  for (const L of lido.linhas || []) {
    nl += 1;
    let motor;
    if (L.st) {
      const s = L.st;
      if (s.conteiner !== undefined && !existentes.has(s.conteiner)) { rel.conteinerAusente = (rel.conteinerAusente || 0) + 1; continue; }
      motor = { tipo: 'rolagem', ...(s.gatilho ? { gatilho: '#' + s.gatilho } : {}), inicio: s.inicio, fim: s.fim, arrasto: s.scrub === true ? true : typeof s.scrub === 'number' ? s.scrub : false, ...(s.scrub ? {} : { acoes: s.acoes || 'play none none none' }),
        ...(s.fixar ? { fixar: s.fixar, espacoReservado: true } : {}), ...(s.conteiner !== undefined ? { conteiner: `gsap-${s.conteiner}` } : {}) };
    } else if (L.repeticao === -1 || L.itens.every((i) => i.repetir === -1)) motor = { tipo: 'tempo', ...(L.repeticao === -1 && L.vaiVolta ? { vaiVolta: true } : {}), ...(L.repeticao === -1 && L.atrasoRepeticao ? { atrasoRepeticao: num(L.atrasoRepeticao) } : {}) };
    // carga: toca ao montar. O startTime da raiz NAO e "atraso desde a carga" — e o instante em que
    // ela foi criada no relogio global do GSAP, e uma animacao que se recria em ciclos (o titulo do
    // gsap.com) ja nasceu muitos segundos depois; usado como atraso, ela so aparecia aos 6 s
    else motor = { tipo: 'carga', ...(L.atraso > 0 ? { atraso: num(L.atraso) } : {}) };   // o `delay` DECLARADO da raiz
    const nome = `gsap-${L.id ?? nl}`; const vistos = new Map(); let n = 0;
    const itens = [...L.itens].sort((a, b) => a.posicao - b.posicao);
    for (const it of itens) {
      const de = {}; const para = {}; let quadros = null;
      if (it.quadros) {
        // so as propriedades que MUDAM em algum quadro; quadros iguais entre si sao parada
        // os quadros sao os DESTINOS (o 1o segmento parte do estado atual, como nos keyframes do GSAP;
        // Astra: incluir o estado inicial como quadro criava uma pausa no comeco)
        const ps = Object.keys(it.quadros[0]).filter((p) => { if (!PROPS.has(p)) { rel.foraDoContrato[p] = (rel.foraDoContrato[p] || 0) + 1; return false; } return it.quadros.some((q) => !igual(q[p], it.de[p])); });
        if (ps.length) quadros = it.quadros.map((q) => Object.fromEntries([...ps.map((p) => [p, num(q[p])]), ['ease', 'none']]));
        if (!quadros) { rel.semMudanca += 1; continue; }
        ps.forEach((p) => { para[p] = num(it.quadros[it.quadros.length - 1][p]); });
      } else {
        for (const p of Object.keys(it.para)) {
          if (!PROPS.has(p)) { rel.foraDoContrato[p] = (rel.foraDoContrato[p] || 0) + 1; continue; }
          if (it.de[p] === undefined || igual(it.de[p], it.para[p])) continue;
          de[p] = num(it.de[p]); para[p] = num(it.para[p]);
        }
        if (!Object.keys(para).length) { rel.semMudanca += 1; continue; }
      }
      const partes = it.alvos.filter((a) => a.nivel); const ids = [...new Set(it.alvos.map((a) => a.id))];
      const f = { id: limpo(`m-gsap-${nl}-${++n}`), linha: nome, posicao: num(Math.max(0, it.posicao)), alvo: ids.length === 1 ? '#' + ids[0] : ids.map((i) => '#' + i), motor, ...(quadros ? { quadros } : { de, para }), duracao: num(it.duracao), curva: quadros ? 'none' : it.curva };
      if (partes.length && partes.length === it.alvos.length) f.dividir = NIVEL[partes[0].nivel];
      if (it.intervalo && (it.intervalo.cada != null || it.intervalo.total != null)) { f.intervalo = it.intervalo.cada != null ? { cada: num(it.intervalo.cada) } : { total: num(it.intervalo.total) }; if (it.intervalo.de) f.intervalo.de = it.intervalo.de; }
      // repeticao e vai-e-volta da FOLHA (a linha inteira repete pelo motor `tempo`)
      if (it.repetir) f.repetir = it.repetir;
      if (it.vaiVolta) f.vaiVolta = true;
      if (it.atrasoRepeticao) f.atrasoRepeticao = num(it.atrasoRepeticao);
      // a acao que repete uma propriedade ja animada do mesmo alvo nao pre-renderiza (como no IX3)
      const chave = JSON.stringify(f.alvo) + '|' + (f.dividir || '');
      const ja = vistos.get(chave) || new Set(); let repete = false;
      for (const p of Object.keys(para)) { if (ja.has(p)) repete = true; ja.add(p); }
      vistos.set(chave, ja); if (repete || it.imediato === false) f.imediato = false;   // e o `immediateRender:false` do site
      fichas.push(f);
    }
  }
  // dependente cujo CONTEINER nao virou ficha nenhuma (todas as acoes dele ficaram de fora) sai —
  // recursivamente — e o elemento fica com a observacao (Astra: o tocador falhava "conteiner ausente")
  let fs = fichas; let saiu = true;
  while (saiu) {
    const emitidas = new Set(fs.map((f) => f.linha));
    const ficam = fs.filter((f) => !(f.motor && f.motor.conteiner && !emitidas.has(f.motor.conteiner)));
    saiu = ficam.length !== fs.length; if (saiu) rel.conteinerAusente = (rel.conteinerAusente || 0) + (fs.length - ficam.length); fs = ficam;
  }
  rel.linhas = new Set(fs.map((f) => f.linha)).size; rel.fichas = fs.length;
  return { fichas: fs, relatorio: rel };
}

export const CONTROLE_GSAP = [...CONTROLE];
