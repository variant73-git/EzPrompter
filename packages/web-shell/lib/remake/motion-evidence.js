/**
 * O MOVIMENTO MEDIDO — a peça que faltava para reconstruir sem adivinhar.
 *
 * A reconstrução por visão olha fotos PARADAS: ela vê um marquee borrado e
 * inventa o resto, e tudo que só acontece na rolagem ou no hover simplesmente
 * não está na imagem. O experimento de 2026-08-20 mostrou o teto disso — 13/13
 * seções certas, copy verbatim, e a identidade visual INVENTADA.
 *
 * Aqui o movimento deixa de ser inferência: a página viva é interrogada, e o
 * que ela responde (alvo, propriedades, duração, curva, gatilho de rolagem)
 * vira instrução escrita para quem reconstrói.
 *
 * ⚠️ ISTO NÃO É UM CLONE DO GSAP. É evidência: nomes de propriedade, números e
 * seletores. Quem reconstrói decide COMO reproduzir (CSS, WAAPI, ou a
 * biblioteca que for) — o que não pode é inventar O QUE se move.
 */

/**
 * Roda DENTRO da página viva.
 *
 * ⚠️ TUDO vive dentro da função devolvida: ela atravessa para o navegador como
 * TEXTO, então qualquer valor do escopo de fora chega como referência morta.
 * A primeira versão fechava sobre uma lista aqui em cima e explodiu com
 * `CONFIG_VARS is not defined` no primeiro site real.
 */
