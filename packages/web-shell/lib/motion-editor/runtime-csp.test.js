import { describe, expect, it } from 'vitest';
import { runtimeCspHeader, runtimeCspMeta } from './runtime-csp.js';

describe('runtime CSP — one structured source for header AND meta', () => {
  it('header and meta serialize from the same policy (divergence dies by construction)', () => {
    const header = runtimeCspHeader({ frameAncestor: 'https://app.example' });
    const meta = runtimeCspMeta();
    const strip = (csp) => csp.split('; ').filter((d) => !d.startsWith('frame-ancestors')).sort().join('; ');
    expect(strip(header)).toBe(strip(meta));
  });

  it('frame-ancestors lives ONLY in the header (meta does not support the directive)', () => {
    expect(runtimeCspHeader({ frameAncestor: 'https://app.example' })).toContain('frame-ancestors https://app.example');
    expect(runtimeCspHeader({ frameAncestor: "'self'" })).toContain("frame-ancestors 'self'");
    expect(runtimeCspMeta()).not.toContain('frame-ancestors');
  });

  it("the meta now carries worker-src — the divergence the audit flagged, closed", () => {
    // Antes: header tinha `worker-src 'self' blob:`, a meta injetada não —
    // políticas se INTERSECTAM, então a meta sem a diretiva não relaxava nada,
    // mas a fonte dupla era exatamente como a divergência nasceu (spec §5).
    expect(runtimeCspMeta()).toContain("worker-src 'self' blob:");
    expect(runtimeCspHeader({ frameAncestor: "'self'" })).toContain("worker-src 'self' blob:");
  });

  it('keeps the exact legacy directive set (no accidental relaxation or tightening)', () => {
    expect(runtimeCspHeader({ frameAncestor: "'self'" })).toBe([
      "default-src 'self' data: blob:",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "media-src 'self' data: blob:",
      "connect-src 'self'",
      "worker-src 'self' blob:",
      "form-action 'none'",
      "object-src 'none'",
      "base-uri 'none'",
      "frame-ancestors 'self'",
    ].join('; '));
  });

  it('requires a frameAncestor for the header form', () => {
    expect(() => runtimeCspHeader({})).toThrow();
  });
});

describe('authored CSP meta detector (detection, never mutation)', () => {
  it('flags a site-authored CSP meta in served HTML', async () => {
    const { htmlCarriesAuthoredCspMeta } = await import('./runtime-csp.js');
    expect(htmlCarriesAuthoredCspMeta('<meta http-equiv="Content-Security-Policy" content="script-src \'none\'">')).toBe(true);
    expect(htmlCarriesAuthoredCspMeta("<meta http-equiv='content-security-policy' content=\"x\">")).toBe(true);
  });

  it('never flags OUR injected policy meta or unrelated metas', async () => {
    const { htmlCarriesAuthoredCspMeta } = await import('./runtime-csp.js');
    expect(htmlCarriesAuthoredCspMeta('<meta data-uncraft-runtime-policy http-equiv="Content-Security-Policy" content="x">')).toBe(false);
    expect(htmlCarriesAuthoredCspMeta('<meta http-equiv="refresh" content="0">')).toBe(false);
    expect(htmlCarriesAuthoredCspMeta('')).toBe(false);
  });
});
