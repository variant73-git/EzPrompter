// lib/preview-video.js — preview ANIMADO do node (pedido do Adilson, 2026-08-21).
/**
 * O node de site mostra hoje um PNG estático (perf phase 3b, item 148b). Como o
 * produtor native já percorre a página inteira para acordar recurso preguiçoso,
 * essa passada é gravada em vídeo DE GRAÇA — nenhuma navegação extra, nenhuma
 * chamada de modelo — e o node passa a mostrar o site em movimento.
 *
 * REGRA DE PRODUTO: performance manda. O console tem o interruptor
 * `Preview: Video | Static`; se o vídeo custar quadro no canvas, volta-se ao
 * PNG com um clique. Além do interruptor, a reprodução é gated por
 * `offscreenParked` (o IntersectionObserver que o node já tem), então vídeo
 * fora da tela não decodifica.
 *
 * O arquivo entra no bundle num caminho RESERVADO, servido pela rota que já
 * existe. Nada no HTML o referencia — é inerte para o runtime, só o canvas o lê.
 */

// Caminho reservado dentro do bundle. `_uncraft/` não colide com o site: os
// caminhos do site vêm de bundlePathForUrl (host/path da URL original).
export const PREVIEW_VIDEO_PATH = '_uncraft/preview.webm';

// Teto do arquivo. O experimento de 20/08 gravou 72s a 1280×720 = 7,4MB; aqui
// são ~10-25s a 640×360, então a ordem esperada é 200KB-1,5MB. O teto existe
// para o caso patológico (página infinita), não para o caso normal.
export const PREVIEW_VIDEO_MAX_BYTES = 8 * 1024 * 1024;

// Resolução do preview: 16:9 pequeno. O node exibe ~300-600px de largura no
// canvas, então 640×360 já chega saturado — subir daqui só custa bytes e
// decodificação.
export const PREVIEW_VIDEO_SIZE = Object.freeze({ width: 640, height: 360 });

export const PREVIEW_MODES = Object.freeze(['video', 'static']);
export const DEFAULT_PREVIEW_MODE = 'video';

/** Modo de preview vindo do console; qualquer coisa fora da lista = default. */
export function resolvePreviewMode(value) {
  return PREVIEW_MODES.includes(String(value)) ? String(value) : DEFAULT_PREVIEW_MODE;
}

/** Ligado por padrão; `UNCRAFT_PREVIEW_VIDEO=off` desliga a GRAVAÇÃO no servidor. */
export function previewCaptureEnabled(env = process.env) {
  return String(env.UNCRAFT_PREVIEW_VIDEO || '').toLowerCase() !== 'off';
}

/**
 * URL servida do preview de um bundle registrado. `null` quando o bundle não
 * tem o arquivo — o node cai no PNG, que é o comportamento atual.
 */
export function previewVideoUrl(descriptor) {
  const found = descriptor?.assetIndex?.find((a) => a.path === PREVIEW_VIDEO_PATH);
  if (!found || !descriptor?.bundleId) return null;
  return `/api/native-clone/${descriptor.bundleId}/${PREVIEW_VIDEO_PATH}`;
}
