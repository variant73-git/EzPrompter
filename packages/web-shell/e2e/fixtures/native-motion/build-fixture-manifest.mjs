// Task 16 fixture — the RICH primary-node motion manifest (v2).
//
// Encodes the fixture-contract characteristics the seed CAN carry statically:
//   • THREE fully-valid status:'ready' accepted custom controls, and
//   • a responsive binding with a per-device value on desktop/tablet/mobile.
//
// Why THREE controls (audit, Codex+Claude 2026-07-28): the disabled/recovering/
// exhausted presentation is a pure runtime overlay (controlAvailability in
// useNativeMotionController.js) that only lists controls already present as
// status:'ready' in this manifest — the fault-injection seam never ADDS controls.
// The two Task-14 fault scenarios (recover + exhaust) therefore each need their own
// ready control, plus one that stays healthy:
//   ctl-ok        — never faults (proves the healthy path survives)
//   ctl-recover   — the seam faults its FIRST write, then it auto-recovers
//   ctl-exhausted — the seam faults it until recovery is exhausted → visible+disabled
// The seam itself is built in Task 14; the manifest cannot encode fault STATE
// (control-manifest.js admits only status:'ready').
//
// Binding notes (audit): controls are string-valued `color` controls bound to CSS
// custom properties. The bridge reads a css-custom-property with getPropertyValue →
// a STRING, so a numeric slider-number control would fail type validation; a color
// control's value IS a hex string. Each target is a SELECTABLE <div> carrying an
// explicit data-uncraft-id (findElement resolves by data-uncraft-id, and <span> is
// not selectable) with the property inline-initialized + consumed, so the control has
// a real readable value and visible effect. Runtime application is proven end-to-end
// in the Phase-4 canvas scenarios (parser round-trips alone cannot prove it reaches
// the runtime bridge's controlForPatch).
//
// The shape below was proven to survive parseMotionManifest (the same strict
// re-validation openOrResumeEditSession runs on load) and its idempotent re-parse.
import { parseMotionManifest } from '../../../lib/motion-editor/manifest.js';
import { createStableControlId } from '../../../lib/motion-editor/control-manifest.js';

// A frozen timestamp keeps the manifest byte-deterministic across seed re-runs
// (the control id derives from identity, not from this).
const VALIDATED_AT = '2026-07-01T00:00:00.000Z';

// Curated swatch options every color control shares (must include each currentValue).
const COLOR_OPTIONS = ['#a7f3d0', '#fde68a', '#fca5a5', '#93c5fd'];

// The three control targets, keyed by the fixture page's data-uncraft-id. Each holds
// the initial (inline) color the fixture element renders with.
export const FIXTURE_CONTROL_TARGETS = Object.freeze([
  { slug: 'ctl-ok', label: 'Accepted control color', value: '#a7f3d0' },
  { slug: 'ctl-recover', label: 'Recoverable control color', value: '#fde68a' },
  { slug: 'ctl-exhausted', label: 'Exhausted control color', value: '#fca5a5' },
]);

function buildColorControl({ slug, label, value }, { baseBundleId, runtimeFingerprint }) {
  const identity = {
    ladder: 'known-library',
    scope: 'site',
    targets: [{ semanticTargetId: slug, elementId: slug, motionId: null, property: 'color' }],
    binding: { kind: 'css-custom-property', property: `--${slug}-color` },
  };
  return {
    id: createStableControlId(identity),
    ladder: identity.ladder,
    scope: identity.scope,
    label,
    description: `${label} swatch.`,
    controlType: 'color',
    unit: 'color',
    currentValue: value,
    originalValue: value,
    targets: identity.targets,
    binding: identity.binding,
    domain: { options: COLOR_OPTIONS },
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
}

/**
 * Build the primary node's rich v2 motion manifest.
 * @param {{ baseBundleId: string, runtimeFingerprint: string }} args
 * @returns {object} a manifest normalized through parseMotionManifest.
 */
export function buildFixtureManifest({ baseBundleId, runtimeFingerprint }) {
  const controls = FIXTURE_CONTROL_TARGETS.map((target) =>
    buildColorControl(target, { baseBundleId, runtimeFingerprint }));

  const raw = {
    schemaVersion: 2,
    baseBundleId,
    runtimeFingerprint,
    transactions: [],
    controlManifest: {
      schemaVersion: 1,
      bundleId: baseBundleId,
      runtimeFingerprint,
      controls,
    },
    responsiveManifest: {
      schemaVersion: 1,
      properties: {
        // One per-device binding: the hero's opacity settles to a distinct value on
        // each canonical device, so a reconnect/device-switch scenario has real
        // per-device data to compare. The hero carries data-uncraft-id="hero".
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
