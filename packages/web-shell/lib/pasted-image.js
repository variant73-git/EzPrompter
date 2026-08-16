/**
 * O que dá para aproveitar quando alguém copia uma imagem da internet.
 *
 * MEDIDO 2026-08-13 num Chromium real, e é o motivo destas funções existirem:
 *
 * | como se copia                | o que chega na área de transferência        |
 * |------------------------------|---------------------------------------------|
 * | botão direito → Copiar imagem| o arquivo da imagem (`items` com kind file) |
 * | selecionar e Cmd+C           | `text/plain` = texto alternativo, e          |
 * |                              | `text/html` = `<img src="…">` — sem arquivo  |
 * | Copiar endereço da imagem    | `text/plain` = a URL da imagem               |
 *
 * Só o primeiro caso funcionava. O segundo não fazia nada (o único endereço
 * disponível estava no HTML, que ninguém lia) e o terceiro criava um node de
 * SITE, tentando clonar a imagem como se fosse uma página.
 */

const EXTENSOES = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'svg'];

/**
 * O endereço da imagem dentro do HTML que o navegador colocou na área de
 * transferência — só quando há UMA imagem. Copiar um trecho de página traz
 * várias, e escolher uma seria adivinhar: adivinhar errado é pior do que não
 * agir.
 */
export function imageUrlFromPastedHtml(html) {
  if (!html || typeof html !== 'string') return null;
  const tags = html.match(/<img\b[^>]*>/gi) || [];
  if (tags.length !== 1) return null;
  const src = tags[0].match(/\bsrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
  if (!src) return null;
  const bruto = (src[2] ?? src[3] ?? src[4] ?? '').trim();
  // As entidades vêm do próprio navegador ao serializar o fragmento; sem
  // decodificar, `&amp;` na query quebraria a busca da imagem.
  const endereco = bruto
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  return /^https?:\/\//i.test(endereco) ? endereco : null;
}

/**
 * A URL aponta para um arquivo de imagem?
 *
 * Decide pela extensão do CAMINHO, não pela string inteira: `png.com/sobre` é
 * um site, e `e.com/a.png/artigo` também. Um CDN que serve imagem sem extensão
 * continua caindo no comportamento antigo (node de site) — limite conhecido e
 * preferível a buscar toda URL colada só para descobrir o que ela é.
 */
export function looksLikeImageUrl(url) {
  if (!url || typeof url !== 'string') return false;
  let caminho;
  try {
    caminho = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).pathname;
  } catch (_) {
    return false;
  }
  const ponto = caminho.lastIndexOf('.');
  if (ponto === -1) return false;
  return EXTENSOES.includes(caminho.slice(ponto + 1).toLowerCase());
}
