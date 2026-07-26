import { describe, expect, it } from 'vitest';
import {
  NODE_EDITOR_KIND,
  resolveNodeEditorKind,
  snapshotEditorMetadata,
} from './node-editor-kind.js';

const BUNDLE_ID = '33333333-3333-4333-8333-333333333333';
const flags = { nativeMotionCanvasEdit: true };

describe('node editor kind', () => {
  it('routes a supported native snapshot to the native editor when the flag is enabled', () => {
    const node = { id: 'site-1', kind: 'site' };
    const snapshot = { nativeBundleId: BUNDLE_ID, motionManifestVersion: 2 };
    expect(resolveNodeEditorKind(node, snapshot, flags)).toBe(NODE_EDITOR_KIND.NATIVE);
  });

  it('keeps static and Iter9 snapshots on the legacy editor', () => {
    const snapshot = { nativeBundleId: BUNDLE_ID, motionManifestVersion: 2 };
    expect(resolveNodeEditorKind({ kind: 'site' }, {}, flags)).toBe(NODE_EDITOR_KIND.LEGACY);
    expect(resolveNodeEditorKind({
      kind: 'site',
      current_snapshot_source: 'reconstruct',
      meta: { reconstructionEngine: 'iter9' },
    }, snapshot, flags)).toBe(NODE_EDITOR_KIND.LEGACY);
  });

  it('does not treat animation detection as proof of native edit eligibility', () => {
    const node = { kind: 'site', meta: { animatedDetected: true, animatedRuntime: true } };
    expect(resolveNodeEditorKind(node, {}, flags)).toBe(NODE_EDITOR_KIND.LEGACY);
  });

  it('rejects unsupported manifests, malformed bundle ids, and a disabled flag', () => {
    const node = { kind: 'site' };
    expect(resolveNodeEditorKind(node, {
      nativeBundleId: BUNDLE_ID,
      motionManifestVersion: 1,
    }, flags)).toBe(NODE_EDITOR_KIND.LEGACY);
    expect(resolveNodeEditorKind(node, {
      nativeBundleId: 'bundle-from-meta',
      motionManifestVersion: 2,
    }, flags)).toBe(NODE_EDITOR_KIND.LEGACY);
    expect(resolveNodeEditorKind(node, {
      nativeBundleId: BUNDLE_ID,
      motionManifestVersion: 2,
    }, { nativeMotionCanvasEdit: false })).toBe(NODE_EDITOR_KIND.LEGACY);
  });

  it('reads only the current snapshot eligibility aliases carried by the board query', () => {
    const first = {
      id: 'site-1',
      current_snapshot_id: 'snap-1',
      current_native_bundle_id: BUNDLE_ID,
      current_motion_manifest_version: 2,
    };
    const second = {
      id: 'site-2',
      current_snapshot_id: 'snap-2',
      meta: { nativeBundleId: BUNDLE_ID, motionManifestVersion: 2 },
    };
    expect(snapshotEditorMetadata(first)).toEqual({
      id: 'snap-1',
      nativeBundleId: BUNDLE_ID,
      motionManifestVersion: 2,
    });
    expect(snapshotEditorMetadata(second)).toEqual({
      id: 'snap-2',
      nativeBundleId: null,
      motionManifestVersion: null,
    });
  });
});
