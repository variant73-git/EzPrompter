import { describe, expect, it } from 'vitest';
import { referenceKindFor, rewriteDocumentReferences } from './rewrite-references.js';

const map = new Map([
  ['https://s.test/a.png', 'a.png'],
  ['https://s.test/b.png', 'b.png'],
  ['https://s.test/img/deep.png', 'img/deep.png'],
  ['https://s.test/style.css', 'style.css'],
  ['https://cdn.test/font.woff', '_ext/cdn.test/font.woff'],
]);

const html = (text, assetPath = 'index.html', resourceUrl = 'https://s.test/index.html') =>
  rewriteDocumentReferences({ text, kind: 'html', resourceUrl, assetPath, map });

describe('rewriteDocumentReferences', () => {
  it('rewrites root-absolute references — the shape a site uses for its own files', () => {
    // The defect this closes: only absolute URLs were rewritten, so a file on
    // the site's own root stayed unreachable behind the runtime gateway.
    expect(html('<link href="/style.css"><img src="/a.png">'))
      .toBe('<link href="./style.css"><img src="./a.png">');
  });

  it('resolves relative references against the file itself, from any depth', () => {
    const css = rewriteDocumentReferences({
      text: '@font-face{src:url(font.woff)}',
      kind: 'css',
      resourceUrl: 'https://cdn.test/style.css',
      assetPath: '_ext/cdn.test/style.css',
      map,
    });
    expect(css).toBe('@font-face{src:url(./font.woff)}');
  });

  it('honours <base href> for lookup and drops the tag (it names the ORIGINAL origin)', () => {
    const out = html('<base href="/img/"><img src="deep.png">');
    expect(out).toContain('src="./img/deep.png"');
    expect(out).not.toMatch(/<base/i);
  });

  // Scope, stated on purpose: this preserves the references the scanner sees.
  // Script bodies are not processed here, so a URL a script resolves against
  // the document is outside the guarantee (Sol).
  it('pins leftover relative references when <base> is dropped, so no scanner-visible reference silently repoints', () => {
    // Removing <base href="/img/"> would make an unrewritten `missing.png`
    // resolve against the bundle directory instead of the original base —
    // a silent repoint. It keeps the meaning it had (Sol).
    const out = html('<base href="/img/"><img src="deep.png"><img src="missing.png">');
    expect(out).toContain('src="./img/deep.png"');
    expect(out).toContain('src="https://s.test/img/missing.png"');
    expect(out).not.toMatch(/<base/i);
  });

  it('pins protocol-relative and srcset/url() leftovers too — the scheme comes from the base', () => {
    // `//cdn.test/x.png` under an http base becomes https once the bundle is
    // served over TLS: still a move, even if the CSP blocks both (Sol).
    const out = rewriteDocumentReferences({
      text: '<base href="http://origin.test/img/">'
        + '<img src="//cdn.test/a.png">'
        + '<img srcset="rel-a.png 1x, //cdn.test/b.png 2x">'
        + '<div style="background:url(rel-c.png)"></div>',
      kind: 'html',
      resourceUrl: 'http://origin.test/index.html',
      assetPath: 'index.html',
      map,
    });
    expect(out).toContain('src="http://cdn.test/a.png"');
    expect(out).toContain('http://origin.test/img/rel-a.png');
    expect(out).toContain('http://cdn.test/b.png');
    expect(out).toContain('url(http://origin.test/img/rel-c.png)');
  });

  it('a comment mentioning <script> does not blind the rest of the document', () => {
    // The scan treated the mentioned tag as real and skipped everything after
    // it, leaving every later reference pointing at the live site (Sol).
    expect(html('<!-- <script> --><img src="/a.png">')).toContain('src="./a.png"');
  });

  it('never reads a reference out of a comment', () => {
    expect(html('<!-- <img src="/b.png"> -->')).toContain('/b.png');
  });

  it('leaves script bodies alone', () => {
    const out = html('<script>const u = "/a.png";</script><img src="/a.png">');
    expect(out).toContain('const u = "/a.png"');
    expect(out).toContain('src="./a.png"');
  });

  it('decodes entities before lookup and re-encodes on the way back', () => {
    const withQuery = new Map([['https://s.test/i?url=x&w=64', 'i.ab12cd34']]);
    const out = rewriteDocumentReferences({
      text: '<img src="/i?url=x&amp;w=64">',
      kind: 'html', resourceUrl: 'https://s.test/index.html', assetPath: 'index.html', map: withQuery,
    });
    expect(out).toBe('<img src="./i.ab12cd34">');
  });

  it('rewrites every srcset candidate, including one with no descriptor', () => {
    expect(html('<img srcset="/a.png, /b.png 2x">'))
      .toBe('<img srcset="./a.png, ./b.png 2x">');
  });

  it('keeps a fragment and leaves uncaptured references untouched', () => {
    expect(html('<img src="/a.png#frag"><img src="/never.png">'))
      .toBe('<img src="./a.png#frag"><img src="/never.png">');
  });

  it('classifies content by extension or content type', () => {
    expect(referenceKindFor('a/b.html')).toBe('html');
    expect(referenceKindFor('a/b', 'text/css; charset=utf-8')).toBe('css');
    expect(referenceKindFor('a/b.svg')).toBe('svg');
    expect(referenceKindFor('a/b.js', 'application/javascript')).toBe(null);
  });
});
// ⚠️ Enumerar nomes de data-* e' jogo perdido: o rodape' do farmminerals guarda
// o logo em `data-icon` (um script le e injeta <img>), e o proximo site inventa
// outro nome. QUALQUER data-* vira candidato — a seguranca ja' esta' na
// construcao: so' troca quando o valor bate exatamente com resposta capturada;
// valor que nao e' URL capturada nao casa e fica intacto.
describe('atributos data-* arbitrarios', () => {
  const mapa = new Map([
    ['https://cdn.test/x/logo%20icon.svg', '_ext/cdn.test/x/logo_20icon.svg'],
    ['https://s.test/a.png', 'a.png'],
  ]);
  const roda = (text) => rewriteDocumentReferences({
    text, kind: 'html', resourceUrl: 'https://s.test/index.html', assetPath: 'index.html', map: mapa,
  });

  it('reescreve data-icon (o caso medido no farmminerals)', () => {
    const saida = roda('<div data-icon="https://cdn.test/x/logo%20icon.svg" class="w-embed"></div>');
    expect(saida).toContain('data-icon="./_ext/cdn.test/x/logo_20icon.svg"');
    expect(saida).not.toContain('cdn.test/x/logo%20icon');
  });

  it('data-* que nao e URL capturada fica intacto', () => {
    const texto = '<div data-wf-domain="s.test" data-anything="42" data-note="ver https://outra.coisa/x"></div>';
    expect(roda(texto)).toBe(texto);
  });

  it('data-srcset continua no tokenizador de srcset, sem passar duas vezes', () => {
    expect(roda('<img data-srcset="https://s.test/a.png 1x">')).toBe('<img data-srcset="./a.png 1x">');
  });

  // ⚠️ A fronteira do Sol: data-* sem semantica de spec pode carregar URL como
  // IDENTIDADE (share-url, canonico, endpoint), nao recurso. Alvo DOCUMENTO
  // capturado fica absoluto mesmo estando no mapa; so asset estatico troca.
  it('data-* apontando para DOCUMENTO capturado fica absoluto', () => {
    const mapa2 = new Map([
      ['https://s.test/index.html', 'index.html'],
      ['https://s.test/pagina', '_paginas/pagina'],
      ['https://s.test/anim.json', 'anim.json'],
    ]);
    const roda2 = (text) => rewriteDocumentReferences({
      text, kind: 'html', resourceUrl: 'https://s.test/index.html', assetPath: 'index.html', map: mapa2,
    });
    const texto = '<div data-share-url="https://s.test/index.html" data-page="https://s.test/pagina"></div>';
    expect(roda2(texto)).toBe(texto);
    // PDF tambem e' documento que se compartilha por URL: fica absoluto
    const mapa3 = new Map([['https://s.test/whitepaper.pdf', 'whitepaper.pdf']]);
    const pdf = '<a data-download="https://s.test/whitepaper.pdf">';
    expect(rewriteDocumentReferences({ text: pdf, kind: 'html', resourceUrl: 'https://s.test/index.html', assetPath: 'index.html', map: mapa3 })).toBe(pdf);
    // e o mesmo alvo em HREF (semantica de spec) continua trocando
    expect(roda2('<a href="https://s.test/index.html">')).toBe('<a href="./index.html">');
    // json de animacao (Lottie) e' asset: troca
    expect(roda2('<div data-animation-src="https://s.test/anim.json">')).toBe('<div data-animation-src="./anim.json">');
  });
});

