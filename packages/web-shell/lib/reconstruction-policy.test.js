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

    it('edit does NOT re-clone a node that is already native', () => {
      const native = { ...captured, current_snapshot_source: 'native-bundle', meta: { animatedDetected: false } };
      expect(reconstructionReason({ node: native, role: 'edit' })).toBe(null);
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
