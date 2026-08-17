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

/**
 * Edit auto-upgrade (product rule 2026-08-17, pre-launch): the tool's fixes
 * reach every node automatically. A site node whose stored artifact predates
 * the native engine (any current snapshot that is not a native bundle) is
 * re-cloned through the CURRENT machinery when the user enters Edit — in
 * place, with the previous state preserved in version history. Nominal iter9
 * artifacts are exempt (doctrine: iter9 exists BY NAME and stays static).
 * Scoped to the edit role only: target/source roles keep the deferred policy,
 * so /run compose semantics are untouched.
 *
 * Recorded dissent (Sol review 2026-08-17 #1): this also replaces legacy
 * 'edit' snapshots (user-authored work) silently and charges for the
 * migration. Kept by explicit product-owner rule while pre-launch (history
 * preserves every prior state in Saved versions); a consent surface and a
 * no-debit migration path are REQUIRED before launch.
 */
function editNeedsNativeUpgrade(node) {
  if (node?.kind !== 'site' || !node?.origin_url) return false;
  if (isIter9Reconstruction(node)) return false;
  return node?.current_snapshot_source !== 'native-bundle';
}

export function reconstructionReason({ node, role, edgePayload } = {}) {
  if (role === 'edit' && editNeedsNativeUpgrade(node)) return 'edit';
  if (!needsDeferredReconstruction(node)) return null;
  if (role === 'edit') return 'edit';
  if (role === 'target') return 'transform-target';
  if (role === 'source' && edgeNeedsEditableRuntime(edgePayload)) return 'runtime-source';
  return null;
}

export function shouldReconstructForAction(input) {
  return reconstructionReason(input) !== null;
}
