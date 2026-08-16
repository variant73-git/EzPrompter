import { describe, expect, it, vi } from 'vitest';
import {
  createMotionSmokeRunner,
  fingerprintSmokeFixture,
  summarizeSmokeEvidence,
  validateSmokeMatrix,
} from './smoke-runner.js';

const BUNDLE_ID = '11111111-1111-4111-8111-111111111111';
const RUNTIME_FINGERPRINT = `sha256:${'a'.repeat(64)}`;

function candidate(overrides = {}) {
  return {
    id: 'control-aaaaaaaaaaaaaaaaaaaaaaaa',
    scope: 'animation',
    label: 'Motion intensity',
    description: 'Controls the visible travel distance.',
    controlType: 'slider-number',
    unit: 'multiplier',
    currentValue: 1,
    originalValue: 1,
    targets: [{
      semanticTargetId: 'hero-art',
      elementId: 'el-hero-art',
      motionId: 'waapi-hero-art',
      property: 'custom.intensity',
    }],
    binding: {
      kind: 'custom-capability',
      capability: 'motion.scalar',
      property: 'custom.intensity',
    },
    domain: { min: 0, max: 2, step: 1 },
    teardown: { required: true, capability: 'motion.scalar.release' },
    limits: { executionMs: 500, mutationCount: 4, targetCount: 1, network: false },
    ladder: 'custom-adapter',
    runtimeFingerprint: RUNTIME_FINGERPRINT,
    ...overrides,
  };
}

function successfulTransport() {
  let value = 1;
  return vi.fn(async (stage, _proposal, context) => {
    if (stage === 'read') return { ok: true, before: value };
    if (stage === 'apply' || stage === 'reapply') {
      value = context.value;
      return {
        ok: true,
        value,
        mutations: 1,
        effect: { changed: value !== context.before },
        visualOracle: {
          changed: value !== context.before,
          kind: 'computed-style',
          beforeFingerprint: 'sha256:1111111111111111',
          afterFingerprint: `sha256:${String(value).replace('.', '')}222222222222222`,
        },
        semanticCoverage: {
          declaredTargetIds: ['hero-art'],
          affectedTargetIds: ['hero-art'],
          unhandledTargetIds: [],
        },
      };
    }
    value = context.before;
    return {
      ok: true,
      restored: true,
      value,
      leaks: { listeners: 0, timers: 0, observers: 0 },
      restoreEvidence: {
        restored: true,
        kind: 'computed-style',
        beforeFingerprint: 'sha256:1111111111111111',
        restoredFingerprint: 'sha256:1111111111111111',
      },
    };
  });
}

function matrix(overrides = {}) {
  return {
    schemaVersion: 1,
    buildVersion: 'task-15-test',
    devices: [{ id: 'desktop', width: 1280, height: 800 }],
    availableFamilies: [{ producer: 'fixture', runtime: 'browser-native' }],
    fixtures: [{
      id: 'waapi-finite',
      kind: 'deterministic',
      fixtureClasses: ['waapi'],
      producerFamily: 'fixture',
      runtimeFamily: 'browser-native',
      siteClass: 'fixture-waapi',
      offline: true,
      bundleId: BUNDLE_ID,
      runtimeFingerprint: RUNTIME_FINGERPRINT,
      buildFingerprint: `sha256:${'b'.repeat(64)}`,
    }],
    ...overrides,
  };
}