export function coletorNaPagina() {
  return () => {
    // Vocabulário de CONFIGURAÇÃO do GSAP. Sem ele, o texto sai dizendo que a
    // página anima `lazy`, `force3D` e `parent` — e o reconstrutor tentaria
    // reproduzir campos internos da biblioteca em vez do movimento.
    const CONFIG = new Set(['duration', 'delay', 'ease', 'repeat', 'yoyo', 'stagger', 'scrollTrigger',
      'onComplete', 'onUpdate', 'onStart', 'onRepeat', 'onReverseComplete', 'onInterrupt', 'paused',
      'id', 'data', 'immediateRender', 'repeatDelay', 'overwrite', 'runBackwards', 'startAt',
      'keyframes', 'lazy', 'force3D', 'parent', 'inherit', 'callbackScope', 'autoRound',
      'smoothOrigin', 'reversed', 'repeatRefresh', 'defaults', 'onCompleteParams',
      'onStartParams', 'onUpdateParams', 'onRepeatParams', 'onReverseCompleteParams',
      'onInterruptParams', 'yoyoEase', 'stringFilter', 'ease0', 'delayedCall']);
    // ⚠️ MITIGACAO, NAO SOLUCAO — e' importante dizer qual das duas isto e'.
    //
    // Nome de classe, id e `start`/`end` sao escritos pelo dono do site, e o
    // motor transforma isso em HTML executavel. Aqui o alfabeto e' restrito ao
    // que um seletor CSS e um valor de tempo precisam, o que derruba carga
    // exotica e corta tamanho por campo. O que NAO derruba e' uma frase feita
    // so' de palavras comuns num nome de classe — nenhuma serializacao derruba,
    // porque o dado legitimamente contem palavras. Contra isso vale o bloco da
    // diretiva que declara a evidencia como DADO, e isso tambem e' mitigacao.
    // RESIDUAL NOMEADO: injecao semantica por nome de classe segue possivel, e
    // os blocos de fonte/cor/elevacao do reconstrutor legado ja' interpolavam
    // texto do site antes disto e continuam iguais.
    const limpo = (v, max) => String(v == null ? '' : v)
      .replace(/[^\w .#:%+\-()>,=\[\]"'*^$~|/]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max || 80);
    // Valor autoral: e' O QUE o site pediu. Sem ele o modelo sabe QUE algo se
    // move e inventa QUANTO — foi o furo apontado. Funcao/objeto viram nome,
    // nunca codigo-fonte (String(fn) despejaria o script do site no prompt).
    const valor = (v) => {
      const t = typeof v;
      if (t === 'number') return Number.isFinite(v) ? v : null;
      if (t === 'string') return limpo(v, 40);
      if (t === 'boolean') return v;
      if (t === 'function') return '(dynamic)';
      if (v && t === 'object') return Array.isArray(v) ? '(steps)' : '(object)';
      return null;
    };
    const seletor = (el) => {
      if (!el || el.nodeType !== 1) return null;
      if (el.id) return limpo('#' + el.id, 60);
      const cls = String(el.className || '').trim().split(/\s+/).filter(Boolean).slice(0, 2)
        .map((c) => limpo(c, 24));
      const base = el.tagName.toLowerCase() + (cls.length ? '.' + cls.join('.') : '');
      const irmaos = el.parentElement ? [...el.parentElement.children].filter((n) => n.tagName === el.tagName) : [];
      return irmaos.length > 1 ? base + ':nth-of-type(' + (irmaos.indexOf(el) + 1) + ')' : base;
    };

    const gsap = window.gsap;
    const animacoes = [];
    if (gsap && gsap.globalTimeline) {
      let filhos = [];
      try { filhos = gsap.globalTimeline.getChildren(true, true, false); } catch { filhos = []; }
      for (const t of filhos.slice(0, 200)) {
        let alvos = [];
        try { alvos = (t.targets ? t.targets() : []).filter((x) => x && x.nodeType === 1); } catch { alvos = []; }
        const vars = t.vars || {};
        const props = Object.keys(vars).filter((k) => !CONFIG.has(k) && k.charAt(0) !== '_');
        if (!props.length && !vars.keyframes) continue;
        // Alvo que não é elemento não descreve movimento de página: é proxy de
        // scroll suave, contador interno, objeto de terceiro. Sem elemento não
        // há o que o reconstrutor possa reproduzir.
        if (!alvos.length) continue;
        let dur = 0;
        try { dur = Number(t.duration && t.duration()) || 0; } catch { dur = 0; }
        animacoes.push({
          // Seletores REPETIDOS são o mesmo alvo várias vezes (stagger sobre
          // irmãos idênticos): repetir na instrução só gasta atenção.
          alvos: [...new Set(alvos.map(seletor).filter(Boolean))].slice(0, 6),
          quantosAlvos: alvos.length,
          propriedades: props.slice(0, 12),
          // O VALOR de cada propriedade, medido do que o site declarou.
          valores: props.slice(0, 12).reduce((acc, k) => { acc[k] = valor(vars[k]); return acc; }, {}),
          // Quanto o escalonamento espaca os alvos: sem isto o modelo escolhe.
          escalonamentoS: typeof vars.stagger === 'number' ? vars.stagger
            : (vars.stagger && typeof vars.stagger === 'object' ? valor(vars.stagger.each ?? vars.stagger.amount) : null),
          duracaoMs: Math.round(dur * 1000),
          atrasoMs: Math.round((Number(vars.delay) || 0) * 1000),
          curva: typeof vars.ease === 'string' ? vars.ease : (vars.ease ? 'funcao' : null),
          repete: Number(vars.repeat) || 0,
          vaiEVolta: vars.yoyo === true,
          escalonado: vars.stagger != null,
          porRolagem: !!vars.scrollTrigger,
          temEtapas: !!vars.keyframes,
        });
      }
    }

    const rolagem = [];
    const ST = window.ScrollTrigger || (gsap && gsap.ScrollTrigger);
    if (ST && ST.getAll) {
      let todos = [];
      try { todos = ST.getAll(); } catch { todos = []; }
      for (const st of todos.slice(0, 120)) {
        const v = st.vars || {};
        rolagem.push({
          gatilho: seletor(st.trigger),
          // `start`/`end` aceitam FUNCAO: `String(fn)` despejaria o codigo do
          // site dentro do prompt. So' texto e numero atravessam.
          inicio: typeof v.start === 'function' ? '(dynamic)' : limpo(v.start, 48),
          fim: typeof v.end === 'function' ? '(dynamic)' : limpo(v.end, 48),
          preso: !!v.pin,
          acompanha: !!v.scrub,
        });
      }
    }

    // Animação CSS conta igual: nem todo site usa biblioteca.
    const css = [];
    const todosEls = [...document.querySelectorAll('*')].slice(0, 4000);
    for (const el of todosEls) {
      const cs = getComputedStyle(el);
      if (cs.animationName && cs.animationName !== 'none') {
        css.push({ alvo: seletor(el), nome: limpo(cs.animationName, 48), duracao: limpo(cs.animationDuration, 24),
          repete: limpo(cs.animationIterationCount, 16), curva: limpo(cs.animationTimingFunction, 32) });
        if (css.length >= 60) break;
      }
    }

    return { animacoes, rolagem, css, motores: { gsap: !!gsap, scrollTrigger: !!ST, lenis: !!window.lenis } };
  };
}

/** Vira instrução escrita. Sem evidência, DIZ que não há — nunca finge. */
export function descreverMovimento(evidencia) {
  if (!evidencia) return 'MOTION EVIDENCE: none was measured. Do not invent motion — build the page still.';
  const { animacoes = [], rolagem = [], css = [], motores = {} } = evidencia;
  if (!animacoes.length && !rolagem.length && !css.length) {
    return 'MOTION EVIDENCE: the live page was interrogated and NOTHING animates. Build the page still; do not add motion.';
  }
  const presentes = Object.entries(motores).filter(([, v]) => v).map(([k]) => k);
  const linhas = [
    'MOTION EVIDENCE — measured on the live page, not inferred from stills.',
    'Reproduce WHAT moves; you choose HOW (CSS, WAAPI, or a library).',
    'Each property reads `name -> value`, where the value is what the page ASKED FOR.',
    'A value of UNKNOWN was NOT measured: animate that property only if the screenshots make the change obvious, and never guess a magnitude.',
    `engines present: ${presentes.join(', ') || 'none'}`,
  ];
  if (animacoes.length) {
    linhas.push('', `TIMED ANIMATIONS (${animacoes.length}${animacoes.length > 40 ? `, showing the first 40 — ${animacoes.length - 40} MORE were measured and are not listed` : ''}):`);
    for (const a of animacoes.slice(0, 40)) {
      const alvo = a.alvos.length ? a.alvos.join(', ') : `${a.quantosAlvos} element(s)`;
      // Propriedade COM valor: "y -> 40". Sem valor medido, sai UNKNOWN — e a
      // instrucao la' embaixo proibe reproduzir o que esta' UNKNOWN, em vez de
      // deixar o modelo escolher um numero (achado do Sol).
      const props = (a.propriedades || []).map((p) => {
        const v = a.valores ? a.valores[p] : undefined;
        return v === undefined || v === null ? `${p} -> UNKNOWN` : `${p} -> ${v}`;
      });
      const partes = [`props: ${props.join(', ') || 'keyframes'}`, `${a.duracaoMs}ms`];
      if (a.atrasoMs) partes.push(`delay ${a.atrasoMs}ms`);
      if (a.curva) partes.push(`ease ${a.curva}`);
      if (a.repete) partes.push(a.repete < 0 ? 'loops forever' : `repeats ${a.repete}x`);
      if (a.vaiEVolta) partes.push('yoyo');
      if (a.escalonado) partes.push(a.escalonamentoS != null ? `staggered ${a.escalonamentoS}s apart` : 'staggered across targets');
      if (a.porRolagem) partes.push('driven by scroll');
      if (a.temEtapas) partes.push('multi-step');
      linhas.push(`- ${alvo} — ${partes.join(' · ')}`);
    }
  }
  if (rolagem.length) {
    linhas.push('', `SCROLL TRIGGERS (${rolagem.length}${rolagem.length > 25 ? `, showing the first 25 — ${rolagem.length - 25} MORE were measured and are not listed` : ''}):`);
    for (const s of rolagem.slice(0, 25)) {
      const partes = [`start ${s.inicio || '?'}`, `end ${s.fim || '?'}`];
      if (s.preso) partes.push('PINS the section while scrolling');
      if (s.acompanha) partes.push('scrubbed: progress follows scroll position');
      linhas.push(`- ${s.gatilho || '(unnamed)'} — ${partes.join(' · ')}`);
    }
  }
  if (css.length) {
    linhas.push('', `CSS ANIMATIONS (${css.length}${css.length > 20 ? `, showing the first 20 — ${css.length - 20} MORE were measured and are not listed` : ''}):`);
    for (const c of css.slice(0, 20)) linhas.push(`- ${c.alvo} — ${c.nome} · ${c.duracao} · ${c.repete} · ${c.curva}`);
  }
  return linhas.join('\n');
}
