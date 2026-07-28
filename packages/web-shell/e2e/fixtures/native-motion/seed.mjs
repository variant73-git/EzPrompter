// Task 16 persisted /canvas E2E fixture seed (the "mutation pack").
//
// Writes ONLY to the isolated disposable DB (endpoint allowlist enforced below).
// Runs only when the runner grants E2E_NATIVE_MOTION_ALLOW_MUTATIONS=1. It creates
// legitimate test fixtures (users/board/nodes/bundles/sessions) — never production data.

export const FIXTURE_TAG = 'e2e-native-motion-fixture';

// The disposable Neon project verified empty + isolated (2026-07-28). Seeding refuses
// any other endpoint so a mis-set DATABASE_URL can never write to production.
export const ALLOWLIST_ENDPOINT = 'ep-orange-frost-acaedcil';

/**
 * Refuse to run unless `url` resolves to the allowlisted disposable endpoint.
 * Uses new URL().hostname (the resolver the driver uses) so a two-@ host-confusion
 * URL — which connects to the LAST @'s host — cannot slip past a first-@ regex.
 */
export function assertIsolatedTarget(url, { allowlistEndpoint }) {
  if (!url) throw new Error('seed: DATABASE_URL empty');
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error('seed: DATABASE_URL is not a valid URL');
  }
  const m = host.match(/^(ep-[a-z0-9-]+?)(?:-pooler)?\./);
  const ep = m ? m[1] : null;
  if (!ep) throw new Error('seed: endpoint not parseable from host');
  if (/[?&]options=/i.test(url)) throw new Error('seed: endpoint-routing override (options=) not allowed');
  if (ep !== allowlistEndpoint) {
    throw new Error(`seed: endpoint ${ep} != allowlist ${allowlistEndpoint} — refusing to write`);
  }
}
