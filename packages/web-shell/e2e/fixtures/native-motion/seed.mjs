// Task 16 persisted /canvas E2E fixture seed (the "mutation pack").
//
// Writes ONLY to the isolated disposable DB (endpoint allowlist enforced below).
// Runs only when the runner grants E2E_NATIVE_MOTION_ALLOW_MUTATIONS=1. It creates
// legitimate test fixtures (users/board/nodes/bundles/sessions) — never production data.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createToken, hashPassword } from '../../../lib/auth.js';
import { registerNativeBundle } from '../../../lib/native-clone/register-bundle.js';
import { persistNativeBundleDescriptor } from '../../../lib/motion-editor/edit-session-store.js';

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

const OWNER_EMAIL = `${FIXTURE_TAG}-owner@example.test`;
const ADMIN_EMAIL = `${FIXTURE_TAG}-admin@example.test`;

/**
 * Create (idempotently) the fixture board-owner (role=member) and a separate admin
 * (role=admin) used only for the diagnostics-authorization scenario. Returns the raw
 * uncraft_sess JWT for the board owner (a normal user editing their own board).
 */
export async function seedUsers({ sql }) {
  const passwordHash = await hashPassword('fixture-password-not-a-secret');
  const [owner] = await sql`
    INSERT INTO users (email, password_hash, name, plan, role)
    VALUES (${OWNER_EMAIL}, ${passwordHash}, 'Fixture Owner', 'free', 'member')
    ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
    RETURNING id, email, plan`;
  const [admin] = await sql`
    INSERT INTO users (email, password_hash, name, plan, role)
    VALUES (${ADMIN_EMAIL}, ${passwordHash}, 'Fixture Admin', 'free', 'admin')
    ON CONFLICT (email) DO UPDATE SET role = 'admin'
    RETURNING id`;
  const sessionCookie = createToken({ id: owner.id, email: owner.email, plan: owner.plan });
  return { adminUserId: admin.id, nonAdminUserId: owner.id, sessionCookie };
}

/**
 * Register the offline animated fixture page as an immutable native bundle (bytes into
 * `store`, descriptor row into `native_bundles`). Idempotent: registerNativeBundle is
 * content-addressed and persistNativeBundleDescriptor is ON CONFLICT DO NOTHING.
 */
export async function seedBundle({ sql, store }) {
  // Both callers (vitest + the runner) execute with cwd = packages/web-shell.
  const html = readFileSync(join(process.cwd(), 'e2e/fixtures/native-motion/fixture-site/index.html'), 'utf8');
  const runtimeFingerprint = 'sha256:' + createHash('sha256').update(`fixture-runtime-v1:${html}`).digest('hex');
  const descriptor = await registerNativeBundle(
    {
      assets: [{ path: 'index.html', body: html, contentType: 'text/html; charset=utf-8' }],
      entryPath: 'index.html',
      runtimeFingerprint,
      reconstructionCapabilities: { detectedEngines: ['css'], candidateControls: [] },
    },
    { store },
  );
  await persistNativeBundleDescriptor({ sql, descriptor });
  return descriptor;
}
