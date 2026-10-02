/*
 * Tocador do PROGRAMA DE MOVIMENTO v0 (docs/superpowers/specs/2026-10-02-programa-de-movimento-v0.md).
 *
 * Lê a "ficha" (motion.json ou <script type="application/json" id="uncraft-motion-programa">),
 * valida e monta uma animação por ficha com GSAP + ScrollTrigger (vendorizados no pacote) e
 * Lenis opcional. NENHUM código de animação do site original roda — um só motor com autoridade.
 *
 * Contrato com o painel: window.__uncraftMotion = { montar, desmontar, fichas, aplicar, relatorio }.
 * Ficha inválida é IGNORADA e REPORTADA, nunca derruba a página.
 * Texto dividido: o documento guarda o texto INTEIRO; o corte em partes acontece aqui e o
 * texto original é RESTAURADO ao desmontar.
 *
 * Script clássico (sem import/export) para rodar direto no clone; também carregável no Node
 * para testar a validação (atribui a globalThis.UncraftMotion).
 */
(function () {
  var raiz = typeof window !== 'undefined' ? window : globalThis;
  var MOTORES = { carga: 1, rolagem: 1, tempo: 1, hover: 1 };
  var DIVISOES = { chars: 1, words: 1, lines: 1 };

  function ehObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function ehNum(v) { return typeof v === 'number' && isFinite(v); }
  function ehAlvo(v) { return typeof v === 'string' && /^#[A-Za-z][\w-]*$/.test(v); }
  // So PROPRIEDADES animaveis entram em de/para/quadros (revisao Claude): chaves de controle do
  // GSAP (scrollTrigger, stagger, onComplete...) contornariam o contrato "alvo so por #id".
  var PROPS = { x: 1, y: 1, xPercent: 1, yPercent: 1, scale: 1, scaleX: 1, scaleY: 1, rotate: 1, rotation: 1, skewX: 1, skewY: 1,
    opacity: 1, autoAlpha: 1, color: 1, backgroundColor: 1, borderColor: 1, clipPath: 1, filter: 1, width: 1, height: 1,
    backgroundPosition: 1, transformOrigin: 1, borderRadius: 1, letterSpacing: 1, ease: 1 };
  function propsValidas(o) { return Object.keys(o).every(function (k) { return PROPS[k] && (typeof o[k] === 'number' || typeof o[k] === 'string'); }); }
  function copia(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

  // ---- validação (pura) ----
  function validarFicha(f, vistos) {
    var e = [];
    if (!ehObj(f)) return ['ficha nao e objeto'];
    if (typeof f.id !== 'string' || !f.id) e.push('id ausente');
    else if (vistos[f.id]) e.push('id repetido: ' + f.id);
    var alvos = Array.isArray(f.alvo) ? f.alvo : [f.alvo];
    if (!alvos.length || !alvos.every(ehAlvo)) e.push('alvo deve ser #id ou lista de #id');
    if (f.tipo === 'lottie') {
      if (typeof f.src !== 'string' || !f.src) e.push('lottie sem src');
    } else {
      if (!ehObj(f.para) && !Array.isArray(f.quadros)) e.push('falta para ou quadros');
      if (f.de !== undefined && !ehObj(f.de)) e.push('de deve ser objeto');
      if (f.quadros !== undefined && (!Array.isArray(f.quadros) || f.quadros.length < 2 || !f.quadros.every(ehObj))) e.push('quadros deve ter >= 2 objetos');
      if (f.quadros !== undefined && (f.de !== undefined || f.para !== undefined)) e.push('use quadros OU de/para, nao os dois');
      [f.de, f.para].concat(Array.isArray(f.quadros) ? f.quadros : []).forEach(function (o) { if (ehObj(o) && !propsValidas(o)) e.push('propriedade nao animavel em de/para/quadros'); });
      if (f.dividir !== undefined && !DIVISOES[f.dividir]) e.push('dividir invalido');
    }
    if (!ehObj(f.motor) || !MOTORES[f.motor.tipo]) e.push('motor.tipo invalido');
    else if (f.motor.gatilho !== undefined && !ehAlvo(f.motor.gatilho)) e.push('motor.gatilho deve ser #id');
    ['duracao', 'atraso', 'intervalo', 'repetir'].forEach(function (k) {
      if (f[k] !== undefined && !ehNum(f[k])) e.push(k + ' nao numerico');
    });
    if (f.duracao !== undefined && f.duracao < 0) e.push('duracao negativa');
    return e;
  }
  function validar(prog) {
    var erros = []; var fichas = []; var vistos = {};
    if (!ehObj(prog)) return { fichas: [], erros: [{ id: null, erros: ['programa nao e objeto'] }] };
    if (prog.versao !== 0) erros.push({ id: null, erros: ['versao deve ser 0'] });
    var divididos = {};
    (Array.isArray(prog.fichas) ? prog.fichas : []).forEach(function (f) {
      var e = validarFicha(f, vistos);
      // Um elemento so pode ser cortado por UMA ficha (revisao Claude): a 2a veria as partes da 1a.
      if (!e.length && f.dividir) {
        (Array.isArray(f.alvo) ? f.alvo : [f.alvo]).forEach(function (a) { if (divididos[a]) e.push('alvo ja dividido por ' + divididos[a] + ': ' + a); });
        if (!e.length) (Array.isArray(f.alvo) ? f.alvo : [f.alvo]).forEach(function (a) { divididos[a] = f.id; });
      }
      if (e.length) erros.push({ id: f && f.id, erros: e }); else { vistos[f.id] = 1; fichas.push(f); }
    });
    return { fichas: fichas, erros: erros };
  }

  // ---- corte de texto (só texto simples; o original é guardado e restaurado) ----
  function cortar(el, modo) {
    if (el.children.length) return null;   // esquema: texto simples; com marcação filha não corta
    if (el.__uncraftTexto === undefined) el.__uncraftTexto = el.textContent;
    var doc = el.ownerDocument; var texto = el.__uncraftTexto;
    el.textContent = '';
    var partes = []; var palavras = [];
    texto.split(/(\s+)/).forEach(function (pedaco) {
      if (!pedaco) return;
      if (/^\s+$/.test(pedaco)) { el.appendChild(doc.createTextNode(pedaco)); return; }
      var w = doc.createElement('span');
      w.className = 'u-palavra'; w.style.display = 'inline-block'; w.style.whiteSpace = 'nowrap';
      if (modo === 'chars') {
        var grafemas = (typeof Intl !== 'undefined' && Intl.Segmenter)
          ? Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(pedaco), function (g) { return g.segment; })
          : Array.from(pedaco);
        grafemas.forEach(function (c) {
          var s = doc.createElement('span'); s.className = 'u-letra'; s.style.display = 'inline-block'; s.textContent = c;
          w.appendChild(s); partes.push(s);
        });
      } else { w.textContent = pedaco; }
      el.appendChild(w); palavras.push(w);
    });
    if (modo === 'words') partes = palavras;
    if (modo === 'lines') {
      var linhas = []; var topo = null;
      palavras.forEach(function (w) {
        var t = w.offsetTop;
        if (topo === null || Math.abs(t - topo) > 2) { linhas.push([]); topo = t; }
        linhas[linhas.length - 1].push(w);
      });
      partes = linhas.map(function (ws) {
        var l = doc.createElement('span'); l.className = 'u-linha'; l.style.display = 'block';
        ws[0].parentNode.insertBefore(l, ws[0]);
        ws.forEach(function (w) {
          var prox = w.nextSibling; l.appendChild(w);
          if (prox && prox.nodeType === 3 && ws.indexOf(w) < ws.length - 1) l.appendChild(prox);
        });
        return l;
      });
    }
    return partes;
  }
  function restaurar(el) {
    if (el.__uncraftTexto !== undefined) { el.textContent = el.__uncraftTexto; delete el.__uncraftTexto; }
  }

  // ---- montagem ----
  var estado = { programa: null, montadas: {}, erros: [], lenis: null, originais: new Map() };

  function elementosDe(f, doc) {
    var ids = Array.isArray(f.alvo) ? f.alvo : [f.alvo];
    var els = []; var faltam = [];
    ids.forEach(function (sel) { var el = doc.getElementById(sel.slice(1)); if (el) els.push(el); else faltam.push(sel); });
    return { els: els, faltam: faltam };
  }

  function montarFicha(f, doc) {
    var gsap = raiz.gsap;
    var achados = elementosDe(f, doc);
    if (achados.faltam.length) { estado.erros.push({ id: f.id, erros: ['alvo ausente: ' + achados.faltam.join(', ')] }); return; }
    var els = achados.els;
    var registro = { ficha: f, els: els, cortados: [], animacao: null, ouvintes: [], gatilhoST: null };
    els.forEach(function (el) { if (!estado.originais.has(el)) estado.originais.set(el, el.getAttribute('style')); });
    var gatilho = null;
    if (f.motor.gatilho) {
      gatilho = doc.getElementById(f.motor.gatilho.slice(1));
      if (!gatilho) { estado.erros.push({ id: f.id, erros: ['gatilho ausente: ' + f.motor.gatilho] }); return; }
    }
    if (f.tipo === 'lottie') {
      if (!raiz.lottie) { estado.erros.push({ id: f.id, erros: ['lottie-web ausente'] }); return; }
      var mt = f.motor.tipo;
      var anim = raiz.lottie.loadAnimation({ container: els[0], path: f.src, renderer: 'svg', loop: mt === 'tempo', autoplay: mt === 'carga' || mt === 'tempo' });
      registro.animacao = anim;
      if (mt === 'hover') {
        var g = gatilho || els[0];
        var le = function () { anim.setDirection(1); anim.play(); }; var ls = function () { anim.setDirection(-1); anim.play(); };
        g.addEventListener('mouseenter', le); g.addEventListener('mouseleave', ls);
        registro.ouvintes.push([g, 'mouseenter', le], [g, 'mouseleave', ls]);
      }
      if (mt === 'rolagem' && raiz.ScrollTrigger) {
        registro.gatilhoST = raiz.ScrollTrigger.create({
          trigger: gatilho || els[0], start: f.motor.inicio || 'top bottom', end: f.motor.fim || 'bottom top',
          onUpdate: function (st) { if (anim.totalFrames) anim.goToAndStop(st.progress * (anim.totalFrames - 1), true); },
        });
      }
      estado.montadas[f.id] = registro; return;
    }
    var alvos = els;
    if (f.dividir) {
      var partes = [];
      els.forEach(function (el) { var p = cortar(el, f.dividir); if (p) { partes = partes.concat(p); registro.cortados.push(el); } else partes.push(el); });
      alvos = partes;
    }
    var vars = {};
    // COPIAS (revisao Claude): o GSAP escreve nos objetos que recebe (parent, ease...) e a
    // ficha ficaria circular — salvar o programa a partir de fichas() quebrava.
    if (Array.isArray(f.quadros)) vars.keyframes = copia(f.quadros); else Object.keys(f.para).forEach(function (k) { vars[k] = f.para[k]; });
    if (f.duracao !== undefined) vars.duration = f.duracao;
    if (f.curva !== undefined) vars.ease = f.curva;
    if (f.atraso !== undefined) vars.delay = f.atraso;
    if (f.intervalo !== undefined) vars.stagger = f.intervalo;
    var m = f.motor;
    if (m.tipo === 'carga' && m.atraso !== undefined) vars.delay = m.atraso;
    if (m.tipo === 'tempo') { vars.repeat = f.repetir !== undefined ? f.repetir : -1; vars.yoyo = Boolean(f.vaiVolta); }
    else { if (f.repetir !== undefined) vars.repeat = f.repetir; if (f.vaiVolta) vars.yoyo = true; }
    if (m.tipo === 'rolagem') {
      vars.scrollTrigger = {
        trigger: gatilho || els[0],
        start: m.inicio || 'top 80%', end: m.fim || 'bottom 20%',
        scrub: m.arrasto === true ? true : (ehNum(m.arrasto) ? m.arrasto : false),
        pin: Boolean(m.fixar),
        toggleActions: m.acoes || 'play none none none',
      };
    }
    if (m.tipo === 'hover') vars.paused = true;
    registro.animacao = (f.de && !vars.keyframes) ? gsap.fromTo(alvos, copia(f.de), vars) : gsap.to(alvos, vars);
    if (m.tipo === 'hover') {
      var entra = function () { registro.animacao.play(); }; var sai = function () { registro.animacao.reverse(); };
      (gatilho ? [gatilho] : els).forEach(function (gat) {   // todos os alvos do grupo, nao so o 1o
        gat.addEventListener('mouseenter', entra); gat.addEventListener('mouseleave', sai);
        registro.ouvintes.push([gat, 'mouseenter', entra], [gat, 'mouseleave', sai]);
      });
    }
    estado.montadas[f.id] = registro;
  }

  function desmontarFicha(id) {
    var r = estado.montadas[id]; if (!r) return;
    r.ouvintes.forEach(function (o) { o[0].removeEventListener(o[1], o[2]); });
    if (r.gatilhoST) r.gatilhoST.kill();
    if (r.animacao) {
      // revert() devolve SO o que esta animacao escreveu; estilos de outras fichas no mesmo
      // elemento ficam (revisao Claude: o snapshot por ficha apagava os da vizinha).
      if (typeof r.animacao.revert === 'function') r.animacao.revert(); else if (typeof r.animacao.destroy === 'function') r.animacao.destroy(); else if (r.animacao.kill) r.animacao.kill();
    }
    r.cortados.forEach(restaurar);   // so o que ESTA ficha cortou
    delete estado.montadas[id];
  }

  function montar(prog, doc) {
    doc = doc || raiz.document;
    if (!raiz.gsap) { estado.erros = [{ id: null, erros: ['gsap ausente'] }]; return relatorio(); }
    if (raiz.ScrollTrigger) raiz.gsap.registerPlugin(raiz.ScrollTrigger);
    desmontar();
    var v = validar(prog);
    prog = prog && Array.isArray(prog.fichas) ? Object.assign({}, prog, { fichas: prog.fichas.slice() }) : prog;
    estado.programa = prog; estado.erros = v.erros.slice();
    var rs = prog && prog.rolagemSuave;
    if (rs && rs.tipo === 'lenis' && raiz.Lenis) {
      var lenis = new raiz.Lenis({ lerp: ehNum(rs.lerp) ? rs.lerp : 0.1 });
      if (raiz.ScrollTrigger) lenis.on('scroll', raiz.ScrollTrigger.update);
      estado.tique = function (t) { lenis.raf(t * 1000); };
      raiz.gsap.ticker.add(estado.tique); raiz.gsap.ticker.lagSmoothing(0);
      estado.lenis = lenis;
    }
    v.fichas.forEach(function (f) {
      try { montarFicha(f, doc); } catch (err) { estado.erros.push({ id: f.id, erros: ['falha ao montar: ' + (err && err.message)] }); }
    });
    try { if (raiz.ScrollTrigger) raiz.ScrollTrigger.refresh(); } catch (err) { estado.erros.push({ id: null, erros: ['refresh falhou: ' + (err && err.message)] }); }
    return relatorio();
  }

  function desmontar() {
    Object.keys(estado.montadas).forEach(desmontarFicha);
    // estilo inline do autor, como estava ANTES de qualquer ficha
    estado.originais.forEach(function (s, el) { if (s === null) el.removeAttribute('style'); else el.setAttribute('style', s); });
    estado.originais = new Map();
    if (estado.lenis) { raiz.gsap.ticker.remove(estado.tique); raiz.gsap.ticker.lagSmoothing(500, 33); estado.lenis.destroy(); estado.lenis = null; }
  }

  // Painel: muda campos de UMA ficha e remonta só ela. Campos aninhados (motor) são mesclados.
  function aplicar(id, campos, doc) {
    doc = doc || raiz.document;
    var fichas = (estado.programa && estado.programa.fichas) || [];
    var i = fichas.findIndex(function (f) { return f && f.id === id; });
    if (i < 0) return { ok: false, erro: 'ficha inexistente: ' + id };
    var nova = Object.assign({}, fichas[i], campos);
    if (campos && ehObj(campos.motor)) nova.motor = Object.assign({}, fichas[i].motor, campos.motor);
    var outras = {}; fichas.forEach(function (f, k) { if (k !== i && f) outras[f.id] = 1; });
    var e = validarFicha(nova, outras);
    if (!e.length) {
      var teste = validar({ versao: 0, fichas: fichas.map(function (f, k) { return k === i ? nova : f; }) });
      teste.erros.forEach(function (x) { if (x.id === id) e = e.concat(x.erros); });
    }
    if (e.length) return { ok: false, erro: e.join('; ') };
    // Seguro contra excecao (revisao Claude): se a nova nao monta, a antiga volta.
    var antiga = fichas[i];
    desmontarFicha(id);
    try {
      fichas[i] = nova; montarFicha(nova, doc);
      if (!estado.montadas[id]) throw new Error('nao montou');
    } catch (err) {
      desmontarFicha(id); fichas[i] = antiga;
      try { montarFicha(antiga, doc); } catch (e2) { /* fica reportada */ }
      return { ok: false, erro: 'falha ao montar: ' + (err && err.message) };
    }
    try { if (raiz.ScrollTrigger) raiz.ScrollTrigger.refresh(); } catch (e3) { /* refresh nao desfaz a edicao */ }
    return { ok: true };
  }

  function relatorio() {
    return { montadas: Object.keys(estado.montadas), erros: estado.erros.slice() };
  }

  var api = { validar: validar, montar: montar, desmontar: desmontar, aplicar: aplicar, relatorio: relatorio, fichas: function () { return (estado.programa && estado.programa.fichas) || []; } };
  raiz.UncraftMotion = api;
  raiz.__uncraftMotion = api;

  // Auto-montagem no clone: programa embutido no documento, senão motion.json ao lado.
  if (raiz.document && raiz.document.addEventListener && !raiz.__uncraftMotionSemAuto) {
    // Espera o GSAP (script com defer pode chegar depois) e as FONTES (o corte em linhas mede
    // quebras; antes das fontes elas sairiam erradas e ficariam presas) — revisao Claude.
    var tentativas = 0;
    var comPrograma = function (p) {
      var pronto = function () {
        if (!raiz.gsap && tentativas++ < 50) { setTimeout(pronto, 100); return; }
        var fontes = raiz.document.fonts && raiz.document.fonts.ready;
        (fontes ? fontes.then(function () { montar(p); }, function () { montar(p); }) : montar(p));
      };
      pronto();
    };
    var iniciar = function () {
      var embutido = raiz.document.getElementById('uncraft-motion-programa');
      if (embutido) {
        var p = null; try { p = JSON.parse(embutido.textContent); } catch (err) { estado.erros = [{ id: null, erros: ['programa embutido ilegivel: ' + (err && err.message)] }]; return; }
        comPrograma(p); return;
      }
      if (typeof raiz.fetch === 'function') {
        raiz.fetch('motion.json')
          .then(function (r) { if (!r.ok) throw new Error('motion.json HTTP ' + r.status); return r.json(); })
          .then(comPrograma, function (err) { estado.erros = [{ id: null, erros: ['motion.json indisponivel: ' + (err && err.message)] }]; });
      }
    };
    if (raiz.document.readyState === 'loading') raiz.document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
  }
})();
