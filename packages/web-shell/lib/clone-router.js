/**
 * QUEM CLONA — a doutrina, num módulo só.
 *
 * Ordem do Adilson (2026-08-15): quando ele diz "clone", existe UM — o ANIMADO
 * (produtor nativo, que preserva a página viva com os scripts reais). O iter9
 * é o clonador ESTÁTICO de site animado — funciona, é história do produto, e
 * fica À DISPOSIÇÃO: entra **somente quando pedido por nome**. Nada além desses
 * dois é clone (o clone por screenshot é ferramenta de imagem, outra coisa).
 *
 * A regra, na ordem em que decide:
 *   1. Pedido nominal vence tudo: `requested: 'iter9'` → iter9;
 *      `requested: 'native'` → native.
 *   2. Consumidor textual é a exceção DELIBERADA e nomeada: as razões de
 *      composição (`transform-target`, `runtime-source`) alimentam o
 *      `runCompose` com HTML — e bundle nativo é um diretório, sem html.
 *      Ampliá-las quebraria a composição (item 179, achado #10 do Sol).
 *      Para consumidor estático, o estático certo é o iter9 — nunca o
 *      fatiamento de screenshot.
 *   3. Todo o resto é o clone: native.
 */
import { reconstructPage } from './reconstruct.js';
import { captureNativeBundle } from './native-clone/capture-bundle.js';
import { remakeSite } from './remake/produce.js';

/**
 * ⭐ `remake` — o terceiro motor (2026-08-22, pedido do Adilson).
 *
 * Refaz o site nas NOSSAS regras — documento único, estilo embutido, sem
 * dependência externa —, que é o que faz o editor completo funcionar em
 * qualquer site, E devolve o movimento, porque interroga a página viva em vez
 * de olhar fotos paradas. É o que faltava: o legado homogeneíza e entrega zero
 * movimento (medido); o native entrega movimento e o formato do desenvolvedor.
 *
 * Nunca é escolhido sozinho: entra por pedido nominal, como o legado.
 */
export const CLONE_ENGINES = Object.freeze(['native', 'iter9', 'remake']);

/** Razões cujo consumidor lê HTML como texto — a exceção deliberada. */
const CONSUMO_TEXTUAL = new Set(['transform-target', 'runtime-source']);

export function resolveCloneEngine({ requested = null, reason = null } = {}) {
  if (requested != null) {
    if (!CLONE_ENGINES.includes(requested)) {
      const erro = new Error(`unknown_clone_engine: ${requested}`);
      erro.code = 'unknown_clone_engine';
      throw erro;
    }
    return requested;
  }
  if (CONSUMO_TEXTUAL.has(reason)) return 'iter9';
  return 'native';
}

const PRODUTORES = { iter9: reconstructPage, remake: remakeSite, native: captureNativeBundle };

export function producerForEngine(engine) {
  // Mapa explícito e não ternário encadeado: com três motores, um `else` mudo
  // faria um nome novo cair no native em silêncio — que é exatamente a classe
  // de erro que a doutrina veio corrigir.
  return PRODUTORES[engine] || captureNativeBundle;
}
