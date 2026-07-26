import { describe, expect, it } from 'vitest';
import {
  createEmptyMotionManifest,
  parseMotionManifest,
  serializeMotionManifest,
} from './manifest.js';
import { createResponsiveManifestPatch } from './responsive-manifest.js';

const BUNDLE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_BUNDLE_ID = '22222222-2222-4222-8222-222222222222';
const RUNTIME_FINGERPRINT = `sha256:${'a'.repeat(64)}`;

function patch(overrides = {}) {
  return {
    id: 'patch-1',
    elementId: 'hero-title',
    kind: 'style',
    property: 'opacity',
    motionId: null,
    before: '0',
    value: '1',
    createdAt: '2026-07-26T10:00:00.000Z',
    ...overrides,
  };
}

describe('native motion manifest', () => {
  it('round-trips an empty version-2 manifest canonically', () => {
    const manifest = createEmptyMotionManifest({
      baseBundleId: BUNDLE_ID,
      runtimeFingerprint: RUNTIME_FINGERPRINT,
    });

    const serialized = serializeMotionManifest(manifest, { expectedBundleId: BUNDLE_ID });
    expect(parseMotionManifest(serialized, { expectedBundleId: BUNDLE_ID })).toEqual(manifest);
    expect(JSON.parse(serialized)).toEqual(manifest);
  });

  it('adapts a version-1 patch list deterministically', () => {
    const options = { baseBundleId: BUNDLE_ID, runtimeFingerprint: RUNTIME_FINGERPRINT };
    const first = parseMotionManifest([patch()], options);
    const second = parseMotionManifest([patch()], options);

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      schemaVersion: 2,
      baseBundleId: BUNDLE_ID,
      runtimeFingerprint: RUNTIME_FINGERPRINT,
      transactions: [{ source: 'properties', patches: [patch()], automaticRepairs: [] }],
    });
    expect(first.transactions[0].id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('keeps grouped legacy gestures and structured motion values intact', () => {
    const options = { baseBundleId: BUNDLE_ID, runtimeFingerprint: RUNTIME_FINGERPRINT };
    const legacy = [
      patch({
        id: 'keyframe-remove', kind: 'motion', property: 'keyframe.opacity', motionId: 'motion-1',
        groupId: 'gesture-1', before: { offset: 0.2, value: '0' }, value: { offset: 0.2, exists: false },
      }),
      patch({
        id: 'keyframe-add', kind: 'motion', property: 'keyframe.opacity', motionId: 'motion-1',
        groupId: 'gesture-1', before: { offset: 0.8, exists: false }, value: { offset: 0.8, value: '0' },
      }),
    ];

    const adapted = parseMotionManifest(legacy, options);
    expect(adapted.transactions).toHaveLength(1);
    expect(adapted.transactions[0]).toMatchObject({
      source: 'motion',
      patches: [
        { id: 'keyframe-remove', groupId: 'gesture-1', before: { offset: 0.2, value: '0' } },
        { id: 'keyframe-add', groupId: 'gesture-1', value: { offset: 0.8, value: '0' } },
      ],
    });
  });

  it('rejects a manifest anchored to a different snapshot bundle', () => {
    const manifest = createEmptyMotionManifest({
      baseBundleId: BUNDLE_ID,
      runtimeFingerprint: RUNTIME_FINGERPRINT,
    });
    expect(() => parseMotionManifest(manifest, { expectedBundleId: OTHER_BUNDLE_ID })).toThrow(/base bundle/i);
  });

  it('rejects unknown patch kinds instead of applying them loosely', () => {
    const manifest = {
      ...createEmptyMotionManifest({ baseBundleId: BUNDLE_ID, runtimeFingerprint: RUNTIME_FINGERPRINT }),
      transactions: [{
        id: '33333333-3333-4333-8333-333333333333',
        createdAt: '2026-07-26T10:00:00.000Z',
        source: 'properties',
        patches: [patch({ kind: 'execute-script' })],
        automaticRepairs: [],
      }],
    };
    expect(() => parseMotionManifest(manifest)).toThrow(/patch kind/i);
  });

  it('rejects unknown custom-control kinds', () => {
    const manifest = {
      ...createEmptyMotionManifest({ baseBundleId: BUNDLE_ID, runtimeFingerprint: RUNTIME_FINGERPRINT }),
      controlManifest: {
        schemaVersion: 1,
        runtimeFingerprint: RUNTIME_FINGERPRINT,
        controls: [{
          id: 'parallax-depth',
          controlType: 'execute-code',
          adapterKind: 'declarative',
          status: 'ready',
        }],
      },
    };
    expect(() => parseMotionManifest(manifest)).toThrow(/control type/i);
  });

  it('rejects non-JSON values without evaluating or silently dropping them', () => {
    const manifest = {
      ...createEmptyMotionManifest({ baseBundleId: BUNDLE_ID, runtimeFingerprint: RUNTIME_FINGERPRINT }),
      responsiveManifest: { desktop: { resolver: () => 'host-code' } },
    };
    expect(() => parseMotionManifest(manifest)).toThrow(/JSON values only/i);
  });

  it('strictly round-trips responsive state and host-side scope transactions', () => {
    const property = {
      mode: 'per-device',
      sharedValue: '1',
      overrides: { desktop: '0.6' },
      provenance: 'inferred',
      binding: { elementId: 'hero-title', kind: 'style', property: 'opacity' },
    };
    const manifest = {
      ...createEmptyMotionManifest({ baseBundleId: BUNDLE_ID, runtimeFingerprint: RUNTIME_FINGERPRINT }),
      responsiveManifest: {
        schemaVersion: 1,
        properties: { 'hero-title:opacity': property },
      },
      transactions: [{
        id: '33333333-3333-4333-8333-333333333333',
        createdAt: '2026-07-26T10:00:00.000Z',
        source: 'responsive',
        patches: [createResponsiveManifestPatch({
          id: 'responsive-1',
          elementId: 'hero-title',
          propertyKey: 'hero-title:opacity',
          before: null,
          value: property,
          createdAt: '2026-07-26T10:00:00.000Z',
        })],
        automaticRepairs: [],
      }],
    };

    expect(parseMotionManifest(serializeMotionManifest(manifest))).toEqual(manifest);
  });

  it('rejects malformed responsive state instead of accepting arbitrary JSON', () => {
    const manifest = {
      ...createEmptyMotionManifest({ baseBundleId: BUNDLE_ID, runtimeFingerprint: RUNTIME_FINGERPRINT }),
      responsiveManifest: {
        schemaVersion: 1,
        properties: {
          'hero-title:opacity': { mode: 'fluid', sharedValue: '1', overrides: {} },
        },
      },
    };
    expect(() => parseMotionManifest(manifest)).toThrow(/responsive.*mode/i);
  });
});
