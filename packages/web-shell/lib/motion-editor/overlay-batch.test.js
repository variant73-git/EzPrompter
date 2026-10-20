import { describe, expect, it } from 'vitest';
import { buildOverlayBatch } from './overlay-batch.js';
import { createResponsiveManifest, parseResponsiveManifest, responsivePropertyKey, setResponsivePropertyValue, responsiveManifestAfterPatches } from './responsive-manifest.js';
import { responsivePropertyName } from './responsive-edit.js';

const chave = (el, prop) => responsivePropertyKey(el, responsivePropertyName(prop));
const comValor = (m, el, prop, value) => setResponsivePropertyValue(m, { propertyKey: chave(el, prop), deviceId: 'desktop', value, descriptor: { mode: 'shared' } });

describe('montador de lote da camada (spec 2026-10-20 §6.2.3)', () => {
  it('cada par elemento × propriedade leva a SUA chave e o SEU antes/depois (Astra r2 #1)', () => {
    let m = comValor(createResponsiveManifest(), 'u-a', 'width', '100px');
    m = comValor(m, 'u-a', 'height', '100px');
    const r = buildOverlayBatch({ manifest: m, deviceId: 'desktop', descriptorFor: () => null, changes: [
      { elementId: 'u-a', property: 'width', before: '100px', value: '150px' },
      { elementId: 'u-a', property: 'height', before: '100px', value: '200px' },
      { elementId: 'u-pai', property: 'overflow', before: '', value: 'visible' },
    ] });
    expect(r.ok).toBe(true);
    expect(r.patches.map((p) => p.responsive.propertyKey)).toEqual([chave('u-a', 'width'), chave('u-a', 'height'), chave('u-pai', 'overflow')]);
    expect(r.patches.map((p) => p.elementId)).toEqual(['u-a', 'u-a', 'u-pai']);
    // reabrir reconcilia a tabela DEPOIS dos patches: as duas medidas novas sobrevivem
    const reaberta = responsiveManifestAfterPatches(m, r.patches, 'forward');
    expect(reaberta.properties[chave('u-a', 'width')]).toEqual(r.nextManifest.properties[chave('u-a', 'width')]);
    expect(reaberta.properties[chave('u-a', 'height')]).toEqual(r.nextManifest.properties[chave('u-a', 'height')]);
    expect(r.nextManifest.properties[chave('u-a', 'height')].sharedValue).toBe('200px');
    expect(r.patches.every((p) => p.kind === 'style' && p.before !== undefined)).toBe(true);
  });
  it('propriedade em modo calculado recusa o lote inteiro', () => {
    const r = buildOverlayBatch({ manifest: createResponsiveManifest(), deviceId: 'desktop',
      descriptorFor: () => ({ mode: 'computed' }),
      changes: [{ elementId: 'u-a', property: 'width', before: '', value: '10px' }] });
    expect(r).toEqual({ ok: false, reason: 'computed_scope' });
  });
  it('lote vazio ou sem efeito é recusado', () => {
    expect(buildOverlayBatch({ manifest: null, deviceId: 'desktop', descriptorFor: () => null, changes: [] })).toEqual({ ok: false, reason: 'empty_batch' });
    expect(buildOverlayBatch({ manifest: null, deviceId: 'desktop', descriptorFor: () => null, changes: [{ elementId: 'u-a', property: 'width', before: '10px', value: '10px' }] })).toEqual({ ok: false, reason: 'no_effect' });
  });
  // Astra (Task 2): destravar e redimensionar podem escrever a MESMA largura duas vezes; o assentamento só lê a 1ª
  // ocorrência de cada chave — o lote tem que juntar por elemento × propriedade (1º antes, último valor)
  it('mudanças repetidas no mesmo elemento × propriedade viram UMA, e confirmar/desfazer batem com a tabela', () => {
    const r = buildOverlayBatch({ manifest: null, deviceId: 'desktop', descriptorFor: () => null, changes: [
      { elementId: 'u-a', property: 'width', before: '', value: '200px' },
      { elementId: 'u-a', property: 'width', before: '200px', value: '240px' },
    ] });
    expect(r.ok).toBe(true);
    expect(r.patches).toHaveLength(1);
    expect(r.patches[0]).toMatchObject({ before: '', value: '240px' });
    expect(responsiveManifestAfterPatches(null, r.patches, 'forward')).toEqual(r.nextManifest);
    expect(responsiveManifestAfterPatches(r.nextManifest, r.patches, 'backward')).toEqual(parseResponsiveManifest(createResponsiveManifest()));
  });
});
