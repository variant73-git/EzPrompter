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
