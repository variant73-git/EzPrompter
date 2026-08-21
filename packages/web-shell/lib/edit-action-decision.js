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
  // Both outcomes go through the reconstruction route, so both inherit its
  // ONE structural precondition, mirrored rather than invented: no origin URL
  // means the route answers 400 `no_origin_url`, whatever the engine. The
  // route does NOT filter by kind — a nominal engine on a template/chunk with
  // an origin URL is accepted today — so gating on kind here would hide an
  // operation the server performs. `reconstructionReason` still applies its
  // own site-only rule to the automatic 'edit' upgrade (Sol final round: the
  // first gate failed in BOTH directions — a nominal engine on an origin-less
  // node still promised a charge, and valid kinds lost the action).
  // Derive BOTH outcomes from the single reason the route itself computes,
  // instead of re-deriving lineage here: reading `classifyNativeLineage`
  // directly meant a non-site node could report "needs repair" while the
  // route answered `skipped` — the UI inventing a state the server does not
  // have. The route's one structural precondition (400 `no_origin_url`) is
  // mirrored for the nominal path, which bypasses the reason entirely.
  const reason = reconstructionReason({ node, role: 'edit' });
  const integrityError = engineOverride == null && reason === 'native-inconsistent';
  const billable = Boolean(node?.origin_url)
    && (engineOverride != null || reason === 'edit');
  return { billable, integrityError, engineOverride };
}
