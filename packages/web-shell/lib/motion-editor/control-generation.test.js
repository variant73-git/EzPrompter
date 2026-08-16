import { describe, expect, it, vi } from 'vitest';
import {
  CONTROL_GENERATION_MODEL,
  CONTROL_GENERATION_PROVIDER_CEILING_USD,
  buildMinimalMotionEvidence,
  generateControlProposals,
  generateControlsForReconstruction,
  generateValidatedControlManifest,
} from './control-generation.js';

const BUNDLE_ID = '11111111-1111-4111-8111-111111111111';
const RUNTIME_FINGERPRINT = `sha256:${'a'.repeat(64)}`;

function response(controls, usage = { input_tokens: 800, output_tokens: 500, input_tokens_details: { cached_tokens: 0 } }) {
  return {
    status: 'completed',
    output_text: JSON.stringify({ controls }),
    usage,
  };
}

function proposed(overrides = {}) {
  return {
    scope: 'animation',
    label: 'Parallax depth',
    description: 'Controls how far the layer travels while scrolling.',
    controlType: 'slider-number',
    unit: 'multiplier',
    currentValue: 1,
    originalValue: 1,
    targets: [{ semanticTargetId: 'hero-art', elementId: 'el-art', motionId: 'scroll-art', property: 'custom.depth' }],
    binding: { kind: 'custom-capability', capability: 'motion.scalar', property: 'depth' },
    domain: { min: 0, max: 2, step: 0.1 },
    teardown: { required: true, capability: 'motion.scalar.release' },
    limits: { executionMs: 500, mutationCount: 4, targetCount: 1, network: false },
    ...overrides,
  };
}

function validationTransport() {
  return vi.fn(async (stage, proposal, context) => {
    if (stage === 'read') return { ok: true, before: proposal.currentValue };
    if (stage === 'apply' || stage === 'reapply') {
      return {
        ok: true,
        value: context.value,
        effect: { changed: String(context.value) !== String(context.before) },
        mutations: 1,
      };
    }
    return {
      ok: true,
      restored: true,
      value: context.before,
      leaks: { listeners: 0, timers: 0, observers: 0 },
    };
  });
}

