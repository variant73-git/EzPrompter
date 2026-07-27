import { describe, expect, it } from 'vitest';
import {
  applyReconstructionResultToNode,
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

  it('promotes a completed native conversion into native editor eligibility immediately', () => {
    const prepared = applyReconstructionResultToNode({
      id: 'site-1', kind: 'site', current_html: '<html>capture</html>', meta: { animatedDetected: true },
    }, {
      kind: 'native', snapshotId: 'snapshot-native', snapshotSource: 'native-bundle',
      bundleDescriptor: { bundleId: BUNDLE_ID },
      motionManifest: { schemaVersion: 2 },
      meta: { motionControls: { status: 'ready', acceptedControls: 3 } },
    });

    expect(prepared).toMatchObject({
      current_html: null,
      current_snapshot_id: 'snapshot-native',
      current_snapshot_source: 'native-bundle',
      current_native_bundle_id: BUNDLE_ID,
      current_motion_manifest_version: 2,
      meta: { reconstructionEngine: 'native-bundle', motionControls: { acceptedControls: 3 } },
    });
    expect(resolveNodeEditorKind(prepared, snapshotEditorMetadata(prepared), flags)).toBe(NODE_EDITOR_KIND.NATIVE);
  });

  it('keeps an Iter9 conversion on the legacy path', () => {
    const prepared = applyReconstructionResultToNode({ id: 'site-1', kind: 'site', meta: {} }, {
      snapshotId: 'snapshot-iter9', html: '<html>iter9</html>', snapshotSource: 'reconstruct', meta: {},
    });
    expect(prepared).toMatchObject({
      current_html: '<html>iter9</html>',
      current_native_bundle_id: null,
      current_motion_manifest_version: null,
      meta: { reconstructionEngine: 'iter9' },
    });
    expect(resolveNodeEditorKind(prepared, snapshotEditorMetadata(prepared), flags)).toBe(NODE_EDITOR_KIND.LEGACY);
  });
});
