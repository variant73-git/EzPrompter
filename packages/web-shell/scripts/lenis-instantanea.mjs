// LENIS SEM SUAVIZACAO (roda NO NAVEGADOR, via addInitScript, antes do site). A gravacao precisa de rolagem
// EXATA por posicao — a suave interpolaria. Antes, a Lenis do site era trocada por uma de MENTIRA (so on/raf/
// scrollTo...): medido no bleibtgleich (2026-10-05), o codigo do site le `lenis.dimensions.naiveDimensions`,
// dava erro, a transicao de entrada (Barba) nunca terminava e a canonica saia com a altura da tela, sem rolar.
// Agora a Lenis VERDADEIRA fica inteira (toda a interface que o site espera) e so a suavizacao sai. So vale para a Lenis global (UMD/CDN); a empacotada no codigo do
// site nunca foi trocada.
export function lenisSemSuavizacao() {
  let real = null; let embrulho = null;
  const embrulhar = (R) => {
    if (typeof R !== 'function') return R;
    if (embrulho && embrulho.__uBase === R) return embrulho;
    // Astra: `lerp: 1` sozinho NAO e instantaneo — duration+easing tem prioridade sobre lerp, e o amortecimento por
    // quadro ainda existe; e o proprio site pode chamar `lenis.scrollTo()` animado. Entao: sem duration/easing,
    // roda nativa, e todo scrollTo da instancia vira `immediate`.
    class LenisSemSuavizacao extends R {
      constructor(opcoes) { const o = Object.assign({}, opcoes || {}, { lerp: 1, smoothWheel: false, syncTouch: false }); delete o.duration; delete o.easing; super(o); }
      scrollTo(alvo, opcoes) { return super.scrollTo(alvo, Object.assign({}, opcoes || {}, { immediate: true })); }
    }
    LenisSemSuavizacao.__uBase = R; embrulho = LenisSemSuavizacao; return embrulho;
  };
  Object.defineProperty(window, 'Lenis', { configurable: true, get: () => (real ? embrulhar(real) : undefined), set: (v) => { real = v; } });
}
