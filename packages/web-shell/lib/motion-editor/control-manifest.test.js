import { describe, expect, it } from 'vitest';
import {
  CONTROL_MANIFEST_SCHEMA_VERSION,
  CONTROL_PROPOSAL_JSON_SCHEMA,
  createControlManifest,
  createStableControlId,
  parseControlManifest,
  serializeControlManifest,
} from './control-manifest.js';

const BUNDLE_ID = '11111111-1111-4111-8111-111111111111';
const RUNTIME_FINGERPRINT = `sha256:${'a'.repeat(64)}`;

function readyControl(overrides = {}) {
  return {
    id: 'control-0f2af8a0b3a35c4e3c0a9c4b',
    ladder: 'direct',
    scope: 'animation',
    label: 'Duration',
    description: 'Controls how long the animation takes.',
    controlType: 'slider-number',
    unit: 'ms',
    currentValue: 800,
    originalValue: 800,
    targets: [{ semanticTargetId: 'hero', elementId: 'el-hero', motionId: 'motion-hero', property: 'timing.duration' }],
    binding: { kind: 'typed-command', command: 'motion.set', property: 'timing.duration' },
    domain: { min: 100, max: 4000, step: 50 },
    bundleId: BUNDLE_ID,
    runtimeFingerprint: RUNTIME_FINGERPRINT,
    compatibleLineage: [{ bundleId: BUNDLE_ID, runtimeFingerprint: RUNTIME_FINGERPRINT }],
    validation: {
      schema: 'passed', read: 'passed', apply: 'passed', effect: 'passed',
      restore: 'passed', deterministic: 'passed', teardown: 'passed', fingerprint: 'passed',
      validatedAt: '2026-07-26T12:00:00.000Z',
    },
    provenance: { source: 'runtime', engine: 'waapi', decisionCode: 'direct_timing' },
    teardown: { required: false, capability: null },
    limits: { executionMs: 500, mutationCount: 2, targetCount: 1, network: false },
    status: 'ready',
    ...overrides,
  };
}

describe('control manifest', () => {
  it('round-trips a strict ready manifest canonically', () => {
    const manifest = createControlManifest({
      bundleId: BUNDLE_ID,
      runtimeFingerprint: RUNTIME_FINGERPRINT,
      controls: [readyControl()],
    });

    expect(manifest.schemaVersion).toBe(CONTROL_MANIFEST_SCHEMA_VERSION);
    expect(parseControlManifest(serializeControlManifest(manifest))).toEqual(manifest);
  });

  it('derives a stable ID from semantic identity rather than current values', () => {
    const identity = {
      ladder: 'known-library',
      scope: 'animation',
      targets: [{ semanticTargetId: 'hero', motionId: 'intro', property: 'scroll.scrub' }],
      binding: { kind: 'known-runtime', engine: 'gsap', property: 'scroll.scrub' },
    };
    const first = createStableControlId({ ...identity, currentValue: true });
    const second = createStableControlId({ ...identity, currentValue: false, label: 'Anything' });
    expect(first).toBe(second);
    expect(first).toMatch(/^control-[0-9a-f]{24}$/);
  });

  it.each([
    ['free text', { controlType: 'text', domain: {} }],
    ['arbitrary JSON', { controlType: 'json', domain: {} }],
    ['array value', { currentValue: [1], originalValue: [1] }],
    ['arbitrary color', { controlType: 'color', currentValue: 'oklch(70% .2 30)', originalValue: '#eea665', domain: {} }],
    ['raw adapter source', { binding: { kind: 'custom-capability', capability: 'motion.scalar', code: 'window.alert(1)' } }],
    ['undeclared selector', { binding: { kind: 'dom-attribute', selector: '*', attribute: 'data-speed' } }],
    ['unsafe key', { binding: JSON.parse('{"kind":"typed-command","command":"motion.set","constructor":"escape"}') }],
    ['non-finite value', { currentValue: Number.POSITIVE_INFINITY }],
  ])('rejects %s from the primary catalog', (_label, override) => {
    expect(() => createControlManifest({
      bundleId: BUNDLE_ID,
      runtimeFingerprint: RUNTIME_FINGERPRINT,
      controls: [readyControl(override)],
    })).toThrow();
  });

  it('rejects pending, disabled, or incompletely validated controls from persisted ready manifests', () => {
    for (const control of [
      readyControl({ status: 'pending' }),
      readyControl({ status: 'disabled' }),
      readyControl({ validation: { ...readyControl().validation, restore: 'failed' } }),
    ]) {
      expect(() => createControlManifest({
        bundleId: BUNDLE_ID,
        runtimeFingerprint: RUNTIME_FINGERPRINT,
        controls: [control],
      })).toThrow();
    }
  });

  it('limits controls to five per animation or group scope', () => {
    const controls = Array.from({ length: 6 }, (_, index) => readyControl({
      id: `control-${String(index).padStart(24, '0')}`,
      targets: [{ semanticTargetId: 'hero', elementId: 'el-hero', motionId: 'motion-hero', property: `custom.${index}` }],
      binding: { kind: 'typed-command', command: 'motion.set', property: `custom.${index}` },
    }));
    expect(() => createControlManifest({ bundleId: BUNDLE_ID, runtimeFingerprint: RUNTIME_FINGERPRINT, controls })).toThrow(/five/i);
  });

  it('requires complete target declarations before group or site scope can persist', () => {
    expect(() => createControlManifest({
      bundleId: BUNDLE_ID,
      runtimeFingerprint: RUNTIME_FINGERPRINT,
      controls: [readyControl({ scope: 'site', targets: [{ semanticTargetId: 'site', property: 'speed' }] })],
    })).toThrow(/target/i);
  });

  it('exports a strict Structured Outputs schema with no raw code field', () => {
    expect(CONTROL_PROPOSAL_JSON_SCHEMA.additionalProperties).toBe(false);
    expect(CONTROL_PROPOSAL_JSON_SCHEMA.properties.controls.maxItems).toBe(5);
    expect(CONTROL_PROPOSAL_JSON_SCHEMA.properties.controls.minItems).toBe(1);
    const schema = JSON.stringify(CONTROL_PROPOSAL_JSON_SCHEMA);
    expect(schema).toContain('"additionalProperties":false');
    expect(JSON.stringify(CONTROL_PROPOSAL_JSON_SCHEMA)).not.toMatch(/"code"|"source"|"selector"/);
  });
});
