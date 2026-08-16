const PAID_CLONE_EDIT_PLANS = new Set(['pro', 'ultimate', 'enterprise']);

/**
 * Clone & Edit materializes a live URL reference and is reserved for paid
 * subscribers. Keep the allowlist explicit so unknown or future plan values
 * fail closed until their entitlement is deliberately defined.
 */
export function canUseCloneEdit(plan) {
  return PAID_CLONE_EDIT_PLANS.has(String(plan || '').trim().toLowerCase());
}
