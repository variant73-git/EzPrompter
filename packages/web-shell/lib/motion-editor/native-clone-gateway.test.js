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

  it('injects a restrictive policy and exactly one bridge', () => {
    const result = injectRuntimeBridge('<html><head></head><body><main /></body></html>');
    expect(result).toContain("connect-src 'none'");
    expect(result).toContain("form-action 'none'");
    expect(result.match(/data-uncraft-runtime-bridge/g)).toHaveLength(1);
    expect(result.indexOf('Content-Security-Policy')).toBeLessThan(result.indexOf('<main'));
  });
});
