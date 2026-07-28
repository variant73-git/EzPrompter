// Task 16 fixture — the RICH primary-node motion manifest (v2).
//
// Encodes the fixture-contract characteristics the seed CAN carry statically:
//   • exactly ONE fully-valid status:'ready' accepted custom control (all 8
//     validation stages passed, lineage pinned to this bundle+fingerprint,
//     targetCount === targets.length, network:false), and
//   • a responsive binding with a per-device value on desktop/tablet/mobile.
//
// It CANNOT carry fault controls: control-manifest.js only admits status:'ready'
// controls (exactKeys rejects any recovery/disabled field). The recoverable and
// exhausted fault PRESENTATION is a pure runtime overlay (controlAvailability /
// recoveryStatus in useNativeMotionController.js) driven live via the Task 6a
// fault-injection seam in Task 14 — never encoded here.
//
// The shape below was proven to survive parseMotionManifest (the same strict
// re-validation openOrResumeEditSession runs on load) and its idempotent re-parse.
import { parseMotionManifest } from '../../../lib/motion-editor/manifest.js';
import { createStableControlId } from '../../../lib/motion-editor/control-manifest.js';

// A frozen timestamp keeps the manifest byte-deterministic across seed re-runs
// (the control id derives from identity, not from this).
const VALIDATED_AT = '2026-07-01T00:00:00.000Z';

/**
 * Build the primary node's rich v2 motion manifest.
 * @param {{ baseBundleId: string, runtimeFingerprint: string }} args
 * @returns {object} a manifest normalized through parseMotionManifest.
 */
export function buildFixtureManifest({ baseBundleId, runtimeFingerprint }) {
  // The accepted custom control targets the fixture page's #ctl-ok element (a
  // site-scoped slider bound to a CSS custom property — no motionId required).
  const controlIdentity = {
    ladder: 'known-library',
    scope: 'site',
    targets: [{ semanticTargetId: 'ctl-ok', elementId: 'ctl-ok', motionId: null, property: 'opacity' }],
    binding: { kind: 'css-custom-property', property: '--ctl-ok-opacity' },
  };
  const control = {
    id: createStableControlId(controlIdentity),
    ladder: controlIdentity.ladder,
    scope: controlIdentity.scope,
    label: 'Accepted control opacity',
    description: 'Adjusts the accepted control target opacity.',
    controlType: 'slider-number',
    unit: 'percent',
    currentValue: 100,
    originalValue: 100,
    targets: controlIdentity.targets,
    binding: controlIdentity.binding,
    domain: { min: 0, max: 100, step: 5 },
    teardown: { required: false, capability: null },
    limits: { executionMs: 200, mutationCount: 1, targetCount: 1, network: false },
    bundleId: baseBundleId,
    runtimeFingerprint,
    compatibleLineage: [{ bundleId: baseBundleId, runtimeFingerprint }],
    validation: {
      schema: 'passed', read: 'passed', apply: 'passed', effect: 'passed',
      restore: 'passed', deterministic: 'passed', teardown: 'passed', fingerprint: 'passed',
      validatedAt: VALIDATED_AT,
    },
    provenance: { source: 'reconstruction', engine: 'css', decisionCode: 'fixture-accepted' },
    status: 'ready',
  };

  const raw = {
    schemaVersion: 2,
    baseBundleId,
    runtimeFingerprint,
    transactions: [],
    controlManifest: {
      schemaVersion: 1,
      bundleId: baseBundleId,
      runtimeFingerprint,
      controls: [control],
    },
    responsiveManifest: {
      schemaVersion: 1,
      properties: {
        // One per-device binding: the hero's opacity settles to a distinct value
        // on each canonical device, so a reconnect/device-switch scenario has real
        // per-device data to compare.
        'hero:opacity': {
          mode: 'per-device',
          sharedValue: 1,
          overrides: { desktop: 1, tablet: 0.9, mobile: 0.8 },
          provenance: 'author',
          binding: { elementId: 'hero', kind: 'style', property: 'opacity' },
        },
      },
    },
  };

  // Normalize through the strict parser so the stored manifest is exactly what the
  // runtime will re-validate on load (and to fail loudly here if the shape drifts).
  return parseMotionManifest(raw, { expectedBundleId: baseBundleId });
}
