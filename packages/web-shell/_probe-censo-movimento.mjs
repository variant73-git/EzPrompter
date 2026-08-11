// CENSO DE MOVIMENTO — o que um site real de fato contém.
//
// Pergunta que ele responde: se fôssemos RE-EXPRESSAR o movimento de um site
// num formato nosso em vez de herdar o motor dele, com o que teríamos que lidar?
//
// ⚠️ Este probe NÃO mede editabilidade. O inventário do bridge foi construído
// para EDITAR, e por isso é enviesado pelo que sabemos escrever de volta.
// Re-expressar precisa só de LER + reproduzir. Aqui a leitura é feita direto do
// motor, sem passar pelo nosso inventário, justamente para não herdar esse viés.
//
// NÃO classifica, NÃO conclui. Conta e descreve. A interpretação é separada.
//
// Uso: node _probe-censo-movimento.mjs <url>
import { chromium } from 'playwright-core';

const url = process.argv[2];
if (!url) {
  console.error('uso: node _probe-censo-movimento.mjs <url>');
  process.exit(2);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

// ⚠️ BURACO QUE O ADILSON EXPÔS: contar callbacks de GSAP/ScrollTrigger só mede
// a porta no mundo GSAP. Nos sites de CSS/WAAPI o mecanismo de reação é OUTRO —
// tipicamente IntersectionObserver ligando classes. Sem medir isso, "zero
// ScrollTriggers" seria lido como "porta fechada" quando pode ser porta aberta
// por outro mecanismo. O contador de MUDANÇA DE CLASSE é agnóstico de mecanismo:
// é a assinatura clássica do "revelar ao entrar na tela", qualquer que seja a
// biblioteca. Mudança de ESTILO não serve — o desenho da animação ligada à
// rolagem também mexe em estilo, e é justamente o que se quer manter vivo.
await page.addInitScript(() => {
  window.__reacoes = { ioCriados: 0, ioCallbacks: 0, classeMutacoes: 0, classeElementos: new Set(), contando: false };
  const IO = window.IntersectionObserver;
  if (IO) {
    window.IntersectionObserver = class extends IO {
      constructor(cb, opts) {
        window.__reacoes.ioCriados += 1;
        super((entradas, obs) => {
          if (window.__reacoes.contando) window.__reacoes.ioCallbacks += 1;
          return cb(entradas, obs);
        }, opts);
      }
    };
  }
  const ligaMutacoes = () => {
    try {
      new MutationObserver((muts) => {
        if (!window.__reacoes.contando) return;
        for (const m of muts) {
          window.__reacoes.classeMutacoes += 1;
          window.__reacoes.classeElementos.add(m.target);
        }
      }).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['class'] });
    } catch (_) {}
  };
  if (document.documentElement) ligaMutacoes();
  else document.addEventListener('DOMContentLoaded', ligaMutacoes);
});

await page.goto(url, { waitUntil: 'load', timeout: 60000 });
await page.waitForTimeout(2500);

// ⚠️ Muita animação só NASCE depois da rolagem (criada em lazy-init, em
// IntersectionObserver, ou por bibliotecas que só instalam ao entrar na tela).
// Censar sem rolar dá um PISO, não um total — e o piso pareceria "o site tem
// pouco movimento". Percorre-se a página inteira antes de contar.
const altura = await page.evaluate(() => document.body.scrollHeight);
// A contagem de reacao vale APENAS durante a rolagem: o que acontece na carga
// da pagina nao e resposta ao arrasto da regua e contaria como ruido.
await page.evaluate(() => { window.__reacoes.contando = true; });
for (let y = 0; y < altura; y += 700) {
  await page.evaluate((v) => window.scrollTo(0, v), y);
  await page.waitForTimeout(180);
}
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(1200);
const reacoes = await page.evaluate(() => ({
  ioCriados: window.__reacoes.ioCriados,
  ioCallbacksNaRolagem: window.__reacoes.ioCallbacks,
  classeMutacoesNaRolagem: window.__reacoes.classeMutacoes,
  classeElementosDistintos: window.__reacoes.classeElementos.size,
}));

