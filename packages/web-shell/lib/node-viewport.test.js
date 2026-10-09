import { describe, expect, it } from 'vitest';
import {
  canExpandSiteViewport,
  isIter9Reconstruction,
  isViewportLockedAnimatedSite,
} from './node-viewport.js';

describe('animated site viewport policy', () => {
  it('locks animated captures to the authored viewport', () => {
    const node = { kind: 'site', meta: { animatedDetected: true } };
    expect(isViewportLockedAnimatedSite(node)).toBe(true);
    expect(canExpandSiteViewport(node)).toBe(false);
  });

  it('keeps Iter9 reconstructions expandable', () => {
    const node = {
      kind: 'site',
      meta: { animatedDetected: true },
      current_snapshot_source: 'reconstruct',
    };
    expect(isIter9Reconstruction(node)).toBe(true);
    expect(isViewportLockedAnimatedSite(node)).toBe(false);
    expect(canExpandSiteViewport(node)).toBe(true);
  });

  it('keeps ordinary static site nodes expandable', () => {
    expect(canExpandSiteViewport({ kind: 'site', meta: {} })).toBe(true);
  });
});
