import { TOKEN_VERIFICATION_ERRORS } from './runtime-session-token.js';

/**
 * Todo motivo que o gateway do runtime sabe produzir.
 *
 * Fechado de propósito: o cabeçalho de diagnóstico só pode carregar valor desta
 * lista, nunca texto de exceção ou de entrada (Sol). Vive fora da rota para que
 * o teste de guarda compare com a MESMA fonte — rota do Next não deve exportar
 * símbolo que não seja handler.
 *
 * Os motivos de token são DERIVADOS do verificador, não repetidos à mão:
 * escrevendo a lista de novo eu já tinha deixado `server_misconfigured` de fora
 * e inventado um `token_malformed` inexistente — omissão silenciosa exatamente
 * onde o motivo existe para acabar com o silêncio.
 */
export const MOTIVOS_DE_FALHA = new Set([
  'wrong_runtime_origin', 'database_unavailable', 'session_scope_mismatch',
  'invalid_runtime_contract', 'entry_prefix_mismatch', 'undeclared_asset',
  'asset_unavailable',
  ...TOKEN_VERIFICATION_ERRORS.map((e) => `token_${e}`),
]);
