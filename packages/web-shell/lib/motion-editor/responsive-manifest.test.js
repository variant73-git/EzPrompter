import { describe, expect, it } from 'vitest';
import {
  applyResponsiveManifestPatch,
  createResponsiveManifest,
  createResponsiveManifestPatch,
  parseResponsiveManifest,
  responsivePropertyKey,
  responsiveRuntimePatches,
  resolveResponsiveProperty,
  setResponsivePropertyMode,
  setResponsivePropertyValue,
  responsiveManifestForSettlement,
  withResponsiveMetadata,
} from './responsive-manifest.js';

const PROPERTY_KEY = responsivePropertyKey('hero', 'opacity');
const BINDING = {
  elementId: 'hero',
  kind: 'style',
  property: 'opacity',
};

describe('responsive property manifest', () => {
  it('keeps one shared value and resolves it for every device', () => {
    const manifest = setResponsivePropertyValue(createResponsiveManifest(), {
      propertyKey: PROPERTY_KEY,
      deviceId: 'desktop',
      value: '0.8',
      visibleValue: '0.8',
      binding: BINDING,
    });

    expect(manifest).toEqual({
      schemaVersion: 1,
      properties: {
        [PROPERTY_KEY]: {
          mode: 'shared',
          sharedValue: '0.8',
          overrides: {},
          provenance: 'inferred',
          binding: BINDING,
        },
      },
    });
    expect(resolveResponsiveProperty(manifest, {
      propertyKey: PROPERTY_KEY,
      deviceId: 'mobile',
      fallbackValue: '1',
    })).toMatchObject({ mode: 'shared', effectiveValue: '0.8', relevant: true });
  });

  it('creates only the active-device override and reconnects with the visible value', () => {
    let manifest = setResponsivePropertyMode(createResponsiveManifest(), {
      propertyKey: PROPERTY_KEY,
      mode: 'per-device',
      deviceId: 'desktop',
      visibleValue: '1',
      binding: BINDING,
    });
    manifest = setResponsivePropertyValue(manifest, {
      propertyKey: PROPERTY_KEY,
      deviceId: 'desktop',
      value: '0.6',
      visibleValue: '0.6',
      binding: BINDING,
    });

    expect(manifest.properties[PROPERTY_KEY]).toMatchObject({
      mode: 'per-device',
      sharedValue: '1',
      overrides: { desktop: '0.6' },
    });
    expect(resolveResponsiveProperty(manifest, {
      propertyKey: PROPERTY_KEY,
      deviceId: 'desktop',
      fallbackValue: '1',
    }).effectiveValue).toBe('0.6');
    expect(resolveResponsiveProperty(manifest, {
      propertyKey: PROPERTY_KEY,
      deviceId: 'tablet',
      fallbackValue: '1',
    }).effectiveValue).toBe('1');

    manifest = setResponsivePropertyMode(manifest, {
      propertyKey: PROPERTY_KEY,
      mode: 'shared',
      deviceId: 'desktop',
      visibleValue: '0.6',
      binding: BINDING,
    });
    expect(manifest.properties[PROPERTY_KEY]).toMatchObject({
      mode: 'shared',
      sharedValue: '0.6',
      overrides: {},
    });
  });

  it('keeps computed fields runtime-owned and limits them to declared devices', () => {
    const resolved = resolveResponsiveProperty(createResponsiveManifest(), {
      propertyKey: PROPERTY_KEY,
      deviceId: 'desktop',
      fallbackValue: '42px',
      descriptor: {
        mode: 'computed',
        provenance: 'runtime',
        devices: ['tablet', 'mobile'],
      },
    });

    expect(resolved).toMatchObject({
      mode: 'computed',
      provenance: 'runtime',
      relevant: false,
      effectiveValue: '42px',
    });
    expect(() => setResponsivePropertyValue(createResponsiveManifest(), {
      propertyKey: PROPERTY_KEY,
      deviceId: 'desktop',
      value: '20px',
      descriptor: { mode: 'computed' },
    })).toThrow(/computed/i);
  });

  it('uses responsive patches to make scope changes reversible in session history', () => {
    const before = null;
    const after = {
      mode: 'per-device',
      sharedValue: '1',
      overrides: { tablet: '1' },
      provenance: 'inferred',
      binding: BINDING,
    };
    const patch = createResponsiveManifestPatch({
      propertyKey: PROPERTY_KEY,
      elementId: 'hero',
      before,
      value: after,
    });

    const applied = applyResponsiveManifestPatch(createResponsiveManifest(), patch);
    expect(applied.properties[PROPERTY_KEY]).toEqual(after);
    const restored = applyResponsiveManifestPatch(applied, { ...patch, value: before });
    expect(restored.properties).toEqual({});
  });

  it('materializes only bindings with an effective value for the active device', () => {
    let manifest = setResponsivePropertyMode(createResponsiveManifest(), {
      propertyKey: PROPERTY_KEY,
      mode: 'per-device',
      deviceId: 'desktop',
      visibleValue: '1',
      binding: BINDING,
    });
    manifest = setResponsivePropertyValue(manifest, {
      propertyKey: PROPERTY_KEY,
      deviceId: 'desktop',
      value: '0.7',
      visibleValue: '0.7',
      binding: BINDING,
    });

    expect(responsiveRuntimePatches(manifest, 'desktop')).toEqual([
      expect.objectContaining({ elementId: 'hero', kind: 'style', property: 'opacity', value: '0.7' }),
    ]);
    expect(responsiveRuntimePatches(manifest, 'mobile')).toEqual([
      expect.objectContaining({ elementId: 'hero', kind: 'style', property: 'opacity', value: '1' }),
    ]);
  });

  it('rejects unknown modes, devices, unsafe keys, and executable values', () => {
    expect(() => parseResponsiveManifest({
      schemaVersion: 1,
      properties: { [PROPERTY_KEY]: { mode: 'fluid', sharedValue: '1', overrides: {} } },
    })).toThrow(/mode/i);
    expect(() => parseResponsiveManifest({
      schemaVersion: 1,
      properties: { [PROPERTY_KEY]: { mode: 'per-device', sharedValue: '1', overrides: { watch: '2' } } },
    })).toThrow(/device/i);
    expect(() => parseResponsiveManifest({
      schemaVersion: 1,
      properties: { [PROPERTY_KEY]: { mode: 'shared', sharedValue: () => '1', overrides: {} } },
    })).toThrow(/JSON/i);
  });
});