describe('corpo JSON (dado consumido em runtime)', () => {
  const mapa = () => new Map([
    ['https://site.com/media/foto.png', 'media/foto.png'],
    ['https://cdn.outro.com/x.js', '_ext/cdn.outro.com/x.js'],
  ]);
  const reescreve = (text) => rewriteDocumentReferences({
    text, kind: 'json',
    resourceUrl: 'https://site.com/api/perfil.php',
    assetPath: 'api/perfil.php',
    map: mapa(),
  });

  it('reconhece JSON pelo content-type, mesmo com extensao enganosa', () => {
    // O caso real: a resposta da API do gsap.com chega como `.php` com JSON dentro.
    expect(referenceKindFor('community/index.93580e97.php', 'application/json')).toBe('json');
    expect(referenceKindFor('dados.json', '')).toBe('json');
    expect(referenceKindFor('pagina.php', 'text/html')).toBe('html');
  });

  it('acha a URL apesar do escape de barra do JSON, e devolve o mesmo escape', () => {
    const saida = reescreve('{"foto": "https:\\/\\/site.com\\/media\\/foto.png"}');
    expect(saida).toContain('.\\/media\\/foto.png');
    expect(JSON.parse(saida).foto).toBe('./media/foto.png');
  });

  it('tambem funciona sem escape (JSON nao obriga a escapar barra)', () => {
    const saida = reescreve('{"foto": "https://site.com/media/foto.png"}');
    expect(JSON.parse(saida).foto).toBe('./media/foto.png');
    expect(saida).not.toContain('\\/');
  });

  it('o caminho e relativo a RAIZ, nao a pasta do JSON', () => {
    // Quem resolve o caminho e quem CONSOME o dado (o script poe em img.src), e essa
    // resolucao acontece contra o DOCUMENTO. Relativo a `api/` apontaria errado.
    const saida = reescreve('{"foto": "https://site.com/media/foto.png"}');
    expect(JSON.parse(saida).foto).toBe('./media/foto.png');
    expect(JSON.parse(saida).foto).not.toBe('../media/foto.png');
  });

  it('nao toca texto que apenas se parece com URL nem URL nao capturada', () => {
    const entrada = '{"texto": "visite https://site.com/pagina-que-nao-capturamos", "n": 1}';
    expect(reescreve(entrada)).toBe(entrada);
  });

  it('mantem o JSON parseavel quando ha varias ocorrencias', () => {
    const saida = reescreve('{"a": "https://site.com/media/foto.png", "b": "https://cdn.outro.com/x.js"}');
    const o = JSON.parse(saida);
    expect(o.a).toBe('./media/foto.png');
    expect(o.b).toBe('./_ext/cdn.outro.com/x.js');
  });
});
