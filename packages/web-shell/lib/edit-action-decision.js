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
  const canReconstruct = Boolean(node?.origin_url);
  // The override is NORMALISED here, not just reported: without an origin the
  // route can only answer 400, so a stored dev engine must not survive into
  // the caller and trigger a doomed request. Callers MUST consume
  // `decision.engineOverride` — reading their own raw value reintroduces the
  // very mismatch this helper exists to remove (Sol final round).
  const effectiveOverride = canReconstruct ? engineOverride : null;
  const integrityError = effectiveOverride == null && reason === 'native-inconsistent';
  const billable = canReconstruct && (effectiveOverride != null || reason === 'edit');
  return { billable, integrityError, engineOverride: effectiveOverride };
}

export const EDIT_ROUTE = Object.freeze({
  REPAIR_NEEDED: 'repair-needed',
  PLAN_REQUIRED: 'plan-required',
  NATIVE_UNAVAILABLE: 'native-unavailable',
  OPEN: 'open',
  RECONSTRUCT: 'reconstruct',
});

/**
 * What a press on Edit actually DOES — pure, so the consumption of the
 * decision is testable without rendering the canvas. The flags alone were not
 * the contract: a caller reading its own raw engine override could still fire
 * a request the route can only answer with 400 (Sol final round).
 *
 * @returns {{ route: string, engine: string|null }}
 */
export function planEditEntry({ node, requestedEngine = null, plan, canUseCloneEdit, editorKind, nativeEditorKind = 'native', isNativeReady = false, needsReconstruction = false } = {}) {
  const decision = decideEditAction({ node, engineOverride: requestedEngine });
  const engine = decision.engineOverride;
  if (decision.integrityError) return { route: EDIT_ROUTE.REPAIR_NEEDED, engine: null };
  if (decision.billable && !canUseCloneEdit?.(plan)) return { route: EDIT_ROUTE.PLAN_REQUIRED, engine: null };
  if (!engine) {
    if (editorKind === nativeEditorKind) return { route: EDIT_ROUTE.OPEN, engine: null };
    if (isNativeReady) return { route: EDIT_ROUTE.NATIVE_UNAVAILABLE, engine: null };
    if (!needsReconstruction) return { route: EDIT_ROUTE.OPEN, engine: null };
  }
  return { route: EDIT_ROUTE.RECONSTRUCT, engine };
}
