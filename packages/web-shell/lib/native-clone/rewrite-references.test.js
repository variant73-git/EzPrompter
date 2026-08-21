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
