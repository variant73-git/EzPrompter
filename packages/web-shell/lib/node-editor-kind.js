import { isIter9Reconstruction } from './node-viewport.js';

export const NODE_EDITOR_KIND = Object.freeze({
  LEGACY: 'legacy',
  NATIVE: 'native',
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NATIVE_MOTION_MANIFEST_VERSION = 2;

export function snapshotEditorMetadata(node) {
  return {
    id: node?.current_snapshot_id || null,
    nativeBundleId: node?.current_native_bundle_id || null,
    motionManifestVersion: node?.current_motion_manifest_version == null
      ? null
      : Number(node.current_motion_manifest_version),
  };
}

export function resolveNodeEditorKind(node, snapshot, flags = {}) {
  if (!flags.nativeMotionCanvasEdit) return NODE_EDITOR_KIND.LEGACY;
  if (!['site', 'template', 'chunk'].includes(node?.kind)) return NODE_EDITOR_KIND.LEGACY;
  if (isIter9Reconstruction(node)) return NODE_EDITOR_KIND.LEGACY;

  const bundleId = snapshot?.nativeBundleId;
  const manifestVersion = Number(snapshot?.motionManifestVersion);
  if (!UUID_PATTERN.test(String(bundleId || ''))) return NODE_EDITOR_KIND.LEGACY;
  if (manifestVersion !== NATIVE_MOTION_MANIFEST_VERSION) return NODE_EDITOR_KIND.LEGACY;
  return NODE_EDITOR_KIND.NATIVE;
}
