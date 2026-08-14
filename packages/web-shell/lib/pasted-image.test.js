import { describe, expect, it } from 'vitest';
import { imageUrlFromPastedHtml, looksLikeImageUrl } from './pasted-image.js';

// MEDIDO 2026-08-13 num Chromium real: copiar uma imagem de uma pagina
// SELECIONANDO-A nao poe arquivo nenhum na area de transferencia. Poe
// `text/plain` com o texto alternativo e `text/html` com o `<img src>`. O canvas
// so olhava arquivo e texto simples, entao nao acontecia nada — e a unica pista
// que existia, o endereco da imagem dentro do HTML, era ignorada.
describe('imageUrlFromPastedHtml', () => {
  it('takes the src of a single copied image', () => {
    const html = '<meta charset="utf-8"><img id="alvo" src="https://exemplo.com/foto.png" width="200" alt="uma foto">';
    expect(imageUrlFromPastedHtml(html)).toBe('https://exemplo.com/foto.png');
  });

  it('reads the src no matter the attribute order or quoting', () => {
    expect(imageUrlFromPastedHtml(`<img alt='x' src='https://e.com/a.jpg'>`)).toBe('https://e.com/a.jpg');
    expect(imageUrlFromPastedHtml('<img data-a="1" srcset="a 1x" src="https://e.com/b.webp">')).toBe('https://e.com/b.webp');
  });

  it('decodes the entities the browser put in the markup', () => {
    expect(imageUrlFromPastedHtml('<img src="https://e.com/a.png?w=10&amp;h=20">'))
      .toBe('https://e.com/a.png?w=10&h=20');
  });

  // Copiar um TRECHO de pagina traz varias imagens junto de texto. Escolher uma
  // delas seria adivinhar qual — e adivinhar errado e' pior do que nao agir.
  it('refuses when the copied fragment carries more than one image', () => {
    expect(imageUrlFromPastedHtml('<p><img src="https://e.com/a.png"><img src="https://e.com/b.png"></p>')).toBe(null);
  });

  it('ignores anything that is not a remote image', () => {
    expect(imageUrlFromPastedHtml('<p>so texto</p>')).toBe(null);
    expect(imageUrlFromPastedHtml('<img src="data:image/png;base64,AAA">')).toBe(null);
    expect(imageUrlFromPastedHtml('<img src="/relativo.png">')).toBe(null);
    expect(imageUrlFromPastedHtml('')).toBe(null);
    expect(imageUrlFromPastedHtml(null)).toBe(null);
  });
});

// "Copiar endereco da imagem" entrega uma URL em texto simples. Ate 13/08 ela
// caia na mesma porta de qualquer link e virava um node de SITE — o canvas
// tentava clonar a imagem como se fosse uma pagina.
describe('looksLikeImageUrl', () => {
  it('recognises the usual image extensions, with query string', () => {
    ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'svg'].forEach((ext) => {
      expect(looksLikeImageUrl(`https://e.com/foto.${ext}`)).toBe(true);
      expect(looksLikeImageUrl(`https://e.com/foto.${ext.toUpperCase()}?w=1200&q=80`)).toBe(true);
    });
  });

  it('does not claim a page is an image', () => {
    expect(looksLikeImageUrl('https://exemplo.com')).toBe(false);
    expect(looksLikeImageUrl('https://exemplo.com/pagina.html')).toBe(false);
    // extensao no dominio ou no meio do caminho nao conta
    expect(looksLikeImageUrl('https://png.com/sobre')).toBe(false);
    expect(looksLikeImageUrl('https://e.com/a.png/artigo')).toBe(false);
    expect(looksLikeImageUrl('')).toBe(false);
    expect(looksLikeImageUrl(null)).toBe(false);
  });

  // Um CDN que serve imagem sem extensao continua virando node de site. Limite
  // conhecido: e' melhor errar para o lado do comportamento antigo do que
  // buscar toda URL colada so para descobrir o que ela e'.
  it('cannot tell an extensionless CDN image from a page (known limit)', () => {
    expect(looksLikeImageUrl('https://images.unsplash.com/photo-1517849845537')).toBe(false);
  });
});
