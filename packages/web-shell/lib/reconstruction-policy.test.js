import { describe, expect, it } from 'vitest';
import {
  edgeNeedsEditableRuntime,
  needsDeferredReconstruction,
  reconstructionReason,
  shouldReconstructForAction,
} from './reconstruction-policy.js';

const captured = {
  id: 'site-1', kind: 'site', origin_url: 'https://example.com',
  current_snapshot_source: 'capture', meta: { animatedDetected: true },
};

describe('deferred reconstruction policy', () => {
  it('recognizes an animated free capture that has not been reconstructed', () => {
    expect(needsDeferredReconstruction(captured)).toBe(true);
    expect(needsDeferredReconstruction({ ...captured, current_snapshot_source: 'reconstruct' })).toBe(false);
    expect(needsDeferredReconstruction({ ...captured, meta: { animatedDetected: false } })).toBe(false);
  });

  it('reconstructs when the user enters edit mode', () => {
    expect(reconstructionReason({ node: captured, role: 'edit' })).toBe('edit');
  });

  it('starts the clone when a live URL reference enters edit mode', () => {
    const reference = {
      id: 'site-ref', kind: 'site', origin_url: 'https://example.com',
      current_html: null, meta: { referenceMode: 'live' },
    };
    expect(needsDeferredReconstruction(reference)).toBe(true);
    expect(reconstructionReason({ node: reference, role: 'edit' })).toBe('edit');
  });

  it('reconstructs when the captured site is the transformation target', () => {
    expect(reconstructionReason({ node: captured, role: 'target' })).toBe('transform-target');
  });

  describe('edit auto-upgrades pre-native lineage (product rule 2026-08-17)', () => {
    // Tool fixes reach every node automatically: Edit on a node whose stored
    // artifact predates the native engine re-clones it through the CURRENT
    // machinery in place (history keeps the old state). Old projects must
    // never need a new project to feel the tool's evolution.
    it('edit upgrades a static capture even without animatedDetected', () => {
      const legacyCapture = { ...captured, meta: { animatedDetected: false } };
      expect(reconstructionReason({ node: legacyCapture, role: 'edit' })).toBe('edit');
    });

    it('edit upgrades a legacy saved-edit snapshot', () => {
      const legacyEdit = { ...captured, current_snapshot_source: 'edit', meta: {} };
      expect(reconstructionReason({ node: legacyEdit, role: 'edit' })).toBe('edit');
    });

    const BUNDLE_ID = '33333333-3333-4333-8333-333333333333';
    const nativeReady = (source) => ({
      ...captured,
      current_snapshot_source: source,
      current_native_bundle_id: BUNDLE_ID,
      current_motion_manifest_version: 2,
      // stale detection flag on purpose: readiness must short-circuit BEFORE
      // needsDeferredReconstruction, or a stale flag re-clones a ready node.
      meta: { animatedDetected: true },
    });

    it('edit does NOT re-clone a node that is already native', () => {
      expect(reconstructionReason({ node: nativeReady('native-bundle'), role: 'edit' })).toBe(null);
    });

    it('edit after a native Save does NOT re-clone (defect 3, 2026-08-20)', () => {
      // Save writes source='native-edit' and KEEPS the bundle; the old policy
      // compared against the single string 'native-bundle' and re-cloned (and
      // re-charged) forever after the first Save.
      expect(reconstructionReason({ node: nativeReady('native-edit'), role: 'edit' })).toBe(null);
    });

    it('edit on an inconsistent native claim asks for repair, never a billable clone', () => {
      const broken = { ...nativeReady('native-edit'), current_native_bundle_id: 'not-a-uuid' };
      expect(reconstructionReason({ node: broken, role: 'edit' })).toBe('native-inconsistent');
      const missingStructure = { ...captured, current_snapshot_source: 'native-bundle', meta: {} };
      expect(reconstructionReason({ node: missingStructure, role: 'edit' })).toBe('native-inconsistent');
    });

    it('native readiness does not leak into target/source roles (deferred policy untouched)', () => {
      // Deliberate limit 179#10: /run compose is textual, so a target-role
      // request on an animated-flagged node keeps the deferred reconstruction
      // exactly as before — readiness only short-circuits the EDIT role.
      expect(reconstructionReason({ node: nativeReady('native-edit'), role: 'target' })).toBe('transform-target');
      const calmNative = { ...nativeReady('native-edit'), meta: { animatedDetected: false } };
      expect(reconstructionReason({ node: calmNative, role: 'target' })).toBe(null);
    });

    it('edit respects a nominal iter9 artifact (doctrine: iter9 by name stays static)', () => {
      const iter9 = { ...captured, current_snapshot_source: 'reconstruct', meta: { reconstructionEngine: 'iter9' } };
      expect(reconstructionReason({ node: iter9, role: 'edit' })).toBe(null);
    });

    it('the upgrade rule does not leak into target/source roles', () => {
      const legacyCapture = { ...captured, meta: { animatedDetected: false } };
      expect(reconstructionReason({ node: legacyCapture, role: 'target' })).toBe(null);
      expect(reconstructionReason({ node: legacyCapture, role: 'source', edgePayload: { binding: { motion: 'preserve' } } })).toBe(null);
    });
  });

  it('reconstructs a source only for bindings that need editable runtime evidence', () => {
    expect(shouldReconstructForAction({
      node: captured,
      role: 'source',
      edgePayload: { binding: { structure: 'preserve', motion: 'preserve' } },
    })).toBe(true);
    expect(edgeNeedsEditableRuntime({ binding: 'preserve interaction and scroll timing' })).toBe(true);
  });

  it('does not reconstruct for visual tokens, media, text, preview, or unbound references', () => {
    for (const binding of [
      { style: 'priority', palette: 'replace', typography: 'replace' },
      { media: 'replace-images' },
      { content: 'reference' },
      'visual-reference',
      null,
    ]) {
      expect(shouldReconstructForAction({
        node: captured,
        role: 'source',
        edgePayload: binding ? { binding } : {},
      })).toBe(false);
    }
  });
});
