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
