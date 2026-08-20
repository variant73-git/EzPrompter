import { describe, expect, it } from 'vitest';
import {
  canonicalNativeEditNode,
  canExpandSiteViewport,
  computeNodeEditFrame,
  isIter9Reconstruction,
  isViewportLockedAnimatedSite,
  nativeEditDeviceForNode,
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

  it('uses shared canonical device dimensions without persisting the resting node geometry', () => {
    const node = { id: 'site', width: 1220, height: 640, pos_x: 100, pos_y: 200 };
    expect(nativeEditDeviceForNode(node).id).toBe('desktop');
    expect(canonicalNativeEditNode(node, 'mobile')).toEqual({
      ...node,
      width: 390,
      height: 844,
    });
    expect(node).toEqual({ id: 'site', width: 1220, height: 640, pos_x: 100, pos_y: 200 });
  });

  it('centers a fixed viewport in the free canvas area without using document height', () => {
    const frame = computeNodeEditFrame(
      { pos_x: 100, pos_y: 200, width: 1280, height: 800 },
      {
        viewportWidth: 1600,
        viewportHeight: 860,
        leftReserve: 0,
        rightReserve: 0,
        header: 46,
        bottom: 18,
        padding: 26,
      },
    );
    expect(frame.scale).toBeCloseTo(0.934272, 5);
    expect(frame.positionX).toBeCloseTo(108.638, 3);
    expect(frame.positionY).toBeCloseTo(-116.563, 3);
  });

  it('zoom anchor equals the edit-frame center for the SAME reserves (defect 2, 2026-08-20)', async () => {
    // The wheel/pill zoom pivots hardcoded `46 + (H - 64) / 2`, which is only
    // the frame center when bottom=18 — the native editor reserves bottom=200,
    // so every zoom notch drifted the site ~91px off its framed center. The
    // anchor is now derived from the same math as computeNodeEditFrame.
    const { editFrameAnchor } = await import('./node-viewport.js');
    const args = {
      viewportWidth: 1440,
      viewportHeight: 900,
      leftReserve: 300,
      rightReserve: 320,
      bottom: 200,
    };
    const anchor = editFrameAnchor(args);
    const frame = computeNodeEditFrame({ pos_x: 0, pos_y: 0, width: 1280, height: 800 }, args);
    const centerX = frame.positionX + (0 + 1280 / 2) * frame.scale;
    const centerY = frame.positionY + (0 + 800 / 2) * frame.scale;
    expect(anchor.cx).toBeCloseTo(centerX, 5);
    expect(anchor.cy).toBeCloseTo(centerY, 5);
  });
});