// Astra r5 #2 (2026-10-20): a confirmação aplicava o RETRATO da tabela tirado ao montar a edição; uma 2ª edição
// montada antes da 1ª confirmar apagava a 1ª ao reabrir. Agora cada confirmação aplica só a SUA mudança.
describe('tabela por tela na confirmação', () => {
  const base = () => setResponsivePropertyValue(createResponsiveManifest(), { propertyKey: responsivePropertyKey('u-a', 'width'), deviceId: 'desktop', value: '100px', descriptor: { mode: 'shared' } });
  const comMarca = (property, value, beforeEntry, afterEntry) => withResponsiveMetadata(
    { id: `p-${property}`, elementId: 'u-a', kind: 'style', property, before: '', value },
    { propertyKey: responsivePropertyKey('u-a', property), mode: 'shared', deviceId: 'desktop', beforeEntry, afterEntry },
  );
  it('duas edições montadas antes da 1ª confirmar não se apagam', () => {
    const inicial = base();
    const chaveW = responsivePropertyKey('u-a', 'width');
    const depoisA = setResponsivePropertyValue(inicial, { propertyKey: chaveW, deviceId: 'desktop', value: '150px', descriptor: { mode: 'shared' } });
    const a = { meta: { operation: 'apply' }, transaction: { patches: [comMarca('width', '150px', inicial.properties[chaveW], depoisA.properties[chaveW])] } };
    const chaveC = responsivePropertyKey('u-a', 'color');
    const depoisB = setResponsivePropertyValue(inicial, { propertyKey: chaveC, deviceId: 'desktop', value: 'red', descriptor: { mode: 'shared' } });
    const b = { meta: { operation: 'apply' }, transaction: { patches: [comMarca('color', 'red', null, depoisB.properties[chaveC])] } };
    let atual = responsiveManifestForSettlement(inicial, a);
    atual = responsiveManifestForSettlement(atual, b);
    expect(atual.properties[chaveW]).toEqual(depoisA.properties[chaveW]);
    expect(atual.properties[chaveC]).toEqual(depoisB.properties[chaveC]);
  });
  it('desfazer volta só a mudança daquela transação', () => {
    const inicial = base();
    const chaveW = responsivePropertyKey('u-a', 'width');
    const depoisA = setResponsivePropertyValue(inicial, { propertyKey: chaveW, deviceId: 'desktop', value: '150px', descriptor: { mode: 'shared' } });
    const patch = comMarca('width', '150px', inicial.properties[chaveW], depoisA.properties[chaveW]);
    const aplicado = responsiveManifestForSettlement(inicial, { meta: { operation: 'apply' }, transaction: { patches: [patch] } });
    const desfeito = responsiveManifestForSettlement(aplicado, { meta: { operation: 'undo' }, transaction: { patches: [patch] } });
    expect(desfeito.properties[chaveW]).toEqual(inicial.properties[chaveW]);
  });
});
