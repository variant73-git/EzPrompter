import { isIter9Reconstruction } from './node-viewport.js';
import { isLiveUrlReference } from './url-reference.js';

// A URL capture is intentionally free. Animated builders are stored as a
// useful static snapshot and upgraded to editable Iter9 HTML only when a
// downstream action genuinely needs that representation.
export function needsDeferredReconstruction(node) {
  if (node?.kind !== 'site' || !node?.origin_url) return false;
  if (isIter9Reconstruction(node)) return false;
  // A live URL reference deliberately has no editable snapshot yet. Edit is
  // the capability boundary where the real clone begins, regardless of
  // whether the source happens to advertise an animation library.
  if (isLiveUrlReference(node)) return true;
  return Boolean(node?.meta?.animatedDetected);
}

function bindingEntries(payload) {
  const binding = payload?.binding ?? payload?.role ?? payload?.channel ?? payload?.channels;
  if (!binding) return [];
  if (typeof binding === 'string') return [binding.toLowerCase()];
  if (Array.isArray(binding)) return binding.flatMap((value) => bindingEntries({ binding: value }));
  if (typeof binding === 'object') {
    return Object.entries(binding).flatMap(([key, value]) => [key, String(value)].map((part) => part.toLowerCase()));
  }
  return [String(binding).toLowerCase()];
}

const EDITABLE_RUNTIME_SIGNALS = new Set([
  'structure', 'layout', 'motion', 'animation', 'animated', 'interaction',
  'behavior', 'behaviour', 'runtime', 'sticky', 'pinned', 'parallax', 'scroll',
  'preserve-motion', 'preserve-structure', 'transplant', 'demarcelizer',
]);

export function edgeNeedsEditableRuntime(edgePayload) {
  return bindingEntries(edgePayload).some((entry) => {
    if (EDITABLE_RUNTIME_SIGNALS.has(entry)) return true;
    return [...EDITABLE_RUNTIME_SIGNALS].some((signal) => entry.includes(signal));
  });
}

export function reconstructionReason({ node, role, edgePayload } = {}) {
  if (!needsDeferredReconstruction(node)) return null;
  if (role === 'edit') return 'edit';
  if (role === 'target') return 'transform-target';
  if (role === 'source' && edgeNeedsEditableRuntime(edgePayload)) return 'runtime-source';
  return null;
}

export function shouldReconstructForAction(input) {
  return reconstructionReason(input) !== null;
}
