import { describe, it, expect } from 'vitest';
import { assertIsolatedTarget } from './seed.mjs';

const ALLOW = 'ep-orange-frost-acaedcil';

describe('assertIsolatedTarget', () => {
  it('accepts the allowlisted disposable endpoint', () => {
    expect(() => assertIsolatedTarget('postgres://u:p@ep-orange-frost-acaedcil-pooler.sa-east-1.aws.neon.tech/neondb?sslmode=require', { allowlistEndpoint: ALLOW })).not.toThrow();
  });
  it('rejects a different (e.g. production) endpoint', () => {
    expect(() => assertIsolatedTarget('postgres://u:p@ep-lingering-shadow-achloaoq-pooler.sa-east-1.aws.neon.tech/neondb', { allowlistEndpoint: ALLOW })).toThrow(/allowlist/);
  });
  it('rejects an endpoint-routing override', () => {
    expect(() => assertIsolatedTarget('postgres://u:p@ep-orange-frost-acaedcil.sa-east-1.aws.neon.tech/neondb?options=endpoint%3Dep-other', { allowlistEndpoint: ALLOW })).toThrow(/options|override/);
  });
  it('rejects an unparseable url', () => {
    expect(() => assertIsolatedTarget('', { allowlistEndpoint: ALLOW })).toThrow();
  });
  it('rejects a two-@ host-confusion url whose REAL host is production', () => {
    // new URL() resolves the host after the LAST @ (production); a naive regex on the
    // raw string matches the FIRST @ (allowlisted) and is fooled. Guard must use new URL().
    expect(() => assertIsolatedTarget('postgres://u:p@ep-orange-frost-acaedcil.neon.tech@ep-lingering-shadow-achloaoq.neon.tech/neondb', { allowlistEndpoint: ALLOW })).toThrow(/allowlist/);
  });
});
