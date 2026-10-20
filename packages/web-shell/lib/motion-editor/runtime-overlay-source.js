// Camada de alças e guias do editor da cópia (spec 2026-10-20 §4-§5). Roda DENTRO da página editada, serializada
// junto com a ponte por getRuntimeBridgeSource(): ⚠️ nada aqui pode referenciar algo de fora desta função (nem imports,
// nem constantes do módulo) — `M` traz as contas puras de overlay-math.js e `ponte` a interface interna da ponte.
// A camada só DESENHA e faz PRÉVIA; quem confirma uma edição é o editor de fora (§6.2).
export function instalarCamada(ponte, M) {
  const doc = ponte.doc;
  const win = doc.defaultView;
  const CSS_DA_CAMADA = `
    :host { all: initial; }
    .u-hover, .u-sel, .u-parent, .u-handle, .u-sel-label, .u-hover-tag { position: fixed; box-sizing: border-box; display: none; }
    .u-hover {
      pointer-events: none; background: rgba(147,197,253,0.05);
      border: calc(1px / var(--u-escala, 1)) solid rgba(147,197,253,0.3);
      border-radius: calc(2px / var(--u-escala, 1)); z-index: 2147483641;
    }
    .u-hover-tag, .u-sel-label {
      pointer-events: none; white-space: nowrap; color: #000;
      font: 500 calc(9px / var(--u-escala, 1)) 'Instrument Sans', system-ui, sans-serif;
      padding: calc(1px / var(--u-escala, 1)) calc(6px / var(--u-escala, 1)); border-radius: calc(3px / var(--u-escala, 1));
    }
    .u-hover-tag { background: rgba(147,197,253,0.85); z-index: 2147483641; }
    .u-sel {
      pointer-events: none; border: calc(1.5px / var(--u-escala, 1)) solid #0095FF; z-index: 2147483642;
      animation: u-glow 600ms ease-out forwards;
    }
    .u-sel-label { background: #0095FF; z-index: 2147483643; }
    .u-handle {
      width: calc(12px / var(--u-escala, 1)); height: calc(12px / var(--u-escala, 1));
      background: #fff; border: calc(2px / var(--u-escala, 1)) solid #0095FF; border-radius: calc(2px / var(--u-escala, 1));
      pointer-events: auto; z-index: 2147483644;
    }
    .u-handle.u-off { opacity: 0.35; cursor: not-allowed !important; }
    .u-parent { pointer-events: none; border: calc(1px / var(--u-escala, 1)) dashed rgba(147,197,253,0.15); z-index: 2147483640; }
    .u-guia { position: fixed; box-sizing: border-box; display: none; pointer-events: auto; z-index: 2147483641; }
    .u-guia-margin { background: repeating-linear-gradient(-45deg, rgba(255,0,221,0.12), rgba(255,0,221,0.12) 2px, transparent 2px, transparent 5px); border: calc(1px / var(--u-escala, 1)) solid rgba(255,0,221,0.25); }
    .u-guia-padding { background: repeating-linear-gradient(-45deg, rgba(255,0,221,0.08), rgba(255,0,221,0.08) 2px, transparent 2px, transparent 5px); border: calc(1px / var(--u-escala, 1)) dashed rgba(255,0,221,0.2); }
    .u-guia-gap { background: repeating-linear-gradient(-45deg, rgba(255,0,221,0.15), rgba(255,0,221,0.15) 2px, transparent 2px, transparent 5px); border: calc(1px / var(--u-escala, 1)) solid rgba(255,0,221,0.3); }
    .u-guia:hover, .u-guia.u-ativa { box-shadow: inset 0 0 0 calc(1px / var(--u-escala, 1)) rgba(255,0,221,0.55); }
    .u-guia.u-arrastando { box-shadow: inset 0 0 0 calc(1px / var(--u-escala, 1)) rgba(255,0,221,0.85), 0 0 0 calc(1px / var(--u-escala, 1)) rgba(255,0,221,0.25); }
    .u-guia-widget {
      position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%) scale(calc(1 / var(--u-escala, 1)));
      background: #1A1A1A; color: #FF00DD; font: 500 10px 'Instrument Sans', system-ui, sans-serif;
      padding: 2px 6px; border-radius: 4px; display: flex; align-items: center; gap: 3px; white-space: nowrap;
      pointer-events: auto; z-index: 2147483642; box-shadow: 0 2px 6px rgba(0,0,0,0.25);
    }
    .u-guia-icon { font-size: 9px; opacity: 0.6; }
    .u-guia-val { font-size: 10px; }
    .u-guia-delta { font-size: 9px; color: rgba(255,0,221,0.65); font-weight: 500; margin-left: 2px; }
    .u-guia-input { background: transparent; border: none; outline: none; color: #FF00DD; font: 500 10px 'Instrument Sans', system-ui, sans-serif; padding: 0; margin: 0; width: 40px; text-align: center; -webkit-appearance: none; }
    .u-guia-widget.u-editando { box-shadow: 0 0 0 1px rgba(255,0,221,0.7), 0 2px 6px rgba(0,0,0,0.3); }
    .u-canto {
      position: fixed; display: none; box-sizing: border-box; pointer-events: auto; z-index: 2147483641;
      width: calc(10px / var(--u-escala, 1)); height: calc(10px / var(--u-escala, 1));
      margin-left: calc(-5px / var(--u-escala, 1)); margin-top: calc(-5px / var(--u-escala, 1));
      background: #1A1A1A; border: calc(1.5px / var(--u-escala, 1)) solid rgba(255,0,221,0.85); border-radius: 2px;
    }
    .u-canto:hover { box-shadow: 0 0 0 3px rgba(255,0,221,0.2); }
    .u-pill {
      position: fixed; display: none; pointer-events: none; z-index: 2147483646; white-space: nowrap;
      background: #1A1A1A; color: #fff; border: calc(1px / var(--u-escala, 1)) solid #0095FF; border-radius: 999px;
      font: 500 calc(11px / var(--u-escala, 1)) 'Instrument Sans', system-ui, sans-serif;
      padding: calc(5px / var(--u-escala, 1)) calc(12px / var(--u-escala, 1));
    }
    @keyframes u-glow { 0% { box-shadow: 0 0 0 4px rgba(147,197,253,0.25); } 100% { box-shadow: 0 0 0 0 transparent; } }
  `;
  const raiz = doc.createElement('uncraft-overlay');
  // `rb-ed-*`: o editor antigo preserva esses nós ao trocar a página (mode-e) — Astra (Task 4) #1
  raiz.id = 'rb-ed-uncraft-overlay';
  raiz.setAttribute('data-uncraft-overlay', '');
  // A raiz é do DOCUMENTO do site: regra dele (até !important, ex. `body > * { transform }`) a moveria ou esconderia,
  // e os filhos fixos desalinhariam. Inline + !important vence qualquer folha do autor — Astra (Task 4) #4.
  const TRAVAS = { position: 'fixed', inset: '0', margin: '0', 'z-index': '2147483647', 'pointer-events': 'none', display: 'block',
    visibility: 'visible', opacity: '1', transform: 'none', translate: 'none', scale: 'none', rotate: 'none', filter: 'none', zoom: '1' };
  Object.entries(TRAVAS).forEach(([p, v]) => raiz.style.setProperty(p, v, 'important'));
  // Dono da marca de "camada ativa": reinjetar a ponte desmonta a camada VELHA depois de a nova ligar a marca, e o
  // desmonte só apaga a marca que é DELE — Astra (Task 4) #2.
  const dono = `camada-${Math.random().toString(36).slice(2)}`;
  const marcarAtiva = () => { doc.documentElement.dataset.uncraftOverlayAtiva = dono; };
  const sombra = raiz.attachShadow({ mode: 'closed' });
  const estilo = doc.createElement('style');
  estilo.textContent = CSS_DA_CAMADA;
  sombra.appendChild(estilo);
  const mk = (cls) => { const d = doc.createElement('div'); d.className = cls; sombra.appendChild(d); return d; };
  const parentBox = mk('u-parent');
  const hoverBox = mk('u-hover');
  const hoverTag = mk('u-hover-tag');
  const selBox = mk('u-sel');
  const selLabel = mk('u-sel-label');
  const DIRS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  const CURSOR = { nw: 'nwse', n: 'ns', ne: 'nesw', e: 'ew', se: 'nwse', s: 'ns', sw: 'nesw', w: 'ew' };
  const handles = {};
  DIRS.forEach((d) => { const h = mk('u-handle'); h.dataset.dir = d; h.style.cursor = `${CURSOR[d]}-resize`; handles[d] = h; });
  const pill = mk('u-pill');
  // ---- guias de espaçamento (editor.js 8789-9317) ----
  const GUIA_KEYS = ['mt', 'mr', 'mb', 'ml', 'pt', 'pr', 'pb', 'pl', 'gap'];
  const PROP_CALC = { mt: 'marginTop', mr: 'marginRight', mb: 'marginBottom', ml: 'marginLeft', pt: 'paddingTop', pr: 'paddingRight', pb: 'paddingBottom', pl: 'paddingLeft' };
  const guias = {};
  const valores = {};
  GUIA_KEYS.forEach((k) => {
    const tipo = k === 'gap' ? 'gap' : k[0] === 'm' ? 'margin' : 'padding';
    const g = mk(`u-guia u-guia-${tipo}`);
    g.dataset.guia = k;
    g.style.cursor = M.guideAxis(k, 'row') === 'x' ? 'ew-resize' : 'ns-resize';
    const w = doc.createElement('div');
    w.className = 'u-guia-widget';
    const icone = doc.createElement('span'); icone.className = 'u-guia-icon'; icone.textContent = '\u2194';
    const val = doc.createElement('span'); val.className = 'u-guia-val';
    w.appendChild(icone); w.appendChild(val);
    g.appendChild(w);
    guias[k] = g;
    valores[k] = { icone, val, widget: w };
  });
  const CANTOS = ['nw', 'ne', 'se', 'sw'];
  const cantos = {};
  CANTOS.forEach((c) => { const el = mk('u-canto'); el.dataset.canto = c; el.style.cursor = c === 'nw' || c === 'se' ? 'nwse-resize' : 'nesw-resize'; cantos[c] = el; });
  let guiasDesenhadas = [];
  let guiaAtiva = null;
  // Textos do motivo (produto em inglês): tooltip do quadradinho apagado e pílula de recusa
  const MOTIVOS = {
    layout_locked: 'Locked by the 3D scene',
    inline_element: "Inline elements can't be resized",
    svg_inner: "This part of an SVG can't be resized",
    motion_owned: 'Driven by an animation \u2014 edit it in Motion',
    cleared_by_motion: 'An animation resets this when it ends',
    priority_conflict: 'The site forces this value',
    layout_controlled: "This element's size is set by its layout",
    gesture_busy: 'Saving\u2026',
    canceled: 'Change canceled',
    no_element: 'This element is no longer on the page',
    transaction_rejected: "This change couldn't be applied",
    timeout: "This change couldn't be saved",
  };
  let pillTimer = 0;
  function mostrarMotivo(codigo, perto) {
    const texto = MOTIVOS[codigo];
    if (!texto) return;
    pill.textContent = texto;
    const p = perto || { x: 16, y: 16 };
    Object.assign(pill.style, { display: 'block', left: `${p.x}px`, top: `${p.y}px` });
    if (pillTimer) win.clearTimeout(pillTimer);
    pillTimer = win.setTimeout(() => { pill.style.display = 'none'; pillTimer = 0; }, 2500);
  }
  // Quadradinhos apagados: calculado quando a SELEÇÃO muda (não a cada quadro), sem medir "o tamanho mudou?"
  let alcasApagadas = null;
  let selecaoAvaliada = null;
  function avaliarAlcas(el) {
    if (el === selecaoAvaliada) return;
    selecaoAvaliada = el;
    alcasApagadas = null;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pode = ponte.elegivel(el, [
      { el, property: 'width', value: `${Math.round(r.width)}px` },
      { el, property: 'height', value: `${Math.round(r.height)}px` },
    ], { semMedirTamanho: true });
    if (!pode.ok && pode.motivo !== 'gesture_busy') alcasApagadas = pode.motivo;
  }
  let escala = 1;
  let guiasVisiveis = true;
  let quadro = 0;
  let destruida = false;

  const caixaDe = (el) => {
    if (!el || typeof el.getBoundingClientRect !== 'function') return null;
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  };
  // Tudo é medido em coordenadas da JANELA e escrito no sistema da RAIZ: um ancestral transformado (ou filtrado)
  // vira o bloco de contenção dos filhos fixos e a caixa sairia deslocada duas vezes (Astra, Task 4 r2). A raiz mora
  // fora do body (body transformado é o caso comum); a conversão cobre o raro <html> transformado.
  const origem = () => {
    const r = raiz.getBoundingClientRect();
    const sx = raiz.offsetWidth ? r.width / raiz.offsetWidth : 1;
    const sy = raiz.offsetHeight ? r.height / raiz.offsetHeight : 1;
    return { left: r.left, top: r.top, sx: sx || 1, sy: sy || 1 };
  };
  const paraRaiz = (o, box) => ({ x: (box.x - o.left) / o.sx, y: (box.y - o.top) / o.sy, width: box.width / o.sx, height: box.height / o.sy });
  const pontoParaRaiz = (o, p) => ({ x: (p.x - o.left) / o.sx, y: (p.y - o.top) / o.sy });
  let ultimaCaixa = null;
  const aplicarCaixa = (el, box, o) => {
    if (!box) { el.style.display = 'none'; return null; }
    const l = paraRaiz(o, box);
    Object.assign(el.style, { display: 'block', left: `${l.x}px`, top: `${l.y}px`, width: `${l.width}px`, height: `${l.height}px` });
    return l;
  };
  const rotuloDe = (el) => {
    const tag = String(el.tagName || '').toLowerCase();
    const cls = typeof el.className === 'string' ? el.className.split(/\s+/).filter((c) => c && c.indexOf('u-') !== 0)[0] : '';
    return cls ? `${tag}.${cls}` : tag;
  };

  function redesenhar() {
    if (destruida) return;
    // a página pode ter removido a raiz: ela volta (Astra, Task 4 #1)
    if (!raiz.isConnected) { doc.documentElement.appendChild(raiz); marcarAtiva(); }
    const o = origem();
    const editando = ponte.modo() === 'edit' && !ponte.editandoTexto();
    const el = editando ? ponte.selecionado() : null;
    const box = caixaDe(el);
    ultimaCaixa = aplicarCaixa(selBox, box, o);
    const pai = el && el.parentElement && el.parentElement !== doc.body && el.parentElement !== doc.documentElement ? el.parentElement : null;
    aplicarCaixa(parentBox, pai ? caixaDe(pai) : null, o);
    const sobre = editando ? ponte.passando() : null;
    const boxSobre = sobre && sobre !== el ? caixaDe(sobre) : null;
    aplicarCaixa(hoverBox, boxSobre, o);
    if (boxSobre) {
      hoverTag.textContent = rotuloDe(sobre);
      const t = pontoParaRaiz(o, { x: boxSobre.x, y: Math.max(0, boxSobre.y - 17 / escala) });
      Object.assign(hoverTag.style, { display: 'block', left: `${t.x}px`, top: `${t.y}px` });
    } else hoverTag.style.display = 'none';
    if (box) {
      const vp = { width: doc.documentElement.clientWidth || win.innerWidth, height: doc.documentElement.clientHeight || win.innerHeight };
      const lugar = M.placeControls({ box, viewport: vp, handle: 12 / escala, label: { width: 70 / escala, height: 18 / escala } });
      const travado = ponte.travado(el);
      avaliarAlcas(el);
      DIRS.forEach((d) => {
        const h = pontoParaRaiz(o, lugar.handles[d]);
        Object.assign(handles[d].style, { display: travado ? 'none' : 'block', left: `${h.x}px`, top: `${h.y}px` });
        handles[d].classList.toggle('u-off', !!alcasApagadas);
        handles[d].title = alcasApagadas ? (MOTIVOS[alcasApagadas] || '') : '';
      });
      selLabel.textContent = `${Math.round(box.width)} × ${Math.round(box.height)}`;
      const rl = pontoParaRaiz(o, lugar.label);
      Object.assign(selLabel.style, { display: 'block', left: `${rl.x}px`, top: `${rl.y}px` });
      posicionarGuias(el, box, o, travado);
    } else {
      DIRS.forEach((d) => { handles[d].style.display = 'none'; });
      selLabel.style.display = 'none';
      avaliarAlcas(null);
      posicionarGuias(null, null, o, false);
    }
  }

  // Faixas nas medidas CALCULADAS (px da página); só o rótulo/espessura usam --u-escala (o antigo multiplicava pelo
  // _scale do canvas porque desenhava fora da página). Valor 0 não desenha; cantos com alguma margem >= 2 px.
  function posicionarGuias(el, box, o, travado) {
    guiasDesenhadas = [];
    const esconder = () => { GUIA_KEYS.forEach((k) => { guias[k].style.display = 'none'; }); CANTOS.forEach((c) => { cantos[c].style.display = 'none'; }); };
    if (!el || !box || !guiasVisiveis || travado) { esconder(); return; }
    const cs = win.getComputedStyle(el);
    const px = (v) => parseFloat(v) || 0;
    const v = {};
    Object.keys(PROP_CALC).forEach((k) => { v[k] = px(cs[PROP_CALC[k]]); });
    const l = box.x; const t = box.y; const r = box.x + box.width; const b = box.y + box.height;
    const faixa = (k, x, y, w, h, valor, icone) => {
      if (!(valor > 0) || !(w > 0) || !(h > 0)) { guias[k].style.display = 'none'; return; }
      aplicarCaixa(guias[k], { x, y, width: w, height: h }, o);
      if (!guias[k].classList.contains('u-arrastando')) valores[k].val.textContent = String(Math.round(valor));
      if (icone) valores[k].icone.textContent = icone;
      guiasDesenhadas.push(k);
    };
    faixa('mt', l - v.ml, t - v.mt, box.width + v.ml + v.mr, v.mt, v.mt);
    faixa('mr', r, t, v.mr, box.height, v.mr);
    faixa('mb', l - v.ml, b, box.width + v.ml + v.mr, v.mb, v.mb);
    faixa('ml', l - v.ml, t, v.ml, box.height, v.ml);
    faixa('pt', l, t, box.width, v.pt, v.pt);
    faixa('pr', r - v.pr, t, v.pr, box.height, v.pr);
    faixa('pb', l, b - v.pb, box.width, v.pb, v.pb);
    faixa('pl', l, t, v.pl, box.height, v.pl);
    const pai = el.parentElement;
    const prox = el.nextElementSibling;
    const pcs = pai ? win.getComputedStyle(pai) : null;
    const eixo = M.guideAxis('gap', pcs ? pcs.flexDirection : 'row');
    const gapVal = pcs ? px(eixo === 'x' ? (pcs.columnGap || pcs.gap) : (pcs.rowGap || pcs.gap)) : 0;
    const boxProx = prox ? caixaDe(prox) : null;
    if (gapVal > 0 && boxProx) {
      if (eixo === 'x') faixa('gap', r, t, boxProx.x - r, box.height, gapVal, '\u2194');
      else faixa('gap', l, b, box.width, boxProx.y - b, gapVal, '\u2195');
    } else guias.gap.style.display = 'none';
    const algumaMargem = v.ml >= 2 || v.mt >= 2 || v.mr >= 2 || v.mb >= 2;
    const pontoCanto = { nw: { x: l - v.ml, y: t - v.mt }, ne: { x: r + v.mr, y: t - v.mt }, se: { x: r + v.mr, y: b + v.mb }, sw: { x: l - v.ml, y: b + v.mb } };
    CANTOS.forEach((c) => {
      if (!algumaMargem) { cantos[c].style.display = 'none'; return; }
      const p = pontoParaRaiz(o, pontoCanto[c]);
      Object.assign(cantos[c].style, { display: 'block', left: `${p.x}px`, top: `${p.y}px` });
    });
  }

  // ---- arrastar os quadradinhos (spec §5.2; editor.js 10738-10830) ----
  // A camada só faz PRÉVIA; quem confirma é o editor de fora (§6.2). Mudanças viram [{ el, property, value }].
  const resolverAlvos = (lista, el) => lista
    .map((c) => ({ el: c.alvo === 'parent' ? el.parentElement : el, property: c.property, value: c.value }))
    .filter((c) => c.el);
  // Um arraste por vez, preso ao ponteiro que o começou. Cancelamento do ponteiro, perda de captura, Esc, perda de
  // foco e desmonte da camada passam pela MESMA limpeza, segura de chamar mais de uma vez (Astra, Task 8).
  let arrasteAtivo = null;
  function arrastar(ev, alvoCaptura, { limiar, aoComecar, aoMover, aoSoltar, aoCancelar, idDoGesto }) {
    if (arrasteAtivo) arrasteAtivo.cancelar('superseded');
    // no canvas a página é um quadro: com o foco do teclado no painel de fora (seleção pelas camadas, inspector), o
    // Esc iria para fora e não cancelaria — o arraste traz o foco para cá (revisão final do ramo #2)
    try { if (typeof doc.hasFocus === 'function' && !doc.hasFocus()) win.focus(); } catch (_) { /* sem foco */ }
    const id = ev.pointerId;
    const sx = ev.clientX;
    const sy = ev.clientY;
    let comecou = false;
    let terminado = false;
    const doPonteiro = (e) => id == null || e.pointerId == null || e.pointerId === id;
    function limpar() {
      terminado = true;
      doc.removeEventListener('pointermove', mover, true);
      doc.removeEventListener('pointerup', soltar, true);
      doc.removeEventListener('pointercancel', cancelado, true);
      alvoCaptura.removeEventListener('lostpointercapture', cancelado);
      doc.removeEventListener('keydown', esc, true);
      win.removeEventListener('blur', perdeuFoco);
      if (arrasteAtivo === controle) arrasteAtivo = null;
    }
    function cancelar(motivo) {
      if (terminado) return;
      limpar();
      if (comecou) aoCancelar(motivo);
    }
    function mover(e) {
      if (terminado || !doPonteiro(e)) return;
      const dx = e.clientX - sx;
      const dy = e.clientY - sy;
      if (!comecou) {
        if (Math.abs(dx) < limiar && Math.abs(dy) < limiar) return;
        if (!aoComecar(dx, dy, e)) { limpar(); return; }
        comecou = true;
      }
      e.preventDefault();
      aoMover(dx, dy, e);
    }
    function soltar(e) {
      if (terminado || !doPonteiro(e)) return;
      const tinhaComecado = comecou;
      limpar();
      aoSoltar(e.clientX - sx, e.clientY - sy, e, tinhaComecado);
    }
    function cancelado(e) { if (doPonteiro(e)) cancelar('pointer-canceled'); }
    function esc(e) { if (e.key === 'Escape' && comecou) { e.preventDefault(); e.stopPropagation(); cancelar('escape'); } }
    function perdeuFoco() { cancelar('blur'); }
    const controle = { cancelar, idDoGesto: () => (typeof idDoGesto === 'function' ? idDoGesto() : null) };
    arrasteAtivo = controle;
    try { if (id != null) alvoCaptura.setPointerCapture(id); } catch (_) { /* sem captura (jsdom) */ }
    doc.addEventListener('pointermove', mover, true);
    doc.addEventListener('pointerup', soltar, true);
    doc.addEventListener('pointercancel', cancelado, true);
    alvoCaptura.addEventListener('lostpointercapture', cancelado);
    doc.addEventListener('keydown', esc, true);
    win.addEventListener('blur', perdeuFoco);
    return controle;
  }

  DIRS.forEach((dir) => handles[dir].addEventListener('pointerdown', (ev) => {
    const el = ponte.selecionado();
    if (!el || ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (alcasApagadas) { mostrarMotivo(alcasApagadas, { x: ev.clientX + 12, y: ev.clientY + 12 }); return; }
    const cs = win.getComputedStyle(el);
    const r = el.getBoundingClientRect();
    // tudo medido no INÍCIO, como o antigo: tamanho, margens/posição para a compensação W/N, e o estilo para destravar
    const start = {
      width: r.width, height: r.height,
      marginLeft: parseFloat(cs.marginLeft) || 0, marginTop: parseFloat(cs.marginTop) || 0,
      left: parseFloat(cs.left) || 0, top: parseFloat(cs.top) || 0, position: cs.position,
    };
    const computed = { maxWidth: cs.maxWidth, maxHeight: cs.maxHeight, minWidth: cs.minWidth, minHeight: cs.minHeight, flexGrow: cs.flexGrow, boxSizing: cs.boxSizing };
    const pcs = el.parentElement ? win.getComputedStyle(el.parentElement) : null;
    const paiInfo = pcs ? { display: pcs.display, overflow: pcs.overflow } : null;
    let gesto = null;
    let destravar = [];
    const mudancasDe = (dx, dy) => resolverAlvos([...destravar, ...M.resizeChanges({ dir, dx, dy, start })], el);
    arrastar(ev, handles[dir], {
      limiar: 2,                                     // limiar do antigo: clique puro não mexe em nada
      aoComecar(dx, dy, e) {
        destravar = M.unlockChanges({ dir, computed, rect: r, parent: paiInfo });
        const primeiras = mudancasDe(dx, dy);
        const pode = ponte.elegivel(el, primeiras);
        if (!pode.ok) { mostrarMotivo(pode.motivo, { x: e.clientX + 12, y: e.clientY + 12 }); return false; }
        const g = ponte.iniciarGesto(primeiras.map(({ el: alvo, property }) => ({ el: alvo, property })));
        if (!g.ok) { mostrarMotivo(g.motivo, { x: e.clientX + 12, y: e.clientY + 12 }); return false; }
        gesto = g.gestureId;
        return true;
      },
      // só escreve: quem desenha é o laço por quadro (medir aqui forçava um 2º cálculo de layout por movimento)
      aoMover(dx, dy) { ponte.previa(gesto, mudancasDe(dx, dy)); acordar(); },
      aoSoltar(dx, dy, e, comecou) {
        if (!comecou || !gesto) return;
        const finais = mudancasDe(dx, dy);
        const pode = ponte.elegivel(el, finais, { ignorarGesto: gesto, semMedirTamanho: true });
        if (!pode.ok) { ponte.cancelarGesto(gesto, pode.motivo); mostrarMotivo(pode.motivo, { x: e.clientX + 12, y: e.clientY + 12 }); return; }
        ponte.terminarGesto(gesto, finais);
        redesenhar();
      },
      aoCancelar(motivo) { if (gesto) ponte.cancelarGesto(gesto, motivo); redesenhar(); },
      idDoGesto: () => gesto,
    });
  }));

  // ---- arrastar guias e cantos (editor.js 9035-9220) ----
  const modsDe = (e) => ({ shift: !!e.shiftKey, alt: !!e.altKey, meta: !!e.metaKey, ctrl: !!e.ctrlKey });
  // Um gesto qualquer sobre uma lista de mudanças: elegibilidade no 1º movimento, prévia, revalidação ao soltar
  function gestoDeMudancas(ev, alvoCaptura, el, { limiar, calcular, aoMoverExtra, aoClicar, aoFim }) {
    let gesto = null;
    arrastar(ev, alvoCaptura, {
      limiar,
      aoComecar(dx, dy, e) {
        const primeiras = resolverAlvos(calcular(dx, dy, e), el);
        const pode = ponte.elegivel(el, primeiras);
        if (!pode.ok) { mostrarMotivo(pode.motivo, { x: e.clientX + 12, y: e.clientY + 12 }); return false; }
        const g = ponte.iniciarGesto(primeiras.map(({ el: alvo, property }) => ({ el: alvo, property })));
        if (!g.ok) { mostrarMotivo(g.motivo, { x: e.clientX + 12, y: e.clientY + 12 }); return false; }
        gesto = g.gestureId;
        return true;
      },
      aoMover(dx, dy, e) {
        ponte.previa(gesto, resolverAlvos(calcular(dx, dy, e), el));
        if (aoMoverExtra) aoMoverExtra(dx, dy, e);
        acordar();
      },
      aoSoltar(dx, dy, e, comecou) {
        if (aoFim) aoFim();
        if (!comecou || !gesto) { if (aoClicar) aoClicar(e); return; }
        const finais = resolverAlvos(calcular(dx, dy, e), el);
        const pode = ponte.elegivel(el, finais, { ignorarGesto: gesto, semMedirTamanho: true });
        if (!pode.ok) { ponte.cancelarGesto(gesto, pode.motivo); mostrarMotivo(pode.motivo, { x: e.clientX + 12, y: e.clientY + 12 }); return; }
        // as mudanças que a prévia tocou e o fim não traz (ex.: soltou o Shift) voltam: a ponte devolve a declaração
        // original inteira antes de aplicar só as finais
        ponte.terminarGesto(gesto, finais);
        redesenhar();
      },
      aoCancelar(motivo) { if (aoFim) aoFim(); if (gesto) ponte.cancelarGesto(gesto, motivo); redesenhar(); },
      idDoGesto: () => gesto,
    });
  }

  GUIA_KEYS.forEach((k) => {
    guias[k].addEventListener('pointerenter', () => { guiaAtiva = k; guias[k].classList.add('u-ativa'); });
    guias[k].addEventListener('pointerleave', () => { if (!guias[k].classList.contains('u-arrastando')) { if (guiaAtiva === k) guiaAtiva = null; guias[k].classList.remove('u-ativa'); } });
    guias[k].addEventListener('pointerdown', (ev) => {
      const el = ponte.selecionado();
      if (!el || ev.button !== 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      const alvo = k === 'gap' ? el.parentElement : el;
      if (!alvo) return;
      const cs = win.getComputedStyle(alvo);
      const axis = M.guideAxis(k, k === 'gap' ? cs.flexDirection : 'row');
      const start = k === 'gap'
        ? (parseFloat(axis === 'x' ? (cs.columnGap || cs.gap) : (cs.rowGap || cs.gap)) || 0)
        : (parseFloat(cs[PROP_CALC[k]]) || 0);
      const rotular = (valor) => {
        const d = valor - start;
        valores[k].val.textContent = String(valor);
        if (d !== 0) {
          const delta = doc.createElement('span');
          delta.className = 'u-guia-delta';
          delta.textContent = `${d >= 0 ? '+' : ''}${d}`;
          valores[k].val.appendChild(doc.createTextNode(' '));
          valores[k].val.appendChild(delta);
        }
      };
      gestoDeMudancas(ev, guias[k], el, {
        limiar: 3,
        calcular: (dx, dy, e) => M.guideChanges({ key: k, start, dx, dy, axis, mods: modsDe(e) }).changes,
        aoMoverExtra: (dx, dy, e) => {
          guias[k].classList.add('u-arrastando');
          rotular(M.guideChanges({ key: k, start, dx, dy, axis, mods: modsDe(e) }).value);
        },
        // clique puro atravessa (editor.js 9116-9142) — menos no rótulo do número: ali o 1º clique de um duplo clique
        // trocaria a seleção e o campo nunca abriria (Astra, revisão do ramo)
        aoClicar: valores[k].widget.contains(ev.target) ? null : (e) => ponte.selecionarEm(e.clientX, e.clientY),
        aoFim: () => guias[k].classList.remove('u-arrastando'),
      });
    });
  });

  // ---- campo de digitar, setas e tecla G (editor.js 8963-9033, 10493-10529) ----
  // Um ciclo imediato (sem arraste) para o valor digitado e cada toque de seta: uma edição cada, como no antigo.
  function gestoImediato(el, mudancas, perto) {
    const lista = resolverAlvos(mudancas, el);
    const pode = ponte.elegivel(el, lista);
    if (!pode.ok) { mostrarMotivo(pode.motivo, perto); return null; }
    const g = ponte.iniciarGesto(lista.map(({ el: alvo, property }) => ({ el: alvo, property })));
    if (!g.ok) { mostrarMotivo(g.motivo, perto); return null; }
    ponte.previa(g.gestureId, lista);
    ponte.terminarGesto(g.gestureId, lista);
    redesenhar();
    return g.gestureId;
  }
  // Pedido que chega com outro gesto esperando o editor de fora entra numa FILA e roda quando o anterior for
  // confirmado, calculado sobre o valor daquele momento — tecla segurada não perde toques (Astra, Task 10 #2). Se o
  // anterior for cancelado (desfazer, rolagem, recusa) ou a seleção mudar, a fila cai inteira: nada roda por cima.
  const fila = [];
  let antecessor = null;
  let drenando = false;
  let drenagemMarcada = false;
  function drenarFila() {
    if (drenando) return;
    drenando = true;
    try {
      while (fila.length && !destruida && !ponte.gestoVivo()) {
        const estadoDoAnterior = antecessor ? ponte.estadoDoGesto(antecessor) : 'confirmado';
        if (estadoDoAnterior === 'cancelado') { fila.length = 0; break; }
        if (estadoDoAnterior !== 'confirmado') break;          // ainda aplicando: espera o próximo aviso
        const pedido = fila.shift();
        if (pedido.el !== ponte.selecionado() || ponte.modo() !== 'edit' || ponte.editandoTexto()) { fila.length = 0; break; }
        const mudancas = pedido.mudancas();
        if (!mudancas) continue;
        const id = gestoImediato(pedido.el, mudancas, pedido.perto);
        if (!id) { fila.length = 0; break; }
        antecessor = id;
      }
    } finally { drenando = false; }
  }
  function marcarDrenagem() {
    if (drenagemMarcada || !fila.length) return;
    drenagemMarcada = true;
    // depois do aviso da ponte terminar (ela avisa de dentro da própria confirmação)
    Promise.resolve().then(() => { drenagemMarcada = false; drenarFila(); });
  }
  function pedir(pedido) {
    if (!fila.length) antecessor = ponte.gestoAtual();   // o gesto que estiver esperando agora (ou nenhum)
    if (fila.length >= 60) return;                        // tecla segurada sem resposta nenhuma: não acumula sem fim
    fila.push(pedido);
    drenarFila();
  }
  const PROP_CSS = { mt: 'margin-top', mr: 'margin-right', mb: 'margin-bottom', ml: 'margin-left', pt: 'padding-top', pr: 'padding-right', pb: 'padding-bottom', pl: 'padding-left' };
  function leituraDaGuia(k, el) {
    const alvo = k === 'gap' ? el.parentElement : el;
    if (!alvo) return null;
    const cs = win.getComputedStyle(alvo);
    const axis = M.guideAxis(k, k === 'gap' ? cs.flexDirection : 'row');
    const atual = k === 'gap'
      ? (parseFloat(axis === 'x' ? (cs.columnGap || cs.gap) : (cs.rowGap || cs.gap)) || 0)
      : (parseFloat(cs[PROP_CALC[k]]) || 0);
    return { alvo, cs, axis, atual };
  }
  const mudancaAbsoluta = (k, axis, valor) => (k === 'gap'
    ? [{ alvo: 'parent', property: axis === 'x' ? 'column-gap' : 'row-gap', value: `${valor}px` }]
    : [{ alvo: 'self', property: PROP_CSS[k], value: `${valor}px` }]);
  // O campo pertence ao elemento em que abriu: trocar a seleção ou desmontar a camada fecha SEM gravar, e um `blur`
  // atrasado de um campo já fechado não faz nada (Astra, Task 10 #1).
  let campoAberto = null;
  function fecharCampo() {
    if (!campoAberto) return;
    const c = campoAberto;
    c.feito = true;
    campoAberto = null;
    c.widget.classList.remove('u-editando');
    c.widget.textContent = '';
    c.widget.appendChild(valores[c.k].icone);
    c.widget.appendChild(valores[c.k].val);
    if (!destruida) redesenhar();
  }
  // O duplo clique é ouvido na FAIXA: ela captura o ponteiro para arrastar, e com a captura o navegador entrega o
  // clique e o duplo clique a ela, não ao rótulo (Astra, revisão do ramo — o teste com evento sintético não via)
  const sobreORotulo = (k, ev) => {
    const r = valores[k].widget.getBoundingClientRect();
    return ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
  };
  GUIA_KEYS.forEach((k) => guias[k].addEventListener('dblclick', (ev) => {
    if (!valores[k].widget.contains(ev.target) && !sobreORotulo(k, ev)) return;
    ev.preventDefault();
    ev.stopPropagation();
    const el = ponte.selecionado();
    if (!el || campoAberto) return;
    const leitura = leituraDaGuia(k, el);
    if (!leitura) return;
    // como o antigo (recusarSeTravado ao abrir): o vão escreve no PAI, que um irmão da cena 3D prende
    if (ponte.travado(leitura.alvo)) {
      mostrarMotivo('layout_locked', { x: parseFloat(guias[k].style.left) || 16, y: parseFloat(guias[k].style.top) || 16 });
      return;
    }
    const widget = valores[k].widget;
    const input = doc.createElement('input');
    input.type = 'text';
    input.className = 'u-guia-input';
    input.value = String(Math.round(leitura.atual));
    widget.textContent = '';
    widget.appendChild(input);
    widget.classList.add('u-editando');
    const c = { k, widget, input, el, alvo: leitura.alvo, feito: false };
    c.confirmar = () => {
      if (c.feito || campoAberto !== c || destruida) return;
      const valido = ponte.selecionado() === el && (leituraDaGuia(k, el) || {}).alvo === c.alvo;
      const valor = valido ? M.parseGuideInput({
        text: input.value,
        current: leitura.atual,
        rootFontSize: win.getComputedStyle(doc.documentElement).fontSize,
        fontSize: leitura.cs.fontSize,
        parentWidth: leitura.alvo.parentElement ? leitura.alvo.parentElement.getBoundingClientRect().width : 0,
      }) : null;
      fecharCampo();
      if (valor != null && valor !== Math.round(leitura.atual)) pedir({ el, mudancas: () => mudancaAbsoluta(k, leitura.axis, valor) });
    };
    campoAberto = c;
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); c.confirmar(); }
      else if (e.key === 'Escape') { e.preventDefault(); fecharCampo(); }
    });
    input.addEventListener('blur', () => c.confirmar());
    input.addEventListener('pointerdown', (e) => e.stopPropagation());
    win.setTimeout(() => { try { input.focus(); input.select(); } catch (_) { /* sem foco */ } }, 0);
  }));
  const editavel = (n) => !!n && (n.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(String(n.tagName || '')));
  function aoTeclar(e) {
    if (destruida || campoAberto || ponte.modo() !== 'edit' || ponte.editandoTexto()) return;
    if (e.target === raiz) return;   // a sombra é fechada: de fora, quem digita na camada aparece como o hospedeiro
    const origem = typeof e.composedPath === 'function' ? e.composedPath()[0] : e.target;
    if (editavel(origem) || editavel(e.target)) return;
    if (e.metaKey && !/^Arrow/.test(e.key)) return;
    if (e.ctrlKey && !/^Arrow/.test(e.key)) return;
    if ((e.key === 'g' || e.key === 'G') && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      guiasVisiveis = !guiasVisiveis;
      redesenhar();
      return;
    }
    if (!/^Arrow(Up|Down|Left|Right)$/.test(e.key) || !guiaAtiva || !guiasVisiveis) return;
    const el = ponte.selecionado();
    if (!el) return;
    const leitura = leituraDaGuia(guiaAtiva, el);
    if (!leitura) return;
    const k = guiaAtiva; const mods = modsDe(e); const arrow = e.key;
    if (M.nudgeValue({ key: k, arrow, axis: leitura.axis, mods, current: leitura.atual }) == null) return;
    e.preventDefault();
    // o valor sai do estado da página na hora de rodar (a fila pode ter edições antes desta)
    pedir({ el, mudancas: () => {
      const agora = leituraDaGuia(k, el);
      if (!agora) return null;
      const valor = M.nudgeValue({ key: k, arrow, axis: agora.axis, mods, current: agora.atual });
      return valor == null ? null : mudancaAbsoluta(k, agora.axis, valor);
    } });
  }
  doc.addEventListener('keydown', aoTeclar, true);
  // Clicar fora com o campo aberto grava, como no antigo (item 94: o clique fora tira o foco). A ponte cancela gesto
  // vivo em qualquer toque na página, então o toque que gravou não segue para ela; o clique que vem depois só passa
  // (e troca a seleção) se a gravação já foi confirmada.
  let engolirClique = false;
  function aoApertarFora(ev) {
    if (!campoAberto || ev.target === raiz) return;   // dentro da camada (sombra fechada) quem decide é ela
    campoAberto.confirmar();
    if (ponte.gestoVivo()) { ev.stopImmediatePropagation(); ev.preventDefault(); engolirClique = true; }
  }
  function aoClicarFora(ev) {
    if (!engolirClique) return;
    engolirClique = false;
    if (ponte.gestoVivo()) { ev.stopImmediatePropagation(); ev.preventDefault(); }
  }
  win.addEventListener('pointerdown', aoApertarFora, true);
  win.addEventListener('click', aoClicarFora, true);

  CANTOS.forEach((c) => cantos[c].addEventListener('pointerdown', (ev) => {
    const el = ponte.selecionado();
    if (!el || ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    const cs = win.getComputedStyle(el);
    const start = { marginTop: parseFloat(cs.marginTop) || 0, marginRight: parseFloat(cs.marginRight) || 0, marginBottom: parseFloat(cs.marginBottom) || 0, marginLeft: parseFloat(cs.marginLeft) || 0 };
    gestoDeMudancas(ev, cantos[c], el, {
      limiar: 0,
      calcular: (dx, dy, e) => M.cornerChanges({ corner: c, start, dx, dy, mods: modsDe(e) }),
    });
  }));

  // Um laço por quadro só enquanto há o que acompanhar (§6.1); a página escondida não agenda.
  function laco() {
    quadro = 0;
    if (destruida) return;
    redesenhar();
    if (!doc.hidden && (ponte.selecionado() || ponte.passando())) quadro = win.requestAnimationFrame(laco);
  }
  function acordar() { if (!quadro && !destruida) quadro = win.requestAnimationFrame(laco); }

  // Cancelamento que vem da ponte ou do editor de fora (spec §6.2.5): o arraste daquele gesto termina aqui também, e
  // o motivo vira aviso quando não foi o próprio usuário (Esc, perda de foco) nem a camada (que já avisou)
  const AVISO_DO_CANCELAMENTO = { timeout: 'timeout', transaction_rejected: 'transaction_rejected', host_refused: 'transaction_rejected', computed_scope: 'transaction_rejected', 'page-input': 'canceled', 'panel-preview': 'canceled', 'editor-commit': 'canceled', resize: 'canceled' };
  function aoCancelarDeFora(evento) {
    if (arrasteAtivo && arrasteAtivo.idDoGesto() === evento.gestureId) arrasteAtivo.cancelar(evento.motivo);
    const motivo = String(evento.motivo || '');
    const aviso = AVISO_DO_CANCELAMENTO[motivo] || (motivo.indexOf('host:') === 0 ? 'canceled' : null);
    if (aviso) mostrarMotivo(aviso, ultimaCaixa ? { x: ultimaCaixa.x + 8, y: ultimaCaixa.y + 8 } : null);
  }
  const aoVoltarAAba = () => { if (!doc.hidden) acordar(); };
  doc.addEventListener('visibilitychange', aoVoltarAAba);
  ponte.aoMudar((evento) => {
    if (evento && evento.tipo === 'gesto-cancelado') aoCancelarDeFora(evento);
    if (campoAberto && ponte.selecionado() !== campoAberto.el) fecharCampo();
    redesenhar(); acordar(); marcarDrenagem();
  });
  doc.documentElement.appendChild(raiz);
  marcarAtiva();
  redesenhar();
  acordar();

  return {
    raiz,
    redesenhar() { redesenhar(); acordar(); },
    definirEscala(n) {
      escala = Number.isFinite(n) && n > 0 ? n : 1;
      raiz.style.setProperty('--u-escala', String(escala));
      redesenhar();
    },
    alternarGuias() { guiasVisiveis = !guiasVisiveis; redesenhar(); },
    estado() { return { caixaVisivel: selBox.style.display === 'block', caixa: ultimaCaixa, escala, guiasVisiveis, alcasApagadas, guias: guiasDesenhadas.slice(), guiaAtiva, motivo: pill.style.display === 'block' ? pill.textContent : null, arrastando: !!arrasteAtivo }; },
    ganchosDeTeste: { alcaParaTeste: (d) => handles[d], guiaParaTeste: (k) => guias[k], cantoParaTeste: (c) => cantos[c], campoParaTeste: () => (campoAberto ? campoAberto.input : null), rotuloParaTeste: () => selLabel, caixaParaTeste: () => selBox },
    destruir() {
      if (arrasteAtivo) arrasteAtivo.cancelar('teardown');
      doc.removeEventListener('keydown', aoTeclar, true);
      doc.removeEventListener('visibilitychange', aoVoltarAAba);
      win.removeEventListener('pointerdown', aoApertarFora, true);
      win.removeEventListener('click', aoClicarFora, true);
      fila.length = 0;
      destruida = true;
      fecharCampo();
      if (quadro) win.cancelAnimationFrame(quadro);
      quadro = 0;
      raiz.remove();
      if (doc.documentElement.dataset.uncraftOverlayAtiva === dono) delete doc.documentElement.dataset.uncraftOverlayAtiva;
    },
  };
}
