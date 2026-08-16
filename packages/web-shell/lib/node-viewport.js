// Animated sites captured as live/native references use their viewport as the
// playback surface. Expanding the node to the full document height destroys
// the scroll clock that drives sticky scenes, ScrollTrigger and scrubbed
// media. Iter9 reconstructions are ordinary generated HTML and retain the
// existing resize/expand behaviour.

import {
  getMotionEditorDevice,
  MOTION_EDITOR_DEVICE_ORDER,
  MOTION_EDITOR_DEVICES,
} from './motion-editor/devices.js';

export function isIter9Reconstruction(node) {
  const source = node?.current_snapshot_source || node?.meta?.snapshotSource;
  return source === 'reconstruct'
    || node?.meta?.runtime === 'iter9'
    || node?.meta?.reconstructionEngine === 'iter9';
}

export function isViewportLockedAnimatedSite(node) {
  if (node?.kind !== 'site' || isIter9Reconstruction(node)) return false;
  const meta = node?.meta || {};
  return Boolean(
    meta.animatedDetected
    || meta.animatedRuntime
    || meta.nativeMotion
    || meta.runtime === 'native'
    || meta.runtime === 'animated'
  );
}

export function canExpandSiteViewport(node) {
  return node?.kind === 'site' && !isViewportLockedAnimatedSite(node);
}

export function nativeEditDeviceForNode(node) {
  const width = Number(node?.width);
  const exact = MOTION_EDITOR_DEVICE_ORDER.find((id) => (
    Number.isFinite(width) && Math.abs(MOTION_EDITOR_DEVICES[id].width - width) < 4
  ));
  return getMotionEditorDevice(exact || 'desktop');
}

export function canonicalNativeEditNode(node, deviceId = nativeEditDeviceForNode(node).id) {
  const device = getMotionEditorDevice(deviceId);
  return {
    ...node,
    width: device.width,
    height: device.height,
  };
}

export function computeNodeEditFrame(node, {
  viewportWidth,
  viewportHeight,
  leftReserve = 0,
  rightReserve = 0,
  header = 46,
  bottom = 18,
  padding = 26,
  maximumScale = 1,
  minimumScale = 0.04,
} = {}) {
  const usableWidth = Math.max(320, Number(viewportWidth) - leftReserve - rightReserve);
  const usableHeight = Math.max(240, Number(viewportHeight) - header - bottom);
  const nodeWidth = Math.max(1, Number(node?.width) || 1280);
  const nodeHeight = Math.max(1, Number(node?.height) || 800);
  const framedWidth = nodeWidth + padding * 2;
  const framedHeight = nodeHeight + padding * 2;
  const scale = Math.max(
    minimumScale,
    Math.min(usableWidth / framedWidth, usableHeight / framedHeight, maximumScale),
  );
  const centerX = (Number(node?.pos_x) || 0) + nodeWidth / 2;
  const centerY = (Number(node?.pos_y) || 0) + nodeHeight / 2;
  return {
    positionX: (leftReserve + usableWidth / 2) - centerX * scale,
    positionY: (header + usableHeight / 2) - centerY * scale,
    scale,
  };
}
