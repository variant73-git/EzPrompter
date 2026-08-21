import { classifyNativeLineage, NATIVE_LINEAGE } from './node-editor-kind.js';
import { reconstructionReason } from './reconstruction-policy.js';

/**
 * ONE decision for every Edit entry point (Sol r3, 2026-08-20).
 *
 * Three surfaces used to decide independently what a press on Edit means —
 * the canvas handler, the inspector button and the node's floating button —
 * and they disagreed: the inspector kept `shouldReconstructForAction`, whose
 * truthiness now also covers the non-billable `native-inconsistent` state, so
 * a free user got an upsell for a charge the server refuses; and a nominal
 * engine request on a ready node bills `clone.edit` while the label promised
 * a free "Edit".
 *
 * The rule the server actually executes (app/api/nodes/[id]/reconstruct):
 *   - a nominal engine ALWAYS runs and bills, readiness notwithstanding;
 *   - otherwise only reason 'edit' (legacy auto-upgrade) runs and bills;
 *   - 'native-inconsistent' is an integrity failure: 409, never a charge.
 *
 * @returns {{ billable: boolean, integrityError: boolean, engineOverride: string|null }}
 */
export function decideEditAction({ node, engineOverride = null } = {}) {
  const integrityError = engineOverride == null
    && classifyNativeLineage(node) === NATIVE_LINEAGE.INCONSISTENT;
  const billable = !integrityError
    && (engineOverride != null || reconstructionReason({ node, role: 'edit' }) === 'edit');
  return { billable, integrityError, engineOverride };
}
