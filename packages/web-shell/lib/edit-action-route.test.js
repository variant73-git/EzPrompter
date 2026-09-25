import { describe, expect, it } from 'vitest';
import { EDIT_ROUTE, planEditEntry } from './edit-action-decision.js';

const BUNDLE_ID = '33333333-3333-4333-8333-333333333333';
const paid = () => true;
const free = () => false;

const ready = {
  id: 'site-1', kind: 'site', origin_url: 'https://example.com',
  current_snapshot_source: 'native-edit',
  current_native_bundle_id: BUNDLE_ID,
  current_motion_manifest_version: 2,
  meta: { animatedDetected: true },
};
const legacy = {
  id: 'site-2', kind: 'site', origin_url: 'https://example.com',
  current_snapshot_source: 'capture', meta: {},
};
const inconsistent = {
  ...ready, current_native_bundle_id: 'not-a-uuid',
};
// A local site with HTML and no origin: nothing can be reconstructed from it.
const originless = {
  id: 'site-3', kind: 'site', origin_url: null,
  current_snapshot_source: 'edit', current_html: '<html></html>', meta: {},
};

describe('planEditEntry — what a press on Edit actually does', () => {
  it('a ready node opens the editor, no request', () => {
    expect(planEditEntry({
      node: ready, plan: 'pro', canUseCloneEdit: paid,
      editorKind: 'native', isNativeReady: true, needsReconstruction: false,
    })).toEqual({ route: EDIT_ROUTE.OPEN, engine: null });
  });

  it('an origin-less node with a stored dev engine NEVER reconstructs (would be a certain 400)', () => {
    // The regression this closes: the handler read its own raw override and
    // fired a doomed request while the button said a free "Edit".
    for (const engine of ['native', 'iter9']) {
      const plan = planEditEntry({
        node: originless, requestedEngine: engine, plan: 'pro', canUseCloneEdit: paid,
        editorKind: 'legacy', isNativeReady: false, needsReconstruction: false,
      });
      expect(plan.route).toBe(EDIT_ROUTE.OPEN);
      expect(plan.engine).toBeNull();
    }
  });

  it('an origin-less node does not show the paywall either, even on a free plan', () => {
    expect(planEditEntry({
      node: originless, requestedEngine: 'native', plan: 'free', canUseCloneEdit: free,
      editorKind: 'legacy', isNativeReady: false, needsReconstruction: false,
    }).route).toBe(EDIT_ROUTE.OPEN);
  });

  it('a legacy node reconstructs on a paid plan and shows the paywall on a free one', () => {
    expect(planEditEntry({
      node: legacy, plan: 'pro', canUseCloneEdit: paid,
      editorKind: 'legacy', isNativeReady: false, needsReconstruction: true,
    })).toEqual({ route: EDIT_ROUTE.RECONSTRUCT, engine: null });
    expect(planEditEntry({
      node: legacy, plan: 'free', canUseCloneEdit: free,
      editorKind: 'legacy', isNativeReady: false, needsReconstruction: true,
    }).route).toBe(EDIT_ROUTE.PLAN_REQUIRED);
  });

  it('an inconsistent clone asks for repair — never the paywall, never a request', () => {
    expect(planEditEntry({
      node: inconsistent, plan: 'free', canUseCloneEdit: free,
      editorKind: 'legacy', isNativeReady: false, needsReconstruction: true,
    })).toEqual({ route: EDIT_ROUTE.REPAIR_NEEDED, engine: null });
  });

  it('the deliberate repair reconstructs with the native engine, gated by plan', () => {
    expect(planEditEntry({
      node: inconsistent, requestedEngine: 'native', plan: 'pro', canUseCloneEdit: paid,
      editorKind: 'legacy', isNativeReady: false, needsReconstruction: true,
    })).toEqual({ route: EDIT_ROUTE.RECONSTRUCT, engine: 'native' });
    expect(planEditEntry({
      node: inconsistent, requestedEngine: 'native', plan: 'free', canUseCloneEdit: free,
      editorKind: 'legacy', isNativeReady: false, needsReconstruction: true,
    }).route).toBe(EDIT_ROUTE.PLAN_REQUIRED);
  });

  it('a ready node with the native editor off refuses instead of opening an empty legacy editor', () => {
    expect(planEditEntry({
      node: ready, plan: 'pro', canUseCloneEdit: paid,
      editorKind: 'legacy', isNativeReady: true, needsReconstruction: false,
    }).route).toBe(EDIT_ROUTE.NATIVE_UNAVAILABLE);
  });
});
