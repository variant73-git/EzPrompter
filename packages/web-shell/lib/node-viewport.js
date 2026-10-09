// Animated sites captured as live/native references use their viewport as the
// playback surface. Expanding the node to the full document height destroys
// the scroll clock that drives sticky scenes, ScrollTrigger and scrubbed
// media. Iter9 reconstructions are ordinary generated HTML and retain the
// existing resize/expand behaviour.

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