describe('custom control generation', () => {
  it('sends minimal redacted evidence through Responses Structured Outputs with storage disabled', async () => {
    const create = vi.fn(async () => response([proposed()]));
    const result = await generateControlProposals({
      client: { responses: { create } },
      evidence: {
        engines: ['gsap'],
        motions: [{ id: 'scroll-art', engine: 'GSAP', properties: ['x'], label: 'Hero art' }],
        cookies: 'session=secret',
        authorization: 'Bearer secret',
        localStorage: { token: 'secret' },
        pageText: 'unrelated private copy',
        formValues: { email: 'person@example.com' },
      },
      remainingGaps: [{ semanticTargetId: 'hero-art', motionId: 'scroll-art', properties: ['x'] }],
    });

    expect(result.proposals).toHaveLength(1);
    const request = create.mock.calls[0][0];
    expect(request).toMatchObject({
      model: CONTROL_GENERATION_MODEL,
      store: false,
      reasoning: { effort: 'medium' },
      text: { format: { type: 'json_schema', strict: true } },
    });
    const serialized = JSON.stringify(request.input);
    expect(serialized).not.toMatch(/session=secret|Bearer secret|person@example\.com|unrelated private copy/);
  });

  it('fails closed for private evidence without approved ZDR', async () => {
    const create = vi.fn();
    await expect(generateControlProposals({
      client: { responses: { create } },
      evidence: { privateCapture: true, engines: ['gsap'] },
      remainingGaps: [],
    })).rejects.toMatchObject({ code: 'zdr_required' });
    expect(create).not.toHaveBeenCalled();
  });

  it('performs one automatic repair for invalid output and never a third model call', async () => {
    const create = vi.fn()
      .mockResolvedValueOnce(response([{ ...proposed(), binding: { kind: 'custom-capability', capability: 'motion.scalar', code: 'evil()' } }]))
      .mockResolvedValueOnce(response([proposed({ label: 'Depth' })]));
    const result = await generateControlProposals({
      client: { responses: { create } }, evidence: { engines: ['custom'] }, remainingGaps: [{ semanticTargetId: 'hero-art' }],
    });
    expect(result.proposals[0].label).toBe('Depth');
    expect(result.repaired).toBe(true);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('enforces the cumulative provider-cost ceiling and deadline', async () => {
    const expensive = response([proposed()], { input_tokens: 50000, output_tokens: 10000, input_tokens_details: { cached_tokens: 0 } });
    await expect(generateControlProposals({
      client: { responses: { create: vi.fn(async () => expensive) } },
      evidence: { engines: ['custom'] },
      remainingGaps: [{ semanticTargetId: 'hero-art' }],
    })).rejects.toMatchObject({ code: 'provider_cost_ceiling' });

    const abortingClient = { responses: { create: vi.fn((_request, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    })) } };
    await expect(generateControlProposals({
      client: abortingClient, evidence: { engines: ['custom'] }, remainingGaps: [], timeoutMs: 1,
    })).rejects.toMatchObject({ code: 'provider_timeout' });
    expect(CONTROL_GENERATION_PROVIDER_CEILING_USD).toBe(0.25);
  });

  it('skips the provider when deterministic controls are sufficient', async () => {
    const create = vi.fn();
    const validateCandidate = vi.fn(async (candidate) => ({ accepted: true, control: candidate }));
    const result = await generateValidatedControlManifest({
      bundleId: BUNDLE_ID,
      runtimeFingerprint: RUNTIME_FINGERPRINT,
      candidates: [
        { id: 'one', binding: { kind: 'typed-command', command: 'motion.set', property: 'timing.duration' } },
        { id: 'two', binding: { kind: 'known-runtime', engine: 'gsap', property: 'scroll.scrub' } },
        { id: 'three', binding: { kind: 'dom-attribute', attribute: 'data-speed' } },
      ],
      client: { responses: { create } },
      validateCandidate,
    });
    expect(create).not.toHaveBeenCalled();
    expect(result.provider).toBeNull();
  });

  it('returns only accepted ready controls and keeps rejected decisions in sanitized diagnostics', async () => {
    const validateCandidate = vi.fn(async (candidate) => candidate.label === 'Bad'
      ? { accepted: false, code: 'no_effect' }
      : { accepted: true, control: {
        ...candidate,
        id: candidate.id || 'control-1234567890abcdef12345678',
        ladder: candidate.ladder || 'custom-adapter',
        bundleId: BUNDLE_ID,
        runtimeFingerprint: RUNTIME_FINGERPRINT,
        compatibleLineage: [{ bundleId: BUNDLE_ID, runtimeFingerprint: RUNTIME_FINGERPRINT }],
        validation: { schema: 'passed', read: 'passed', apply: 'passed', effect: 'passed', restore: 'passed', deterministic: 'passed', teardown: 'passed', fingerprint: 'passed', validatedAt: '2026-07-26T12:00:00.000Z' },
        provenance: { source: 'model', engine: 'custom', decisionCode: 'custom_validated' },
        status: 'ready',
      } });
    const create = vi.fn(async () => response([proposed({ label: 'Good' }), proposed({ label: 'Bad' })]));
    const result = await generateValidatedControlManifest({
      bundleId: BUNDLE_ID,
      runtimeFingerprint: RUNTIME_FINGERPRINT,
      detectedEngines: ['custom'],
      candidates: [],
      evidence: { engines: ['custom'] },
      remainingGaps: [{ semanticTargetId: 'hero-art' }],
      client: { responses: { create } },
      validateCandidate,
    });
    expect(result.manifest.controls.map((control) => control.label)).toEqual(['Good']);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'no_effect' }));
    expect(JSON.stringify(result)).not.toMatch(/rawResponse|prompt/);
  });

  it('bounds and normalizes evidence before it reaches the provider', () => {
    const evidence = buildMinimalMotionEvidence({
      engines: ['gsap', 'gsap'],
      motions: Array.from({ length: 500 }, (_, index) => ({ id: `m-${index}`, engine: 'GSAP', properties: ['x', 'opacity'], label: `Motion ${index}` })),
      html: '<html>private</html>',
    });
    expect(evidence.engines).toEqual(['gsap']);
    expect(evidence.motions.length).toBeLessThanOrEqual(120);
    expect(evidence).not.toHaveProperty('html');
    expect(JSON.stringify(evidence).length).toBeLessThan(32 * 1024);
  });

  it('automatically generates and validates remaining custom controls during reconstruction', async () => {
    const create = vi.fn(async () => response([proposed()]));
    const clientFactory = vi.fn(async () => ({ responses: { create } }));
    const onUsage = vi.fn();
    const result = await generateControlsForReconstruction({
      descriptor: {
        bundleId: BUNDLE_ID,
        runtimeFingerprint: RUNTIME_FINGERPRINT,
        reconstructionCapabilities: { detectedEngines: ['custom'], candidateControls: [] },
      },
      reconstructionOutput: {
        motionEvidence: { motions: [{ id: 'scroll-art', elementId: 'el-art', properties: ['depth'] }] },
      },
      apiKey: 'sk-test',
      clientFactory,
      validationTransport: validationTransport(),
      onUsage,
    });

    expect(clientFactory).toHaveBeenCalledWith({ apiKey: 'sk-test' });
    expect(create).toHaveBeenCalledTimes(1);
    expect(result.manifest.controls).toHaveLength(1);
    expect(result.manifest.controls[0]).toMatchObject({ status: 'ready', ladder: 'custom-adapter', label: 'Parallax depth' });
    expect(onUsage).toHaveBeenCalledTimes(1);
  });

  it('keeps private captures on the validated deterministic ladder without contacting the provider', async () => {
    const clientFactory = vi.fn();
    const result = await generateControlsForReconstruction({
      descriptor: {
        bundleId: BUNDLE_ID,
        runtimeFingerprint: RUNTIME_FINGERPRINT,
        reconstructionCapabilities: {
          detectedEngines: ['waapi'],
          candidateControls: [{
            id: 'duration', label: 'Duration', property: 'timing.duration', currentValue: 800,
            binding: { kind: 'typed-command', command: 'motion.set', property: 'timing.duration' },
            semanticTargetId: 'hero', elementId: 'el-hero', motionId: 'motion-hero',
          }],
        },
      },
      reconstructionOutput: { privateCapture: true },
      apiKey: 'sk-test',
      clientFactory,
      validationTransport: validationTransport(),
      zdrApproved: false,
    });

    expect(clientFactory).not.toHaveBeenCalled();
    expect(result.provider).toBeNull();
    expect(result.manifest.controls).toHaveLength(1);
  });
});
