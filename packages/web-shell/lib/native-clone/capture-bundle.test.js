import { describe, expect, it } from 'vitest';
import { bundlePathForUrl, rewriteReferences, srcsetCandidateUrls } from './capture-bundle.js';

describe('srcsetCandidateUrls (defect 1b, 2026-08-20)', () => {
  // The capture only saved the srcset candidate the browser happened to pick
  // at the capture viewport; the others stayed absolute in the HTML and the
  // gateway CSP (img-src 'self') blocks them forever. The closing pass loads
  // every candidate inside the page, so they enter the normal interception
  // (SSRF guard + limits + report) — this parser feeds that pass.
  it('parses candidates with width and density descriptors', () => {
    expect(srcsetCandidateUrls('https://a/x.avif 500w, ./y.avif 1542w')).toEqual([
      'https://a/x.avif', './y.avif',
    ]);
    expect(srcsetCandidateUrls('img/a.png 1x, img/b.png 2x')).toEqual(['img/a.png', 'img/b.png']);
  });

  it('parses bare candidates without descriptors', () => {
    expect(srcsetCandidateUrls('https://a/only.webp')).toEqual(['https://a/only.webp']);
  });

  it('does not split data URLs on their commas', () => {
    expect(srcsetCandidateUrls('data:image/png;base64,AAA 1x, https://a/z.png 2x')).toEqual([
      'data:image/png;base64,AAA', 'https://a/z.png',
    ]);
  });

  it('tolerates whitespace-heavy and empty input', () => {
    expect(srcsetCandidateUrls('')).toEqual([]);
    expect(srcsetCandidateUrls(null)).toEqual([]);
    expect(srcsetCandidateUrls('  https://a/x.png   2x  ,   https://a/y.png 3x  ')).toEqual([
      'https://a/x.png', 'https://a/y.png',
    ]);
  });
});

describe('rewriteReferences guardrails', () => {
  it('rewrites mapped urls and leaves unmapped ones alone', () => {
    const mapa = new Map([['https://cdn.test/app.js', '_ext/cdn.test/app.js']]);
    const saida = rewriteReferences('<script src="https://cdn.test/app.js"></script><img src="https://cdn.test/miss.png">', mapa);
    expect(saida).toContain('./_ext/cdn.test/app.js');
    expect(saida).toContain('https://cdn.test/miss.png');
  });
});

describe('bundlePathForUrl', () => {
  it('keeps host separation and sanitizes characters', () => {
    expect(bundlePathForUrl('https://cdn.test/img/a%20b.svg', 'https://site.test/')).toBe('_ext/cdn.test/img/a_20b.svg');
  });
});
