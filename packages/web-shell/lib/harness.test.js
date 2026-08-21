import { describe, it, expect } from 'vitest';
import { HARNESSES, resolveHarness, harnessFromCookieHeader } from './harness.js';

describe('harness registry', () => {
  it('baseline usa gpt-5.5 e terra usa gpt-5.6-terra no slot cloneVision', () => {
    expect(HARNESSES.baseline.cloneVision).toBe('gpt-5.5');
    expect(HARNESSES.terra.cloneVision).toBe('gpt-5.6-terra');
  });
  it('id desconhecido resolve para baseline (fail-closed de qualidade)', () => {
    expect(resolveHarness('hax').id).toBe('baseline');
    expect(resolveHarness(null).id).toBe('baseline');
  });
  it('lê o cookie da requisição', () => {
    expect(harnessFromCookieHeader('a=1; uncraft-harness=terra; b=2', {}).id).toBe('terra');
    expect(harnessFromCookieHeader('a=1', {}).id).toBe('baseline');
    expect(harnessFromCookieHeader(null, {}).id).toBe('baseline');
  });
  it('env UNCRAFT_HARNESS vence o cookie (força de servidor)', () => {
    expect(harnessFromCookieHeader('uncraft-harness=terra', { UNCRAFT_HARNESS: 'baseline' }).id).toBe('baseline');
  });
  it('cookie adulterado com valor não-registrado nunca sai do registro', () => {
    expect(harnessFromCookieHeader('uncraft-harness=gpt-4o-mini', {}).id).toBe('baseline');
  });
});
