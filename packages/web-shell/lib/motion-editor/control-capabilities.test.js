import { describe, expect, it, vi } from 'vitest';
import {
  CONTROL_LADDER,
  classifyControlCandidates,
  createRuntimeControlValidator,
  needsCustomGeneration,
} from './control-capabilities.js';

const BUNDLE_ID = '11111111-1111-4111-8111-111111111111';
const RUNTIME_FINGERPRINT = `sha256:${'a'.repeat(64)}`;

function candidate(overrides = {}) {
  return {
    id: 'duration',
    label: 'Duration',
    description: 'Controls how long the animation takes.',
    scope: 'animation',
    semanticTargetId: 'hero',
    elementId: 'el-hero',
    motionId: 'motion-hero',
    property: 'timing.duration',
    controlType: 'slider-number',
    unit: 'ms',
    currentValue: 800,
    originalValue: 800,
    domain: { min: 100, max: 4000, step: 50 },
    ...overrides,
  };
}

describe('control capability ladder', () => {
  it('classifies Direct, Known Library, Declarative, and Code Only deterministically in fixed order', () => {
    const result = classifyControlCandidates({
      bundleId: BUNDLE_ID,
      runtimeFingerprint: RUNTIME_FINGERPRINT,
      detectedEngines: ['gsap', 'scrolltrigger', 'waapi'],
      candidates: [
        candidate({ id: 'unknown', binding: { kind: 'opaque-runtime' } }),
        candidate({ id: 'declarative', property: 'speed', binding: { kind: 'dom-attribute', attribute: 'data-speed' } }),
        candidate({ id: 'known', property: 'scroll.scrub', binding: { kind: 'known-runtime', engine: 'gsap', property: 'scroll.scrub' } }),
        candidate({ id: 'direct', binding: { kind: 'typed-command', command: 'motion.set', property: 'timing.duration' } }),
      ],
    });

    expect(result.map((item) => item.ladder)).toEqual([
      CONTROL_LADDER.DIRECT,
      CONTROL_LADDER.KNOWN,
      CONTROL_LADDER.DECLARATIVE,
      CONTROL_LADDER.CODE,
    ]);
  });

  it.each([
    ['GSAP', { binding: { kind: 'known-runtime', engine: 'gsap', property: 'timing.duration' } }, 'known-library'],
    ['ScrollTrigger', { binding: { kind: 'known-runtime', engine: 'scrolltrigger', property: 'scroll.start' } }, 'known-library'],
    ['CSS keyframes', { binding: { kind: 'typed-command', command: 'motion.set', property: 'timing.duration' }, engine: 'css' }, 'direct'],
    ['WAAPI', { binding: { kind: 'typed-command', command: 'motion.set', property: 'timing.easing' }, engine: 'waapi' }, 'direct'],
    ['unknown runtime', { binding: { kind: 'opaque-runtime' }, engine: 'mystery' }, 'code-only'],
  ])('classifies the %s fixture without guessing past its evidence', (_name, fixture, expected) => {
    const [classified] = classifyControlCandidates({
      bundleId: BUNDLE_ID,
      runtimeFingerprint: RUNTIME_FINGERPRINT,
      detectedEngines: ['gsap', 'scrolltrigger', 'css', 'waapi'],
      candidates: [candidate(fixture)],
    });
    expect(classified.ladder).toBe(expected);
  });

  it('does not call custom generation when three useful deterministic controls are available', () => {
    expect(needsCustomGeneration([
      { ladder: 'direct' }, { ladder: 'known-library' }, { ladder: 'declarative-adapter' },
    ])).toBe(false);
    expect(needsCustomGeneration([{ ladder: 'direct' }])).toBe(true);
  });

  it('runs every validation stage and accepts only a complete reversible deterministic result', async () => {
    const transport = vi.fn(async (stage, _proposal, context) => {
      if (stage === 'read') return { ok: true, before: 800 };
      if (stage === 'apply' || stage === 'reapply') return { ok: true, value: context.value, effect: { changed: true }, mutations: 1 };
      return { ok: true, restored: true, value: 800, leaks: { listeners: 0, timers: 0, observers: 0 } };
    });
    const validate = createRuntimeControlValidator({ transport, now: () => new Date('2026-07-26T12:00:00.000Z') });
    const result = await validate(candidate({ binding: { kind: 'typed-command', command: 'motion.set', property: 'timing.duration' } }), {
      bundleId: BUNDLE_ID,
      runtimeFingerprint: RUNTIME_FINGERPRINT,
    });

    expect(result.accepted).toBe(true);
    expect(result.control.status).toBe('ready');
    expect(result.control.validation).toMatchObject({
      read: 'passed', apply: 'passed', effect: 'passed', restore: 'passed',
      deterministic: 'passed', teardown: 'passed', fingerprint: 'passed',
    });
    expect(transport.mock.calls.map(([stage]) => stage)).toEqual([
      'read',
      'apply', 'restore', 'reapply', 'final-restore',
      'apply', 'restore', 'reapply', 'final-restore',
      'apply', 'restore', 'reapply', 'final-restore',
    ]);
  });

  it('validates every curated option and accepts a localized visual oracle when runtime state cannot observe the effect', async () => {
    const transport = vi.fn(async (stage, proposal, context) => {
      if (stage === 'read') return { ok: true, before: 'soft' };
      if (stage === 'apply' || stage === 'reapply') {
        return { ok: true, value: context.value, effect: { changed: false }, visualOracle: { changed: context.value !== 'soft' } };
      }
      return { ok: true, restored: true, value: 'soft', leaks: {} };
    });
    const validate = createRuntimeControlValidator({ transport });
    const result = await validate(candidate({
      controlType: 'select',
      unit: 'number',
      currentValue: 'soft',
      originalValue: 'soft',
      domain: { options: [
        { label: 'Soft', value: 'soft' },
        { label: 'Balanced', value: 'balanced' },
        { label: 'Strong', value: 'strong' },
      ] },
      binding: { kind: 'typed-command', command: 'motion.set', property: 'motion.preset' },
    }), { bundleId: BUNDLE_ID, runtimeFingerprint: RUNTIME_FINGERPRINT });

    expect(result).toMatchObject({ accepted: true, control: { validation: { visualOracle: 'passed' } } });
    expect(transport.mock.calls.filter(([stage]) => stage === 'apply').map(([, , context]) => context.value))
      .toEqual(['soft', 'balanced', 'strong']);
  });

  it.each([
    ['unreadable before', [{ ok: false, code: 'read_failed' }], 'read_failed'],
    ['no effect', [{ ok: true, before: 1 }, { ok: true, value: 2, effect: { changed: false } }], 'no_effect'],
    ['cross-target mutation', [{ ok: true, before: 1 }, { ok: true, value: 2, effect: { changed: true }, outsideTargets: ['other'] }], 'scope_escape'],
    ['incomplete restore', [{ ok: true, before: 1 }, { ok: true, value: 2, effect: { changed: true } }, { ok: true, restored: false }], 'restore_failed'],
    ['non-deterministic adapter', [{ ok: true, before: 1 }, { ok: true, value: 2, effect: { changed: true } }, { ok: true, restored: true, value: 1 }, { ok: true, value: 3, effect: { changed: true } }], 'non_deterministic'],
  ])('rejects %s silently with a sanitized decision code', async (_label, replies, code) => {
    const transport = vi.fn();
    replies.forEach((reply) => transport.mockResolvedValueOnce(reply));
    const validate = createRuntimeControlValidator({ transport });
    const result = await validate(candidate({ binding: { kind: 'typed-command', command: 'motion.set', property: 'timing.duration' } }), {
      bundleId: BUNDLE_ID,
      runtimeFingerprint: RUNTIME_FINGERPRINT,
    });
    expect(result).toMatchObject({ accepted: false, code });
    expect(result).not.toHaveProperty('control');
  });

  it('rejects a runtime fingerprint mismatch before invoking the runtime', async () => {
    const transport = vi.fn();
    const validate = createRuntimeControlValidator({ transport });
    const result = await validate(candidate({
      runtimeFingerprint: `sha256:${'b'.repeat(64)}`,
      binding: { kind: 'typed-command', command: 'motion.set', property: 'timing.duration' },
    }), { bundleId: BUNDLE_ID, runtimeFingerprint: RUNTIME_FINGERPRINT });
    expect(result).toMatchObject({ accepted: false, code: 'fingerprint_mismatch' });
    expect(transport).not.toHaveBeenCalled();
  });
});