function runtime(overrides = {}) {
  return {
    gateway: { signed: true, verified: true },
    bridge: { protocol: 'uncraft-motion-editor/v2' },
    candidates: [candidate()],
    renderedControlIds: ['control-aaaaaaaaaaaaaaaaaaaaaaaa'],
    createValidationTransport: () => successfulTransport(),
    runSessionCommand: vi.fn(async () => ({ acknowledged: true, persistentPatches: 0 })),
    close: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('motion control smoke runner', () => {
  it('uses the signed gateway, protocol-v2 bridge, product validator, and sanitized smoke sink', async () => {
    const persistEvents = vi.fn(async () => {});
    const openRuntime = vi.fn(async () => runtime());
    const report = await createMotionSmokeRunner({
      openRuntime,
      persistEvents,
      now: () => new Date('2026-07-27T12:00:00.000Z'),
    }).run(matrix());

    expect(openRuntime).toHaveBeenCalledWith(expect.objectContaining({
      device: { id: 'desktop', width: 1280, height: 800 },
      fixture: expect.objectContaining({ id: 'waapi-finite' }),
    }));
    expect(report.summary).toMatchObject({
      candidatesDiscovered: 1,
      controlsRenderedAutomatically: 1,
      initialValidationSuccess: 1,
      applySuccess: 1,
      visibleEffectSuccess: 1,
      restoreSuccess: 1,
      exhaustedFailures: 0,
      disabledControls: 0,
    });
    expect(report.sessionCommands).toEqual(expect.arrayContaining([
      expect.objectContaining({ command: 'play', persistentPatches: 0 }),
      expect.objectContaining({ command: 'pause', persistentPatches: 0 }),
      expect.objectContaining({ command: 'scrub', persistentPatches: 0 }),
    ]));
    expect(persistEvents).toHaveBeenCalled();
    expect(persistEvents.mock.calls.flatMap(([events]) => events)).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'smoke', origin: 'smoke', transition: 'control-ready' }),
    ]));
  });

  it('refuses command acknowledgement without visible/computed effect and restoration evidence', async () => {
    const acknowledgementOnly = vi.fn(async (stage, proposal, context) => {
      if (stage === 'read') return { ok: true, before: proposal.currentValue };
      if (stage === 'apply' || stage === 'reapply') {
        return { ok: true, value: context.value, effect: { changed: true }, mutations: 1 };
      }
      return { ok: true, restored: true, value: context.before, leaks: {} };
    });
    const report = await createMotionSmokeRunner({
      openRuntime: async () => runtime({ createValidationTransport: () => acknowledgementOnly }),
      now: () => new Date('2026-07-27T12:00:00.000Z'),
    }).run(matrix());

    expect(report.summary.initialValidationSuccess).toBe(0);
    expect(report.results[0]).toMatchObject({
      finalOutcome: 'disabled',
      failureCode: 'visible_evidence_missing',
    });
  });

  it('fails a site semantic promise when any declared target remains unhandled', async () => {
    const siteCandidate = candidate({
      scope: 'site',
      targets: [
        { semanticTargetId: 'hero-art', elementId: 'el-hero-art', motionId: 'waapi-hero-art', property: 'custom.intensity' },
        { semanticTargetId: 'shader-canvas', elementId: 'el-shader', motionId: 'custom-shader', property: 'custom.intensity' },
      ],
      limits: { executionMs: 500, mutationCount: 8, targetCount: 2, network: false },
    });
    const transport = successfulTransport();
    const original = transport.getMockImplementation();
    transport.mockImplementation(async (stage, proposal, context) => {
      const base = await original(stage, proposal, context);
      if (stage === 'apply' || stage === 'reapply') {
        base.semanticCoverage = {
          declaredTargetIds: ['hero-art', 'shader-canvas'],
          affectedTargetIds: ['hero-art'],
          unhandledTargetIds: ['shader-canvas'],
        };
      }
      return base;
    });
    const report = await createMotionSmokeRunner({
      openRuntime: async () => runtime({
        candidates: [siteCandidate],
        createValidationTransport: () => transport,
      }),
      now: () => new Date('2026-07-27T12:00:00.000Z'),
    }).run(matrix());

    expect(report.results[0]).toMatchObject({
      finalOutcome: 'disabled',
      failureCode: 'semantic_promise_incomplete',
    });
  });

  it('rejects unverified runtimes and offline fixtures that attempt external network access', async () => {
    const runner = createMotionSmokeRunner({
      openRuntime: async () => runtime({
        gateway: { signed: true, verified: false },
        externalRequests: ['https://tracker.example/pixel'],
      }),
    });
    await expect(runner.run(matrix())).rejects.toMatchObject({ code: 'untrusted_smoke_runtime' });

    const offlineRunner = createMotionSmokeRunner({
      openRuntime: async () => runtime({ externalRequests: ['https://tracker.example/pixel'] }),
    });
    await expect(offlineRunner.run(matrix())).rejects.toMatchObject({ code: 'offline_network_access' });
  });

  it('keeps fixture fingerprints comparable while preserving every run as separate evidence', async () => {
    const fixture = matrix().fixtures[0];
    expect(fingerprintSmokeFixture(fixture)).toBe(fingerprintSmokeFixture({ ...fixture }));
    expect(fingerprintSmokeFixture({ ...fixture, root: '/checkout/one', html: '<private>one</private>' }))
      .toBe(fingerprintSmokeFixture({ ...fixture, root: '/checkout/two', html: '<private>two</private>' }));

    let timestamp = 0;
    const runner = createMotionSmokeRunner({
      openRuntime: async () => runtime(),
      now: () => new Date(1_700_000_000_000 + timestamp++),
    });
    const first = await runner.run(matrix());
    const second = await runner.run(matrix());

    expect(first.matrixFingerprint).toBe(second.matrixFingerprint);
    expect(first.runId).not.toBe(second.runId);
  });

  it('keeps diagnostic persistence fail-open and reports the trusted write gap', async () => {
    const report = await createMotionSmokeRunner({
      openRuntime: async () => runtime(),
      persistEvents: async () => { throw new Error('diagnostic store unavailable'); },
    }).run(matrix());

    expect(report.summary.supported).toBe(1);
    expect(report.diagnosticWriteFailures).toEqual([{ fixtureId: 'waapi-finite', device: 'desktop' }]);
  });

  it('reports distribution gaps and leaves manual false-positive review explicitly unresolved', () => {
    const checked = validateSmokeMatrix(matrix({
      availableFamilies: [
        { producer: 'fixture', runtime: 'browser-native' },
        { producer: 'reconstructor-v2', runtime: 'gsap' },
      ],
    }));
    expect(checked.coverage.missingRealCloneFamilies).toEqual(['reconstructor-v2:gsap']);

    const summary = summarizeSmokeEvidence([
      { siteId: 'a', controlId: 'speed', finalOutcome: 'supported', manualReview: null, durationMs: 20 },
      { siteId: 'b', controlId: 'speed', finalOutcome: 'disabled', manualReview: null, durationMs: 40 },
    ]);
    expect(summary.disabledControlIncidence).toBe(0.5);
    expect(summary.perSiteDisabledIncidence).toBe(0.5);
    expect(summary.falsePositiveRate).toBeNull();
    expect(summary.manualReviewStatus).toBe('pending');
  });
});
