/**
 * A URL reference is the lightweight, pre-clone state of a site node.
 * It intentionally has no snapshot HTML: the canvas may lease one live
 * cross-origin iframe to the selected node, while Edit performs the real
 * reconstruction and creates the first durable snapshot.
 */
export function isLiveUrlReference(node) {
  return Boolean(
    node?.kind === 'site'
    && node?.origin_url
    && node?.meta?.referenceMode === 'live'
    && !node?.current_html
  );
}

export function liveReferenceMeta(url, name = null) {
  let hostname = String(url || 'Website');
  try { hostname = new URL(url).hostname.replace(/^www\./, ''); } catch {}
  return {
    name: name || hostname,
    source: 'url-reference',
    referenceMode: 'live',
  };
}

export function shouldMountLiveReference(node, { active = false, offscreen = false } = {}) {
  return isLiveUrlReference(node) && active && !offscreen;
}

export function remapLiveReferenceSelection(currentId, temporaryId, persistedId) {
  return currentId === temporaryId ? persistedId : currentId;
}
