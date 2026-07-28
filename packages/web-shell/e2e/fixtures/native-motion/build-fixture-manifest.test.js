// Unit test for the fixture motion-manifest builder. Pure (no DB) — runs in the
// normal suite. Proves the built manifest survives the STRICT parseMotionManifest
// (the same re-validation openOrResumeEditSession runs on load), carries exactly
// one ready accepted control, and binds ≥1 responsive property per device.
import { describe, it, expect } from 'vitest';
import { buildFixtureManifest } from './build-fixture-manifest.mjs';
import { parseMotionManifest } from '../../../lib/motion-editor/manifest.js';
import { responsiveRuntimePatches } from '../../../lib/motion-editor/responsive-manifest.js';

const BUNDLE_ID = 'a1b2c3d4-5e6f-5a7b-8c9d-0e1f2a3b4c5d'; // valid UUID (v-nibble 5, variant 8)
const FINGERPRINT = 'sha256:' + 'a'.repeat(64);
const STAGES = ['schema', 'read', 'apply', 'effect', 'restore', 'deterministic', 'teardown', 'fingerprint'];

describe('buildFixtureManifest', () => {
  it('produces a v2 manifest that survives parseMotionManifest with exactly one ready control', () => {
    const manifest = buildFixtureManifest({ baseBundleId: BUNDLE_ID, runtimeFingerprint: FINGERPRINT });
    const parsed = parseMotionManifest(manifest, { expectedBundleId: BUNDLE_ID });
    expect(parsed.schemaVersion).toBe(2);
    expect(parsed.baseBundleId).toBe(BUNDLE_ID);

    expect(parsed.controlManifest.controls).toHaveLength(1);
    const control = parsed.controlManifest.controls[0];
    expect(control.status).toBe('ready');
    expect(control.id).toMatch(/^control-[0-9a-f]{24}$/);
    for (const stage of STAGES) expect(control.validation[stage]).toBe('passed');
    expect(control.compatibleLineage).toEqual(
      expect.arrayContaining([{ bundleId: BUNDLE_ID, runtimeFingerprint: FINGERPRINT }]),
    );
    expect(control.limits.targetCount).toBe(control.targets.length);
    expect(control.limits.network).toBe(false);
  });

  it('binds at least one responsive property per device (desktop/tablet/mobile)', () => {
    const manifest = buildFixtureManifest({ baseBundleId: BUNDLE_ID, runtimeFingerprint: FINGERPRINT });
    const parsed = parseMotionManifest(manifest, { expectedBundleId: BUNDLE_ID });
    for (const device of ['desktop', 'tablet', 'mobile']) {
      expect(responsiveRuntimePatches(parsed.responsiveManifest, device).length).toBeGreaterThanOrEqual(1);
    }
  });

  it('is idempotent — the built manifest re-parses unchanged', () => {
    const manifest = buildFixtureManifest({ baseBundleId: BUNDLE_ID, runtimeFingerprint: FINGERPRINT });
    const once = parseMotionManifest(manifest, { expectedBundleId: BUNDLE_ID });
    const twice = parseMotionManifest(once, { expectedBundleId: BUNDLE_ID });
    expect(twice).toEqual(once);
  });
});