const censo = await page.evaluate(() => {
  const g = window.gsap;
  const ST = window.ScrollTrigger || (g && g.plugins && g.plugins.ScrollTrigger);

  const tipoDeValor = (v) => {
    if (typeof v === 'function') return 'funcao';
    if (Array.isArray(v)) return 'array';
    if (v && typeof v === 'object') return 'objeto';
    if (typeof v === 'string' && /^[+-]=/.test(v)) return 'relativo';
    if (typeof v === 'string' && /random\(|var\(|calc\(/.test(v)) return 'dinamico';
    return typeof v;
  };

  const CONFIG = new Set([
    'duration', 'delay', 'ease', 'repeat', 'yoyo', 'repeatDelay', 'repeatRefresh',
    'stagger', 'paused', 'immediateRender', 'overwrite', 'onComplete', 'onStart',
    'onUpdate', 'onRepeat', 'onReverseComplete', 'onInterrupt', 'callbackScope',
    'onCompleteParams', 'onStartParams', 'onUpdateParams', 'onRepeatParams',
    'scrollTrigger', 'id', 'data', 'inherit', 'keyframes', 'runBackwards',
    'startAt', 'lazy', 'reversed', 'defaults', 'smoothChildTiming', 'autoRemoveChildren',
    // ⚠️ Não são propriedades animadas: `parent` é a aresta estrutural que o
    // GSAP guarda em `vars`, `force3D` é config de renderização, e os `*Params`
    // pertencem aos callbacks. Deixá-los entrar inflava a contagem de
    // "propriedades distintas" e daria uma superfície maior do que a real.
    'parent', 'force3D', 'onInterruptParams', 'onReverseCompleteParams',
    'autoRound', 'transformOrigin', 'smoothOrigin', 'delay', 'stagger',
  ]);

  const animacoes = [];
  const vistos = new Set();
  function desce(no, profundidade) {
    if (!no || vistos.has(no)) return;
    vistos.add(no);
    const kids = typeof no.getChildren === 'function' ? no.getChildren(false, true, true) : [];
    const ehTimeline = typeof no.getChildren === 'function';
    const vars = no.vars || {};
    const props = Object.keys(vars).filter((k) => !CONFIG.has(k));
    const alvos = typeof no.targets === 'function' ? no.targets() : [];

    animacoes.push({
      tipo: ehTimeline ? 'timeline' : 'tween',
      profundidade,
      alvos: alvos.length,
      // Um alvo que não é elemento do DOM (objeto puro, proxy de valor) é outra
      // classe de problema para re-expressão.
      alvosNaoDom: alvos.filter((a) => !(a && a.nodeType === 1)).length,
      props,
      tiposDeValor: Object.fromEntries(props.map((p) => [p, tipoDeValor(vars[p])])),
      temFuncao: props.some((p) => typeof vars[p] === 'function'),
      temKeyframes: Boolean(vars.keyframes),
      formaKeyframes: Array.isArray(vars.keyframes) ? 'array' : vars.keyframes ? 'objeto' : null,
      temStagger: vars.stagger != null,
      formaStagger: vars.stagger == null ? null : typeof vars.stagger === 'object' ? 'objeto' : typeof vars.stagger,
      temCssWrapper: Boolean(vars.css),
      temStartAt: Boolean(vars.startAt),
      temScrollTrigger: Boolean(vars.scrollTrigger),
      ease: typeof vars.ease === 'function' ? 'funcao' : (vars.ease ?? null),
      repeat: vars.repeat ?? 0,
      duracao: typeof no.duration === 'function' ? no.duration() : null,
      callbacks: ['onStart', 'onUpdate', 'onComplete', 'onRepeat', 'onReverseComplete', 'onInterrupt']
        .filter((k) => typeof vars[k] === 'function'),
      filhos: kids.length,
    });
    kids.forEach((k) => desce(k, profundidade + 1));
  }
  if (g) desce(g.globalTimeline, 0);

  const gatilhos = (ST && typeof ST.getAll === 'function' ? ST.getAll() : []).map((st) => {
    const v = st.vars || {};
    return {
      scrub: v.scrub ?? false,
      formaScrub: typeof v.scrub,
      pin: Boolean(v.pin),
      toggleClass: Boolean(v.toggleClass),
      snap: v.snap != null,
      once: Boolean(v.once),
      toggleActions: v.toggleActions ?? null,
      temAnimacao: Boolean(st.animation),
      scrollerEhWindow: st.scroller === window || st.scroller === document.documentElement || st.scroller === document.body,
      callbacks: ['onEnter', 'onLeave', 'onEnterBack', 'onLeaveBack', 'onToggle', 'onUpdate', 'onRefresh', 'onSnapComplete', 'onScrubComplete']
        .filter((k) => typeof v[k] === 'function'),
      startAutoral: typeof v.start,
      endAutoral: typeof v.end,
    };
  });

  // Animações fora do GSAP: WAAPI, CSS, e as pistas dos motores que não
  // inventariamos de jeito nenhum.
  const waapi = (typeof document.getAnimations === 'function' ? document.getAnimations() : []).map((a) => ({
    classe: a.constructor && a.constructor.name,
    origem: a.effect && a.effect.target ? 'elemento' : 'sem alvo',
    nome: a.animationName || (a.effect && a.effect.getComputedTiming ? null : null),
  }));

  let regrasKeyframes = 0;
  let regrasTransition = 0;
  try {
    for (const folha of Array.from(document.styleSheets)) {
      let regras = [];
      try { regras = Array.from(folha.cssRules || []); } catch (_) { continue; }
      for (const r of regras) {
        if (r.type === 7 || (r.constructor && r.constructor.name === 'CSSKeyframesRule')) regrasKeyframes += 1;
        if (r.style && r.style.transition) regrasTransition += 1;
      }
    }
  } catch (_) {}

  // ⚠️ LIMITE CONHECIDO E NÃO CONTORNÁVEL POR AQUI: um GSAP empacotado dentro
  // do bundle do site não expõe `window.gsap`. Ausência aqui significa
  // "não alcançável pelo global", NUNCA "o site não usa GSAP". A pista abaixo
  // é fraca de propósito — serve para não deixar a ausência passar por fato.
  const pistaDeGsapEmpacotado = (() => {
    try {
      const marcas = Array.from(document.querySelectorAll('*'))
        .some((el) => el._gsap || (el.style && el.style.transform && /matrix|translate3d/.test(el.style.transform)));
      return { elementoComEstadoGsap: Array.from(document.querySelectorAll('*')).some((el) => el._gsap), transformInlineSuspeito: marcas };
    } catch (_) { return null; }
  })();

  return {
    pistaDeGsapEmpacotado,
    plugins: {
      gsap: Boolean(g),
      versaoGsap: g ? g.version : null,
      scrollTrigger: Boolean(ST),
      splitText: Boolean(window.SplitText || (g && g.plugins && g.plugins.SplitText)),
      registrados: g && g.plugins ? Object.keys(g.plugins) : [],
    },
    // Motores que NÃO temos como inventariar por leitura de estrutura.
    opacos: {
      canvas: document.querySelectorAll('canvas').length,
      video: document.querySelectorAll('video').length,
      lottie: Boolean(window.lottie || window.bodymovin) || document.querySelectorAll('[data-animation-type="lottie"],.w-lottie').length,
      lenis: Boolean(window.lenis || document.documentElement.classList.contains('lenis')),
      smoother: Boolean(window.ScrollSmoother || (g && g.plugins && g.plugins.ScrollSmoother)),
      three: Boolean(window.THREE),
    },
    animacoes,
    gatilhos,
    waapi,
    css: { regrasKeyframes, regrasTransition },
    dom: { elementos: document.querySelectorAll('*').length, altura: document.body.scrollHeight },
  };
});

await browser.close();

// --- resumo, sem classificar -----------------------------------------------
const a = censo.animacoes.filter((x) => x.tipo === 'tween');
const t = censo.animacoes.filter((x) => x.tipo === 'timeline');
const conta = (pred) => a.filter(pred).length;
const props = new Map();
a.forEach((x) => x.props.forEach((p) => props.set(p, (props.get(p) || 0) + 1)));

console.log(JSON.stringify({ resumo: {
  url,
  reacoes,
  pistaGsapEmpacotado: censo.pistaDeGsapEmpacotado,
  gsap: censo.plugins.versaoGsap,
  pluginsRegistrados: censo.plugins.registrados,
  opacos: censo.opacos,
  timelines: t.length,
  tweens: a.length,
  tweensComFuncaoEmVars: conta((x) => x.temFuncao),
  tweensComKeyframes: conta((x) => x.temKeyframes),
  tweensComStagger: conta((x) => x.temStagger),
  tweensComCssWrapper: conta((x) => x.temCssWrapper),
  tweensComStartAt: conta((x) => x.temStartAt),
  tweensComCallback: conta((x) => x.callbacks.length > 0),
  tweensComEaseFuncao: conta((x) => x.ease === 'funcao'),
  tweensComAlvoNaoDom: conta((x) => x.alvosNaoDom > 0),
  tweensMultiAlvo: conta((x) => x.alvos > 1),
  propriedadesDistintas: props.size,
  propriedadesMaisComuns: [...props.entries()].sort((x, y) => y[1] - x[1]).slice(0, 15),
  scrollTriggers: censo.gatilhos.length,
  stComScrub: censo.gatilhos.filter((g) => g.scrub !== false && g.scrub != null).length,
  stComPin: censo.gatilhos.filter((g) => g.pin).length,
  stComToggleClass: censo.gatilhos.filter((g) => g.toggleClass).length,
  stComSnap: censo.gatilhos.filter((g) => g.snap).length,
  stComOnce: censo.gatilhos.filter((g) => g.once).length,
  stComCallback: censo.gatilhos.filter((g) => g.callbacks.length > 0).length,
  stComStartFuncao: censo.gatilhos.filter((g) => g.startAutoral === 'function').length,
  stForaDoWindow: censo.gatilhos.filter((g) => !g.scrollerEhWindow).length,
  waapi: censo.waapi.length,
  css: censo.css,
  dom: censo.dom,
} }, null, 2));
