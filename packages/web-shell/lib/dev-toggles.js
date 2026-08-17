/**
 * dev-toggles.js — shared bits of the developer widget (pre-launch tooling).
 *
 * The widget lets the developer flip product levers while dogfooding:
 *   1. clone engine (native / iter9) — client-side, localStorage;
 *   2. plan tier (free / pro) — server, users.plan;
 *   3. credits preset (infinite / starter / zero) — server, users.credits_cents.
 *
 * The server route (app/api/dev/toggles) is fail-closed in production:
 * NODE_ENV === 'production' requires UNCRAFT_DEV_TOOLS=1 (server env, never
 * NEXT_PUBLIC_* — flags compiled into the client bundle are not a boundary).
 */

export const DEV_ENGINE_KEY = 'uncraft-dev-engine';
export const DEV_ENGINES = Object.freeze(['native', 'iter9']);

export const CREDIT_PRESETS = Object.freeze({
  infinite: 10_000_000,
  starter: 500,
  zero: 0,
});

export function devToolsAllowed(env = process.env) {
  if (env.NODE_ENV !== 'production') return true;
  return env.UNCRAFT_DEV_TOOLS === '1';
}

export function getDevEngine() {
  if (typeof localStorage === 'undefined') return null;
  const value = localStorage.getItem(DEV_ENGINE_KEY);
  return DEV_ENGINES.includes(value) ? value : null;
}

export function setDevEngine(engine) {
  if (typeof localStorage === 'undefined') return;
  if (DEV_ENGINES.includes(engine)) localStorage.setItem(DEV_ENGINE_KEY, engine);
  else localStorage.removeItem(DEV_ENGINE_KEY);
}

/**
 * Engine override for entering Edit. A NOMINAL engine always re-runs the
 * clone (doctrine: nominal beats "already ready"), so the widget's selector
 * must NOT force a re-clone when the node already matches the chosen engine —
 * the selector means "which machinery produces clones", not "re-run on every
 * Edit". Returns the engine to pass, or null to follow the default policy.
 */
export function resolveEditEngineOverride(node, stored = getDevEngine()) {
  if (!stored) return null;
  const source = node?.current_snapshot_source;
  if (stored === 'native' && source === 'native-bundle') return null;
  if (stored === 'iter9' && (source === 'reconstruct' || node?.meta?.reconstructionEngine === 'iter9')) return null;
  return stored;
}
