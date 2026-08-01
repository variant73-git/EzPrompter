import { describe, expect, it } from 'vitest';
import { injectRuntimeBridge, rewriteRuntimePaths } from './native-clone-gateway.js';

describe('native clone gateway', () => {
  it('rewrites quoted, CSS, and srcset root assets', () => {
    const source = '<link href="/assets/a.css"><img srcset="/assets/a.png 1x, /assets/b.png 2x"><style>x{background:url(/assets/c.png)}</style>';
    const result = rewriteRuntimePaths(source);
    expect(result).not.toMatch(/(?<!native-clone)\/assets\//);
    expect(result.match(/\/api\/native-clone\/assets\//g)).toHaveLength(4);
  });

  it('does not rewrite an already translated path twice', () => {
    const source = '"/api/native-clone/assets/a.css"';
    expect(rewriteRuntimePaths(source)).toBe(source);
  });

  it('rewrites every top-level bundle directory it is given, not just /assets/', () => {
    // The farmminerals fixture loads jQuery/Lenis from /vendor/ and videos from
    // /media/ — root-absolute paths that would otherwise escape the gateway and
    // 404 against the Next app, killing the site's boot script (blank page).
    const source = '<script src="/vendor/cf/js/jquery.min.js"></script><video src="/media/corn.mp4"></video><img src="/assets/a.png">';
    const result = rewriteRuntimePaths(source, ['assets', 'vendor', 'media']);
    expect(result).toContain('"/api/native-clone/vendor/cf/js/jquery.min.js"');
    expect(result).toContain('"/api/native-clone/media/corn.mp4"');
    expect(result).toContain('"/api/native-clone/assets/a.png"');
  });

  it('rewrites bundle-root references against a signed runtime base while preserving relative URLs', () => {
    const source = [
      '<link rel="stylesheet" href="/assets/app.css">',
      '<script type="module">import("/vendor/chunk.js")</script>',
      '<img srcset="/media/a.webp 1x, /media/b.webp 2x">',
      '<img src="./assets/relative.webp">',
    ].join('');
    const base = '/api/runtime/signed-token';
    const result = rewriteRuntimePaths(source, ['assets', 'vendor', 'media'], base);
    expect(result.match(/\/api\/runtime\/signed-token\//g)).toHaveLength(4);
    expect(result).toContain('src="./assets/relative.webp"');
    expect(rewriteRuntimePaths(result, ['assets', 'vendor', 'media'], base)).toBe(result);
  });

  it('ignores unsafe or irrelevant prefix names and leaves other absolute paths alone', () => {
    const source = '<a href="/about/team">x</a><script src="/vendor/a.js"></script>';
    const result = rewriteRuntimePaths(source, ['vendor', 'not/safe', '']);
    expect(result).toContain('"/api/native-clone/vendor/a.js"');
    expect(result).toContain('"/about/team"');
  });

  it('injects a restrictive policy and exactly one bridge', () => {
    const result = injectRuntimeBridge('<html><head></head><body><main /></body></html>');
    // connect-src 'self': Lottie players fetch their animation JSON at runtime —
    // 'none' blanked every Lottie-backed clone. 'self' keeps fetch pinned to the
    // gateway origin; external hosts stay blocked by default-src.
    expect(result).toContain("connect-src 'self'");
    expect(result).not.toContain("connect-src 'none'");
    expect(result).toContain("form-action 'none'");
    expect(result.match(/data-uncraft-runtime-bridge/g)).toHaveLength(1);
    expect(result.indexOf('Content-Security-Policy')).toBeLessThan(result.indexOf('<main'));
  });

  it('injects one inert runtime config and remains idempotent', () => {
    const html = '<html><head></head><body><main /></body></html>';
    const config = {
      sessionNonce: 'nonce-123',
      runtimeFingerprint: `sha256:${'a'.repeat(64)}`,
      initialManifest: { schemaVersion: 2, note: '</script><script>unsafe()</script>' },
    };
    const first = injectRuntimeBridge(html, config);
    const second = injectRuntimeBridge(first, config);
    expect(second.match(/data-uncraft-runtime-bridge/g)).toHaveLength(1);
    expect(second.match(/data-uncraft-runtime-config/g)).toHaveLength(1);
    expect(second).not.toContain('</script><script>unsafe()');
    expect(second).toContain('\\u003c/script\\u003e');
  });

  // O parser tolera comentários e processing instructions antes do doctype (o
  // modo "initial" preserva o modo do documento pra esses tokens), mas QUALQUER
  // outro token — um `<meta>`, por exemplo — dispara quirks mode e faz o doctype
  // seguinte ser ignorado: box model diferente, o clone renderiza errado. O
  // injetor antigo só reconhecia `<head>` literal e, quando o regex não casava,
  // prependia o meta de CSP ANTES do doctype. Medido em Chromium real:
  // CSS1Compat -> BackCompat (spike r46 §4).
  it('keeps the doctype first when the head tag carries attributes', () => {
    const result = injectRuntimeBridge('<!DOCTYPE html><html><head lang="en"><title>t</title></head><body><main /></body></html>');
    expect(result.slice(0, 15).toLowerCase()).toBe('<!doctype html>');
    expect(result).toContain('Content-Security-Policy');
  });

  it('keeps the doctype first when the document has no head tag', () => {
    const result = injectRuntimeBridge('<!DOCTYPE html><html><body><main /></body></html>');
    expect(result.slice(0, 15).toLowerCase()).toBe('<!doctype html>');
    expect(result).toContain('Content-Security-Policy');
  });

  // XHTML legado servido como text/html traz um prólogo XML. O tokenizer o trata
  // como comentário (bogus comment), então o doctype logo abaixo AINDA vale e o
  // documento fica em standards mode. Um scanner de preâmbulo que só entende
  // `<!-- -->` não reconhece o prólogo, cai na posição 0 e joga o meta antes do
  // doctype — quirks mode. Achado do Sol na auditoria do fix.
  it('keeps the doctype first when an XML prolog precedes it', () => {
    const result = injectRuntimeBridge('<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE html><html><head><title>t</title></head><body><main /></body></html>');
    expect(result.slice(0, 38)).toBe('<?xml version="1.0" encoding="UTF-8"?>');
    expect(result.indexOf('data-uncraft-runtime-policy')).toBeGreaterThan(result.toLowerCase().indexOf('<!doctype html>'));
  });

  // O tokenizer resolve referências de caractere ANTES da construção da árvore,
  // e o modo "initial" ignora tokens de whitespace — então `&#10;` antes do
  // doctype não tira o documento do standards mode. Um scanner que pare no `&`
  // devolve 0 e injeta antes do doctype: quirks. Achado do Sol, rodada 2.
  it('keeps the doctype first when a whitespace character reference precedes it', () => {
    const result = injectRuntimeBridge('&#10;<!DOCTYPE html><html><head><title>t</title></head><body><main /></body></html>');
    expect(result.indexOf('data-uncraft-runtime-policy')).toBeGreaterThan(result.toLowerCase().indexOf('<!doctype html>'));
  });

  // Cobre o RAMO de comentários do scanner: com o doctype na posição zero ele
  // retorna de imediato e o laço de comentários nunca roda.
  it('keeps the doctype first when a real comment precedes it', () => {
    const result = injectRuntimeBridge('<!-- build 42 --><!DOCTYPE html><html><head><title>t</title></head><body><main /></body></html>');
    expect(result.slice(0, 17)).toBe('<!-- build 42 -->');
    expect(result.indexOf('data-uncraft-runtime-policy')).toBeGreaterThan(result.toLowerCase().indexOf('<!doctype html>'));
  });

  // O anchor antigo era uma busca literal por `<head>`, que casa DENTRO de um
  // comentário — a injeção inteira ia parar comentada e o meta de CSP nunca era
  // parseado (o header HTTP seguia valendo, então era perda de defesa em
  // profundidade, não a única defesa).
  it('never buries the policy inside a comment that mentions a head tag', () => {
    const result = injectRuntimeBridge('<!DOCTYPE html><!-- <head> --><html><head><title>t</title></head><body><main /></body></html>');
    const policyAt = result.indexOf('data-uncraft-runtime-policy');
    const decoyOpen = result.indexOf('<!-- <head>');
    const decoyClose = result.indexOf('-->', decoyOpen);
    expect(policyAt).toBeGreaterThan(-1);
    expect(policyAt > decoyOpen && policyAt < decoyClose).toBe(false);
  });
});
