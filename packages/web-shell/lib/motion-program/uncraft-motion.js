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
  var ORIGENS = { start: 1, end: 1, center: 1, edges: 1, random: 1 };

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
    } else if (f.tipo === 'sequencia') {
      // SEQUENCIA DE QUADROS (caminho 3): imagens desenhadas num <canvas>, uma por posicao
      // 1 imagem = QUADRO FIXO (canvas que o site desenha uma vez e so muda por clique, por ex.)
      if (!Array.isArray(f.imagens) || !f.imagens.length || !f.imagens.every(function (u) { return typeof u === 'string' && u; })) e.push('sequencia precisa de imagens');
      if (f.ajuste !== undefined && f.ajuste !== 'cobrir' && f.ajuste !== 'conter') e.push('ajuste invalido');
      // pontos: [progresso 0..1, indice do quadro] medidos, crescentes no progresso
      if (f.pontos !== undefined && (!Array.isArray(f.pontos) || f.pontos.length < 2 || !f.pontos.every(function (q, i, a) { return Array.isArray(q) && q.length === 2 && ehNum(q[0]) && ehNum(q[1]) && (!i || q[0] >= a[i - 1][0]); }))) e.push('pontos invalidos');
      if (ehObj(f.motor) && f.motor.tipo === 'hover') e.push('sequencia nao toca em hover');
    } else {
      // so `de` = animar DE um estado ate o atual (o `from` do GSAP; o IX3 do Webflow usa)
      if (!ehObj(f.para) && !Array.isArray(f.quadros) && !ehObj(f.de) && !Array.isArray(f.porParte)) e.push('falta para ou quadros');
      if (f.de !== undefined && !ehObj(f.de)) e.push('de deve ser objeto');
      if (f.quadros !== undefined && (!Array.isArray(f.quadros) || f.quadros.length < 2 || !f.quadros.every(ehObj))) e.push('quadros deve ter >= 2 objetos');
      if (f.quadros !== undefined && (f.de !== undefined || f.para !== undefined)) e.push('use quadros OU de/para, nao os dois');
      [f.de, f.para].concat(Array.isArray(f.quadros) ? f.quadros : []).forEach(function (o) { if (ehObj(o) && !propsValidas(o)) e.push('propriedade nao animavel em de/para/quadros'); });
      if (f.dividir !== undefined && !DIVISOES[f.dividir]) e.push('dividir invalido');
    }
    if (!ehObj(f.motor) || !MOTORES[f.motor.tipo]) e.push('motor.tipo invalido');
    else if (f.motor.gatilho !== undefined && !ehAlvo(f.motor.gatilho)) e.push('motor.gatilho deve ser #id');
    // FIXAR a secao na tela (pin): true = o gatilho; '#id' = outro elemento. espacoReservado: a estrutura
    // ja traz o espaco que o site reservou para a fixacao (nao somar de novo). conteiner: o gatilho conta
    // o deslizamento de OUTRA linha (rolagem horizontal), nao a rolagem da pagina.
    if (ehObj(f.motor)) {
      if (f.motor.fixar !== undefined && typeof f.motor.fixar !== 'boolean' && !ehAlvo(f.motor.fixar)) e.push('motor.fixar deve ser booleano ou #id');
      if (f.motor.espacoReservado !== undefined && typeof f.motor.espacoReservado !== 'boolean') e.push('motor.espacoReservado deve ser booleano');
      if (f.motor.conteiner !== undefined && !(typeof f.motor.conteiner === 'string' && /^[\w-]+$/.test(f.motor.conteiner))) e.push('motor.conteiner invalido');
      if (f.motor.conteiner !== undefined && f.motor.conteiner === f.linha) e.push('linha nao pode ser o proprio conteiner');
      if (f.motor.conteiner !== undefined && f.motor.tipo !== 'rolagem') e.push('conteiner so vale para rolagem');
    }
    ['duracao', 'atraso', 'repetir', 'posicao', 'atrasoRepeticao'].forEach(function (k) {
      if (f[k] !== undefined && !ehNum(f[k])) e.push(k + ' nao numerico');
    });
    // intervalo: segundos entre alvos, ou { cada | total, de: start|end|center|edges|random }
    if (f.intervalo !== undefined && !ehNum(f.intervalo) && !(ehObj(f.intervalo) && (ehNum(f.intervalo.cada) || ehNum(f.intervalo.total)) && (f.intervalo.de === undefined || ORIGENS[f.intervalo.de]))) e.push('intervalo invalido');
    // LINHA DE TEMPO: fichas com a mesma `linha` tocam numa so, cada uma na sua `posicao` (s)
    if (f.linha !== undefined && !(typeof f.linha === 'string' && /^[\w-]+$/.test(f.linha))) e.push('linha invalida');
    if (f.posicao !== undefined && (f.linha === undefined || f.posicao < 0)) e.push('posicao exige linha e >= 0');
    if (f.linha !== undefined && f.tipo) e.push('lottie/sequencia nao entram em linha');
    // imediato: false = nao aplicar o estado `de` ao montar (acao que repete uma propriedade ja
    // animada do mesmo alvo numa linha: pre-renderizar apagaria o estado da acao anterior)
    if (f.imediato !== undefined && typeof f.imediato !== 'boolean') e.push('imediato deve ser booleano');
    // VALORES POR PARTE (letras que caem cada uma de um jeito — sorteio do site): so em linha e com
    // dividir; cada entrada e a parte de indice `i` com o seu de/para, duracao e atraso proprios
    if (f.porParte !== undefined) {
      if (!Array.isArray(f.porParte) || !f.porParte.length) e.push('porParte deve ser lista');
      else if (f.linha === undefined || !f.dividir) e.push('porParte exige linha e dividir');
      else if (!f.porParte.every(function (q) { return ehObj(q) && ehNum(q.i) && q.i >= 0 && ehObj(q.para) && propsValidas(q.para) && (q.de === undefined || (ehObj(q.de) && propsValidas(q.de))) && (q.duracao === undefined || (ehNum(q.duracao) && q.duracao >= 0)) && (q.atraso === undefined || ehNum(q.atraso)) && (q.repetir === undefined || ehNum(q.repetir)) && (q.vaiVolta === undefined || typeof q.vaiVolta === 'boolean') && (q.atrasoRepeticao === undefined || ehNum(q.atrasoRepeticao)); })) e.push('porParte invalido');
    }
    if (f.duracao !== undefined && f.duracao < 0) e.push('duracao negativa');
    // inicio/fim: posicao ABSOLUTA em px (numero; 0 e valido — `inicio || padrao` trocava o topo
    // da pagina por 'top 80%') ou expressao do ScrollTrigger (texto)
    if (ehObj(f.motor)) ['inicio', 'fim'].forEach(function (k) { var v = f.motor[k]; if (v !== undefined && !ehNum(v) && typeof v !== 'string') e.push('motor.' + k + ' invalido'); });
    return e;
  }
  function validar(prog) {
    var erros = []; var fichas = []; var vistos = {};
    if (!ehObj(prog)) return { fichas: [], erros: [{ id: null, erros: ['programa nao e objeto'] }] };
    if (prog.versao !== 0) erros.push({ id: null, erros: ['versao deve ser 0'] });
    var divididos = {}; var linhas = {};
    (Array.isArray(prog.fichas) ? prog.fichas : []).forEach(function (f) {
      var e = validarFicha(f, vistos);
      // Um elemento so e cortado de UM jeito (revisao Claude): fichas com o mesmo modo partilham as
      // partes; outro modo veria as partes da 1a e e recusado.
      if (!e.length && f.dividir) {
        (Array.isArray(f.alvo) ? f.alvo : [f.alvo]).forEach(function (a) { if (divididos[a] && divididos[a].modo !== f.dividir) e.push('alvo ja dividido em ' + divididos[a].modo + ' por ' + divididos[a].id + ': ' + a); });
        if (!e.length) (Array.isArray(f.alvo) ? f.alvo : [f.alvo]).forEach(function (a) { if (!divididos[a]) divididos[a] = { id: f.id, modo: f.dividir }; });
      }
      if (!e.length && f.linha !== undefined) {
        var mot = JSON.stringify(f.motor);
        if (linhas[f.linha] === undefined) linhas[f.linha] = mot; else if (linhas[f.linha] !== mot) e.push('motor diferente do resto da linha ' + f.linha);
      }
      if (e.length) erros.push({ id: f && f.id, erros: e }); else { vistos[f.id] = 1; fichas.push(f); }
    });
    // o CONTEINER citado tem que existir entre as linhas validas (Astra: renomear a linha trilho
    // passava como sucesso e soltava quem dependia dela)
    var nomes = {}; fichas.forEach(function (f) { if (f.linha !== undefined) nomes[f.linha] = 1; });
    var orfas = fichas.filter(function (f) { return f.motor && f.motor.conteiner !== undefined && !nomes[f.motor.conteiner]; });
    orfas.forEach(function (f) { erros.push({ id: f.id, erros: ['conteiner inexistente: ' + f.motor.conteiner] }); });
    if (orfas.length) fichas = fichas.filter(function (f) { return orfas.indexOf(f) < 0; });
    return { fichas: fichas, erros: erros };
  }

  // ---- corte de texto (só texto simples; o original é guardado e restaurado) ----
  // CORTE PARTILHADO (revisao Claude #5): varias fichas que dividem o MESMO elemento do MESMO jeito
  // animam as MESMAS partes (o IX3 do Webflow divide uma vez e varias acoes usam); o texto so volta
  // quando a ultima delas desmonta. Modo diferente = recusado na validacao.
  function cortar(el, modo) {
    var c = el.__uncraftCorte;
    if (c) { if (c.modo !== modo) return null; c.usos += 1; return c.partes; }
    var partes = cortarTexto(el, modo);
    if (partes) {
      el.__uncraftCorte = { modo: modo, partes: partes, usos: 1 };
      // etiqueta deterministica de cada parte (a regua de trajetoria mede as partes por ela)
      // com o NIVEL (l/w/c) e a ordem dentro dele — a mesma chave que a gravacao do site usa
      var nv = modo === 'lines' ? 'l' : modo === 'words' ? 'w' : 'c';
      if (el.id) partes.forEach(function (p, n) { p.setAttribute('data-u-parte', el.id + '--' + nv + n); });
    }
    return partes;
  }
  function cortarTexto(el, modo) {
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
    var c = el.__uncraftCorte;
    if (c) { c.usos -= 1; if (c.usos > 0) return; delete el.__uncraftCorte; }
    if (el.__uncraftTexto !== undefined) { el.textContent = el.__uncraftTexto; delete el.__uncraftTexto; }
  }

  // ---- montagem ----
  var estado = { programa: null, montadas: {}, linhas: {}, erros: [], lenis: null, originais: new Map(), vigia: null };

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
          trigger: gatilho || els[0], start: (f.motor.inicio !== undefined ? f.motor.inicio : 'top bottom'), end: (f.motor.fim !== undefined ? f.motor.fim : 'bottom top'),
          onUpdate: function (st) { if (anim.totalFrames) anim.goToAndStop(st.progress * (anim.totalFrames - 1), true); },
        });
      }
      estado.montadas[f.id] = registro; return;
    }
    if (f.tipo === 'sequencia') {
      var cv = els[0]; var ctx2 = cv && cv.getContext ? cv.getContext('2d') : null;
      if (!ctx2) { estado.erros.push({ id: f.id, erros: ['alvo da sequencia nao e canvas'] }); return; }
      var n = f.imagens.length; var atual = -1; var pedido = 0; var vivo = true; var esperando = {};
      var imgs = f.imagens.map(function (u) { var im = new raiz.Image(); im.decoding = 'async'; im.src = u; return im; });
      var desenhar = function (i) {
        i = Math.max(0, Math.min(n - 1, Math.round(i))); pedido = i;
        var im = imgs[i];
        // imagem ainda chegando: UM ouvinte por imagem, e so desenha se a ficha ainda esta montada
        // (revisao Claude #11: o ouvinte velho desenhava depois do limpar/remontar)
        if (!im.complete || !im.naturalWidth) { if (!esperando[i]) { esperando[i] = 1; im.addEventListener('load', function () { delete esperando[i]; if (vivo && pedido === i) desenhar(i); }, { once: true }); } return; }
        var r = cv.getBoundingClientRect(); var dpr = raiz.devicePixelRatio || 1;
        var w = Math.max(1, Math.round(r.width * dpr)); var h = Math.max(1, Math.round(r.height * dpr));
        if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; atual = -1; }
        if (i === atual) return;
        var esc = (f.ajuste === 'conter' ? Math.min : Math.max)(w / im.naturalWidth, h / im.naturalHeight);
        var dw = im.naturalWidth * esc; var dh = im.naturalHeight * esc;
        ctx2.clearRect(0, 0, w, h); ctx2.drawImage(im, (w - dw) / 2, (h - dh) / 2, dw, dh); atual = i;
      };
      // progresso -> quadro: pelos pontos MEDIDOS (linear por trecho); sem pontos, linear no todo
      var indice = function (p) {
        var q = f.pontos; if (!q) return p * (n - 1);
        if (p <= q[0][0]) return q[0][1];
        for (var k = 1; k < q.length; k += 1) if (p <= q[k][0]) { var a = q[k - 1]; var b = q[k]; return b[0] === a[0] ? b[1] : a[1] + (b[1] - a[1]) * (p - a[0]) / (b[0] - a[0]); }
        return q[q.length - 1][1];
      };
      registro.limpar = function () { vivo = false; ctx2.clearRect(0, 0, cv.width, cv.height); };
      if (n === 1) { desenhar(0); estado.montadas[f.id] = registro; return; }
      var prog = { p: 0 }; var mt2 = f.motor.tipo;
      var vs = { p: 1, ease: 'none', onUpdate: function () { desenhar(indice(prog.p)); } };
      if (mt2 === 'rolagem') {
        vs.scrollTrigger = { trigger: gatilho || cv, start: f.motor.inicio !== undefined ? f.motor.inicio : 'top top', end: f.motor.fim !== undefined ? f.motor.fim : 'bottom bottom', scrub: ehNum(f.motor.arrasto) ? f.motor.arrasto : true };
      } else {
        vs.duration = f.duracao !== undefined ? f.duracao : n / 30;
        if (mt2 === 'tempo') { vs.repeat = f.repetir !== undefined ? f.repetir : -1; vs.yoyo = Boolean(f.vaiVolta); }
        if (mt2 === 'carga' && f.motor.atraso !== undefined) vs.delay = f.motor.atraso;
      }
      registro.animacao = gsap.to(prog, vs);
      desenhar(indice(prog.p));
      estado.montadas[f.id] = registro; return;
    }
    var alvos = cortarAlvos(f, els, registro);
    try { montarTween(f, els, alvos, gatilho, registro, doc); }
    catch (err) { registro.cortados.forEach(restaurar); throw err; }   // r2 #7: o corte nao vaza
  }
  function montarTween(f, els, alvos, gatilho, registro, doc) {
    var gsap = raiz.gsap;
    var vars = varsDoTween(f);
    var m = f.motor;
    if (m.tipo === 'carga' && m.atraso !== undefined) vars.delay = m.atraso;
    if (m.tipo === 'tempo') { vars.repeat = f.repetir !== undefined ? f.repetir : -1; vars.yoyo = Boolean(f.vaiVolta); }
    else { if (f.repetir !== undefined) vars.repeat = f.repetir; if (f.vaiVolta) vars.yoyo = true; }
    if (m.tipo === 'rolagem') vars.scrollTrigger = gatilhoDoMotor(m, gatilho, els[0], doc || raiz.document);
    if (m.tipo === 'hover') vars.paused = true;
    registro.animacao = criarTween(gsap, f, alvos, vars);
    if (m.tipo === 'hover') {
      var entra = function () { registro.animacao.play(); }; var sai = function () { registro.animacao.reverse(); };
      (gatilho ? [gatilho] : els).forEach(function (gat) {   // todos os alvos do grupo, nao so o 1o
        gat.addEventListener('mouseenter', entra); gat.addEventListener('mouseleave', sai);
        registro.ouvintes.push([gat, 'mouseenter', entra], [gat, 'mouseleave', sai]);
      });
    }
    estado.montadas[f.id] = registro;
  }

  // gatilho de rolagem do motor (ficha avulsa e linha usam o mesmo)
  function gatilhoDoMotor(m, gatilho, primeiro, doc) {
    var st = { trigger: gatilho || primeiro, start: (m.inicio !== undefined ? m.inicio : 'top 80%'), end: (m.fim !== undefined ? m.fim : 'bottom 20%'), scrub: m.arrasto === true ? true : (ehNum(m.arrasto) ? m.arrasto : false), toggleActions: m.acoes || 'play none none none' };
    if (m.fixar === true) st.pin = true;
    else if (ehAlvo(m.fixar)) { var p = doc.getElementById(m.fixar.slice(1)); if (!p) throw new Error('elemento a fixar ausente: ' + m.fixar); st.pin = p; }
    if (st.pin && m.espacoReservado) st.pinSpacing = false;
    if (m.conteiner !== undefined) {
      var c = estado.linhas[m.conteiner];
      if (!c) throw new Error('conteiner ausente: ' + m.conteiner);
      st.containerAnimation = c.tl;
    }
    return st;
  }

  function cortarAlvos(f, els, registro) {
    if (!f.dividir) return els;
    var partes = [];
    els.forEach(function (el) { var p = cortar(el, f.dividir); if (p) { partes = partes.concat(p); registro.cortados.push(el); } else partes.push(el); });
    return partes;
  }
  // vars de UM tween (sem o motor). COPIAS (revisao Claude): o GSAP escreve nos objetos que
  // recebe (parent, ease...) e a ficha ficaria circular — salvar o programa a partir de fichas() quebrava.
  function varsDoTween(f) {
    var vars = {};
    if (Array.isArray(f.quadros)) vars.keyframes = copia(f.quadros); else if (ehObj(f.para)) Object.keys(f.para).forEach(function (k) { vars[k] = f.para[k]; });
    if (f.duracao !== undefined) vars.duration = f.duracao;
    if (f.curva !== undefined) vars.ease = f.curva;
    if (f.atraso !== undefined) vars.delay = f.atraso;
    if (f.imediato !== undefined) vars.immediateRender = f.imediato;
    if (f.atrasoRepeticao !== undefined) vars.repeatDelay = f.atrasoRepeticao;
    if (ehNum(f.intervalo)) vars.stagger = f.intervalo;
    else if (ehObj(f.intervalo)) { vars.stagger = {}; if (ehNum(f.intervalo.cada)) vars.stagger.each = f.intervalo.cada; else vars.stagger.amount = f.intervalo.total; if (f.intervalo.de) vars.stagger.from = f.intervalo.de; }
    return vars;
  }
  // de+para = fromTo; so de = from (anima DO estado dado ATE o atual); senao to
  function criarTween(alvoDoGsap, f, alvos, vars, pos) {
    var a = pos === undefined ? [] : [pos];
    if (ehObj(f.de) && !vars.keyframes && ehObj(f.para)) return alvoDoGsap.fromTo.apply(alvoDoGsap, [alvos, copia(f.de), vars].concat(a));
    if (ehObj(f.de) && !vars.keyframes) return alvoDoGsap.from.apply(alvoDoGsap, [alvos, Object.assign(copia(f.de), vars)].concat(a));
    return alvoDoGsap.to.apply(alvoDoGsap, [alvos, vars].concat(a));
  }

  // LINHA DE TEMPO: as fichas de uma `linha` viram UM gsap.timeline com o motor delas (o mesmo
  // para todas, validado); cada ficha entra na sua `posicao`. Editar uma remonta a linha inteira.
  function montarLinha(nome, fs, doc) {
    var gsap = raiz.gsap; var m = fs[0].motor;
    var gatilho = null;
    if (m.gatilho) { gatilho = doc.getElementById(m.gatilho.slice(1)); if (!gatilho) { fs.forEach(function (f) { estado.erros.push({ id: f.id, erros: ['gatilho ausente: ' + m.gatilho] }); }); return; } }
    var itens = [];
    fs.forEach(function (f) {
      var ach = elementosDe(f, doc);
      if (ach.faltam.length) { estado.erros.push({ id: f.id, erros: ['alvo ausente: ' + ach.faltam.join(', ')] }); return; }
      ach.els.forEach(function (el) { if (!estado.originais.has(el)) estado.originais.set(el, el.getAttribute('style')); });
      var registro = { ficha: f, els: ach.els, cortados: [], animacao: null, ouvintes: [], gatilhoST: null, linha: nome };
      itens.push({ f: f, alvos: cortarAlvos(f, ach.els, registro), registro: registro });
    });
    if (!itens.length) return;
    // TRANSACIONAL (Astra r1 #4): se a linha falha depois de cortar os textos (timeline(), ouvintes),
    // nada fica montado pela metade — a linha parcial e desfeita e os cortes voltam
    var tl = null; var reg = null;
    try { montarLinhaCorpo(); }
    catch (err) {
      if (reg) reg.ouvintes.forEach(function (o) { o[0].removeEventListener(o[1], o[2]); });
      if (tl) { try { if (typeof tl.revert === 'function') tl.revert(); else tl.kill(); } catch (e2) { /* segue limpando */ } }
      itens.forEach(function (it) { if (estado.montadas[it.f.id] === it.registro) delete estado.montadas[it.f.id]; it.registro.cortados.forEach(restaurar); it.registro.cortados = []; });
      delete estado.linhas[nome];
      throw err;
    }
    function montarLinhaCorpo() {
    var tv = {};
    if (m.tipo === 'carga' && m.atraso !== undefined) tv.delay = m.atraso;
    if (m.tipo === 'tempo') { tv.repeat = -1; if (m.vaiVolta) tv.yoyo = true; if (ehNum(m.atrasoRepeticao)) tv.repeatDelay = m.atrasoRepeticao; }
    if (m.tipo === 'hover') tv.paused = true;
    if (m.tipo === 'rolagem') tv.scrollTrigger = gatilhoDoMotor(m, gatilho, itens[0].registro.els[0], doc);
    tl = gsap.timeline(tv);
    reg = { nome: nome, tl: tl, ouvintes: [], membros: [] };
    itens.forEach(function (it) {
      // repeticao/vai-e-volta da FOLHA dentro da linha (um letreiro que repete dentro de uma linha
      // que nao repete); a linha inteira repete pelo motor `tempo`
      var vt = varsDoTween(it.f); if (it.f.repetir !== undefined) vt.repeat = it.f.repetir; if (it.f.vaiVolta) vt.yoyo = true;
      try {
        if (Array.isArray(it.f.porParte)) {
          // uma animacao por PARTE, cada uma no seu instante e com a sua repeticao; o GRUPO numa linha
          // aninhada, que carrega a repeticao do conjunto (Astra: copiar a repeticao do grupo para cada
          // parte trocava a ordem do vai-e-volta)
          var base = Object.assign({}, vt); delete base.stagger; delete base.duration; delete base.repeat; delete base.yoyo; delete base.repeatDelay;
          var grupo = raiz.gsap.timeline({ repeat: it.f.repetir || 0, yoyo: Boolean(it.f.vaiVolta), repeatDelay: it.f.atrasoRepeticao || 0 });
          it.f.porParte.forEach(function (q) {
            var alvo = it.alvos[q.i]; if (!alvo) return;
            var v1 = Object.assign({}, base, copia(q.para), { duration: q.duracao !== undefined ? q.duracao : (it.f.duracao !== undefined ? it.f.duracao : 0.5) });
            if (q.repetir !== undefined) v1.repeat = q.repetir; if (q.vaiVolta) v1.yoyo = true; if (q.atrasoRepeticao !== undefined) v1.repeatDelay = q.atrasoRepeticao;
            if (ehObj(q.de)) grupo.fromTo(alvo, copia(q.de), v1, q.atraso || 0); else grupo.to(alvo, v1, q.atraso || 0);
          });
          tl.add(grupo, it.f.posicao || 0);
        } else criarTween(tl, it.f, it.alvos, vt, it.f.posicao || 0);
      }
      catch (err) { it.registro.cortados.forEach(restaurar); it.registro.cortados = []; estado.erros.push({ id: it.f.id, erros: ['falha ao montar: ' + (err && err.message)] }); return; }
      estado.montadas[it.f.id] = it.registro; reg.membros.push(it.f.id);
    });
    if (m.tipo === 'hover') {
      var entra = function () { tl.play(); }; var sai = function () { tl.reverse(); };
      (gatilho ? [gatilho] : itens[0].registro.els).forEach(function (g) { g.addEventListener('mouseenter', entra); g.addEventListener('mouseleave', sai); reg.ouvintes.push([g, 'mouseenter', entra], [g, 'mouseleave', sai]); });
    }
    estado.linhas[nome] = reg;
    }
  }
  function ordemPorConteiner(ordem, grupos) {
    var feitas = {}; var out = [];
    var por = function (nome, pilha) {
      if (feitas[nome] || pilha[nome]) return; pilha[nome] = 1;
      var c = grupos[nome] && grupos[nome][0].motor.conteiner; if (c !== undefined && grupos[c]) por(c, pilha);
      feitas[nome] = 1; out.push(nome);
    };
    ordem.forEach(function (n) { por(n, {}); });
    return out;
  }
  // quem depende (conteiner) das linhas dadas, em qualquer profundidade: linhas E fichas avulsas
  // (Astra: a avulsa ficava presa a linha conteiner velha depois de editar a conteiner)
  function dependentesDe(nomes, lista) {
    var fichas = lista || (estado.programa && estado.programa.fichas) || []; var out = nomes.slice(); var avulsas = []; var mudou = true;
    while (mudou) {
      mudou = false;
      fichas.forEach(function (f) {
        if (!f || !f.motor || out.indexOf(f.motor.conteiner) < 0) return;
        if (f.linha !== undefined) { if (out.indexOf(f.linha) < 0) { out.push(f.linha); mudou = true; } }
        else if (avulsas.indexOf(f.id) < 0) avulsas.push(f.id);
      });
    }
    return { linhas: out, avulsas: avulsas };
  }
  function desmontarLinha(nome) {
    var reg = estado.linhas[nome]; if (!reg) return;
    reg.ouvintes.forEach(function (o) { o[0].removeEventListener(o[1], o[2]); });
    if (typeof reg.tl.revert === 'function') reg.tl.revert(); else reg.tl.kill();
    reg.membros.forEach(function (id) { var r = estado.montadas[id]; if (r) r.cortados.forEach(restaurar); delete estado.montadas[id]; });
    delete estado.linhas[nome];
  }
  function remontarLinha(nome, doc) {
    desmontarLinha(nome);
    var v = validar({ versao: 0, fichas: (estado.programa && estado.programa.fichas) || [] });
    var fs = v.fichas.filter(function (f) { return f.linha === nome; });
    if (fs.length) montarLinha(nome, fs, doc);
  }

  function desmontarFicha(id) {
    var r = estado.montadas[id]; if (!r) return;
    if (r.linha !== undefined) { desmontarLinha(r.linha); return; }
    r.ouvintes.forEach(function (o) { o[0].removeEventListener(o[1], o[2]); });
    if (r.gatilhoST) r.gatilhoST.kill();
    if (r.animacao) {
      // revert() devolve SO o que esta animacao escreveu; estilos de outras fichas no mesmo
      // elemento ficam (revisao Claude: o snapshot por ficha apagava os da vizinha).
      if (typeof r.animacao.revert === 'function') r.animacao.revert(); else if (typeof r.animacao.destroy === 'function') r.animacao.destroy(); else if (r.animacao.kill) r.animacao.kill();
    }
    r.cortados.forEach(restaurar);   // so o que ESTA ficha cortou
    if (r.limpar) r.limpar();        // sequencia: o desenho no canvas e desta ficha
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
    var grupos = {}; var ordem = []; var avulsasDependentes = [];
    v.fichas.forEach(function (f) {
      if (f.linha !== undefined) { if (!grupos[f.linha]) { grupos[f.linha] = []; ordem.push(f.linha); } grupos[f.linha].push(f); return; }
      if (f.motor.conteiner !== undefined) { avulsasDependentes.push(f); return; }
      try { montarFicha(f, doc); } catch (err) { estado.erros.push({ id: f.id, erros: ['falha ao montar: ' + (err && err.message)] }); }
    });
    // a linha que conta o deslizamento de OUTRA (conteiner) monta depois dela
    ordem = ordemPorConteiner(ordem, grupos);
    ordem.forEach(function (nome) {
      try { montarLinha(nome, grupos[nome], doc); } catch (err) { desmontarLinha(nome); grupos[nome].forEach(function (f) { estado.erros.push({ id: f.id, erros: ['falha ao montar a linha: ' + (err && err.message)] }); }); }
    });
    avulsasDependentes.forEach(function (f) { try { montarFicha(f, doc); } catch (err) { estado.erros.push({ id: f.id, erros: ['falha ao montar: ' + (err && err.message)] }); } });
    try { if (raiz.ScrollTrigger) raiz.ScrollTrigger.refresh(); } catch (err) { estado.erros.push({ id: null, erros: ['refresh falhou: ' + (err && err.message)] }); }
    vigiarLayout(doc);
    return relatorio();
  }

  // O LAYOUT ainda muda depois de montar (imagens, Lottie, fontes tardias): um gatilho RELATIVO
  // ('top bottom', 'clamp(top+=70% bottom)') calculado cedo fica com a posicao velha — medido no
  // farmminerals, o do rodape comecava em 17711 px em vez de 18842 (o site), e so a ficha com inicio
  // em px absolutos escapava. O ScrollTrigger so se recalcula sozinho em load/resize da JANELA;
  // aqui se vigia o tamanho do DOCUMENTO e se recalcula (com espera) quando ele muda.
  function vigiarLayout(doc) {
    pararVigia();
    if (!raiz.ScrollTrigger || typeof raiz.ResizeObserver !== 'function') return;
    var alvo = doc.documentElement; var tempo = null; var ultimo = alvo.scrollHeight + 'x' + alvo.scrollWidth;
    var recalcular = function () { tempo = null; try { raiz.ScrollTrigger.refresh(); } catch (e) { /* proxima mudanca tenta de novo */ } };
    var obs = new raiz.ResizeObserver(function () {
      var agora = alvo.scrollHeight + 'x' + alvo.scrollWidth; if (agora === ultimo) return; ultimo = agora;
      if (tempo) raiz.clearTimeout(tempo); tempo = raiz.setTimeout(recalcular, 150);
    });
    obs.observe(doc.body || alvo);
    var naCarga = function () { recalcular(); };
    if (doc.readyState !== 'complete' && raiz.addEventListener) raiz.addEventListener('load', naCarga, { once: true });
    estado.vigia = { obs: obs, parar: function () { obs.disconnect(); if (tempo) raiz.clearTimeout(tempo); if (raiz.removeEventListener) raiz.removeEventListener('load', naCarga); } };
  }
  function pararVigia() { if (estado.vigia) { estado.vigia.parar(); estado.vigia = null; } }

  function desmontar() {
    pararVigia();
    Object.keys(estado.montadas).forEach(desmontarFicha);
    Object.keys(estado.linhas).forEach(desmontarLinha);   // linha cujas fichas todas falharam
    // estilo inline do autor, como estava ANTES de qualquer ficha
    estado.originais.forEach(function (s, el) { if (s === null) el.removeAttribute('style'); else el.setAttribute('style', s); });
    estado.originais = new Map();
    if (estado.lenis) { raiz.gsap.ticker.remove(estado.tique); raiz.gsap.ticker.lagSmoothing(500, 33); estado.lenis.destroy(); estado.lenis = null; }
  }

  // Painel: muda campos de UMA ficha e remonta só ela. Campos aninhados (motor) são mesclados.
  // Ficha de LINHA: o motor e da linha inteira — editar o motor de um membro vale para todos, e a
  // edicao e recusada se deixar QUALQUER membro da linha invalido (revisao Claude #8: antes o outro
  // membro saia da linha em silencio).
  function aplicar(id, campos, doc) {
    doc = doc || raiz.document;
    var fichas = (estado.programa && estado.programa.fichas) || [];
    var i = fichas.findIndex(function (f) { return f && f.id === id; });
    if (i < 0) return { ok: false, erro: 'ficha inexistente: ' + id };
    var antiga = fichas[i];
    var nova = Object.assign({}, antiga, campos);
    if (campos && ehObj(campos.motor)) nova.motor = Object.assign({}, antiga.motor, campos.motor);
    var outras = {}; fichas.forEach(function (f, k) { if (k !== i && f) outras[f.id] = 1; });
    var e = validarFicha(nova, outras);
    var mudaMotorDaLinha = nova.linha !== undefined && campos && ehObj(campos.motor);
    var novas = fichas.map(function (f, k) {
      if (k === i) return nova;
      if (mudaMotorDaLinha && f && f.linha === nova.linha) return Object.assign({}, f, { motor: copia(nova.motor) });
      return f;
    });
    var linhasAfetadas = [antiga.linha, nova.linha].filter(function (x) { return x !== undefined; });
    // o COMPONENTE inteiro remonta: quem conta o deslizamento das linhas afetadas (linhas e avulsas),
    // desmontado antes delas e montado depois — senao ficava preso a linha velha
    var dep = dependentesDe(linhasAfetadas.filter(function (x, k, l) { return l.indexOf(x) === k; }), fichas.concat([nova]));
    linhasAfetadas = dep.linhas; var avulsasDep = dep.avulsas.filter(function (x) { return x !== id; });
    if (!e.length) {
      // recusa todo erro que a EDICAO cria, em QUALQUER ficha (revisao Claude r2 #2: mudar o corte de
      // A culpava B, que ficava de fora); ficha que ja era invalida antes nao bloqueia
      var antes = {}; validar({ versao: 0, fichas: fichas }).erros.forEach(function (x) { x.erros.forEach(function (m) { antes[x.id + '|' + m] = 1; }); });
      validar({ versao: 0, fichas: novas }).erros.forEach(function (x) { x.erros.forEach(function (m) { if (x.id === id || !antes[x.id + '|' + m]) e.push(x.id === id ? m : x.id + ': ' + m); }); });
    }
    if (e.length) return { ok: false, erro: e.join('; ') };
    var antigas = fichas.slice();
    var tira = function () { avulsasDep.forEach(desmontarFicha); desmontarFicha(id); linhasAfetadas.slice().reverse().forEach(desmontarLinha); };
    var poe = function (lista) {
      lista.forEach(function (f, k) { fichas[k] = f; });
      var f = fichas[i];
      linhasAfetadas.forEach(function (nome) { remontarLinha(nome, doc); });
      if (f.linha === undefined) montarFicha(f, doc);
      // dependente que nao remonta derruba a edicao inteira (volta tudo), nunca "ok" pela metade
      avulsasDep.forEach(function (aid) { var a = fichas.find(function (x) { return x && x.id === aid; }); if (a) { montarFicha(a, doc); if (!estado.montadas[aid]) throw new Error('dependente nao montou: ' + aid); } });
    };
    tira();
    // Seguro contra excecao (revisao Claude): se a nova nao monta, a antiga volta.
    try {
      poe(novas);
      if (!estado.montadas[id]) throw new Error('nao montou');
    } catch (err) {
      tira();
      try { poe(antigas); } catch (e2) { /* fica reportada */ }
      refazerErros();
      return { ok: false, erro: 'falha ao montar: ' + (err && err.message) };
    }
    try { if (raiz.ScrollTrigger) raiz.ScrollTrigger.refresh(); } catch (e3) { /* refresh nao desfaz a edicao */ }
    refazerErros();
    return { ok: true };
  }

  // relatorio coerente com o que ficou montado (r2 #8, r3 #6): erros de validacao do programa atual +
  // erros de montagem SO de fichas validas que nao montaram, sem repetir (id + mensagem)
  function refazerErros() {
    var fichas = (estado.programa && estado.programa.fichas) || [];
    var v = validar({ versao: 0, fichas: fichas });
    var validas = {}; v.fichas.forEach(function (f) { validas[f.id] = 1; });
    var ruins = {}; v.erros.forEach(function (x) { ruins[x.id] = 1; });
    var visto = {}; var out = [];
    v.erros.concat(estado.erros.filter(function (x) { return x.id === null || (validas[x.id] && !ruins[x.id] && estado.montadas[x.id] === undefined); })).forEach(function (x) {
      var k = x.id + '|' + x.erros.join(';'); if (!visto[k]) { visto[k] = 1; out.push(x); }
    });
    estado.erros = out;
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
