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
      DIRS.forEach((d) => {
        const h = pontoParaRaiz(o, lugar.handles[d]);
        Object.assign(handles[d].style, { display: travado ? 'none' : 'block', left: `${h.x}px`, top: `${h.y}px` });
      });
      selLabel.textContent = `${Math.round(box.width)} × ${Math.round(box.height)}`;
      const rl = pontoParaRaiz(o, lugar.label);
      Object.assign(selLabel.style, { display: 'block', left: `${rl.x}px`, top: `${rl.y}px` });
    } else {
      DIRS.forEach((d) => { handles[d].style.display = 'none'; });
      selLabel.style.display = 'none';
    }
  }

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
    estado() { return { caixaVisivel: selBox.style.display === 'block', caixa: ultimaCaixa, escala, guiasVisiveis }; },
    destruir() {
      destruida = true;
      if (quadro) win.cancelAnimationFrame(quadro);
      quadro = 0;
      raiz.remove();
      if (doc.documentElement.dataset.uncraftOverlayAtiva === dono) delete doc.documentElement.dataset.uncraftOverlayAtiva;
    },
  };
}
