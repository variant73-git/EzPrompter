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
});
