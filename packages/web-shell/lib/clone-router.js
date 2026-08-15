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

export const CLONE_ENGINES = Object.freeze(['native', 'iter9']);

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

export function producerForEngine(engine) {
  return engine === 'iter9' ? reconstructPage : captureNativeBundle;
}
