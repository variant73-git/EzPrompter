import { describe, expect, it } from 'vitest';
import { resolveCloneEngine } from './clone-router.js';

// A doutrina (Adilson, 2026-08-15), presa em teste: "clone" é UM — o animado.
// O iter9 entra SOMENTE por nome. Se alguém mudar qualquer linha disto, está
// mudando uma ordem de produto, não um detalhe.
describe('resolveCloneEngine', () => {
  it('the clone is the animated one — native is the default', () => {
    expect(resolveCloneEngine({})).toBe('native');
    expect(resolveCloneEngine({ reason: 'edit' })).toBe('native');
    expect(resolveCloneEngine({ reason: 'qualquer-coisa-nova' })).toBe('native');
  });

  it('iter9 only when asked for by name', () => {
    expect(resolveCloneEngine({ requested: 'iter9' })).toBe('iter9');
    // e o pedido nominal vence inclusive a razão de edit
    expect(resolveCloneEngine({ requested: 'iter9', reason: 'edit' })).toBe('iter9');
    expect(resolveCloneEngine({ requested: 'native', reason: 'transform-target' })).toBe('native');
  });

  // A exceção DELIBERADA (item 179, achado #10): composição lê HTML como
  // texto, e bundle nativo é um diretório. Para consumidor estático, o
  // estático certo é o iter9.
  it('textual consumers keep iter9 — the named deliberate limit', () => {
    expect(resolveCloneEngine({ reason: 'transform-target' })).toBe('iter9');
    expect(resolveCloneEngine({ reason: 'runtime-source' })).toBe('iter9');
  });

  it('an unknown engine name is refused out loud, never silently defaulted', () => {
    expect(() => resolveCloneEngine({ requested: 'screenshot' })).toThrow(/unknown_clone_engine/);
    expect(() => resolveCloneEngine({ requested: 'ITER9' })).toThrow(/unknown_clone_engine/);
  });
});
