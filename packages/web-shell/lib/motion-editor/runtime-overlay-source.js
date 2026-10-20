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
    } else {
      DIRS.forEach((d) => { handles[d].style.display = 'none'; });
      selLabel.style.display = 'none';
      avaliarAlcas(null);
    }
  }

  // ---- arrastar os quadradinhos (spec §5.2; editor.js 10738-10830) ----
  // A camada só faz PRÉVIA; quem confirma é o editor de fora (§6.2). Mudanças viram [{ el, property, value }].
  const resolverAlvos = (lista, el) => lista
    .map((c) => ({ el: c.alvo === 'parent' ? el.parentElement : el, property: c.property, value: c.value }))
    .filter((c) => c.el);
  // Um arraste por vez, preso ao ponteiro que o começou. Cancelamento do ponteiro, perda de captura, Esc, perda de
  // foco e desmonte da camada passam pela MESMA limpeza, segura de chamar mais de uma vez (Astra, Task 8).
  let arrasteAtivo = null;
  function arrastar(ev, alvoCaptura, { limiar, aoComecar, aoMover, aoSoltar, aoCancelar }) {
    if (arrasteAtivo) arrasteAtivo.cancelar('superseded');
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
    const controle = { cancelar };
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
    const computed = { maxWidth: cs.maxWidth, maxHeight: cs.maxHeight, minWidth: cs.minWidth, minHeight: cs.minHeight, width: cs.width, height: cs.height, flexGrow: cs.flexGrow, boxSizing: cs.boxSizing };
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
      aoMover(dx, dy) { ponte.previa(gesto, mudancasDe(dx, dy)); redesenhar(); },
      aoSoltar(dx, dy, e, comecou) {
        if (!comecou || !gesto) return;
        const finais = mudancasDe(dx, dy);
        const pode = ponte.elegivel(el, finais, { ignorarGesto: gesto, semMedirTamanho: true });
        if (!pode.ok) { ponte.cancelarGesto(gesto, pode.motivo); mostrarMotivo(pode.motivo, { x: e.clientX + 12, y: e.clientY + 12 }); return; }
        ponte.terminarGesto(gesto, finais);
        redesenhar();
      },
      aoCancelar(motivo) { if (gesto) ponte.cancelarGesto(gesto, motivo); redesenhar(); },
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

  ponte.aoMudar(() => { redesenhar(); acordar(); });
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
    estado() { return { caixaVisivel: selBox.style.display === 'block', caixa: ultimaCaixa, escala, guiasVisiveis, alcasApagadas }; },
    ganchosDeTeste: { alcaParaTeste: (d) => handles[d] },
    destruir() {
      if (arrasteAtivo) arrasteAtivo.cancelar('teardown');
      destruida = true;
      if (quadro) win.cancelAnimationFrame(quadro);
      quadro = 0;
      raiz.remove();
      if (doc.documentElement.dataset.uncraftOverlayAtiva === dono) delete doc.documentElement.dataset.uncraftOverlayAtiva;
    },
  };
}
