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
import { createEmptyMotionManifest } from '../../../lib/motion-editor/manifest.js';

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

// The one fixture board is named after the tag so a re-run finds and reuses it.
const BOARD_NAME = FIXTURE_TAG;

/**
 * Idempotently ensure one native node exists on `boardId` for `role` ('primary' |
 * 'secondary'), carrying a base `native-bundle` snapshot. Native-ness lives in the
 * snapshot, not the node kind (`kind='site'` + snapshot.native_bundle_id +
 * motion_manifest_version=2). Re-runs never duplicate the base snapshot and never
 * clobber a `current_snapshot_id` that later edit history (Task 7) has advanced.
 */
async function upsertNativeNode({ sql, boardId, role, descriptor, manifest }) {
  const [existing] = await sql`
    SELECT id, current_snapshot_id FROM nodes
     WHERE board_id = ${boardId} AND meta->>'fixtureRole' = ${role}
     LIMIT 1`;
  let nodeId = existing?.id;
  if (!nodeId) {
    const [node] = await sql`
      INSERT INTO nodes (board_id, kind, width, height, meta)
      VALUES (${boardId}, 'site', 1280, 800, ${JSON.stringify({ fixtureRole: role })}::jsonb)
      RETURNING id`;
    nodeId = node.id;
  }

  const [existingSnap] = await sql`
    SELECT id FROM snapshots
     WHERE node_id = ${nodeId} AND source = 'native-bundle'
     ORDER BY created_at ASC LIMIT 1`;
  let snapshotId = existingSnap?.id;
  if (!snapshotId) {
    // The snapshots_native_manifest_shape CHECK requires baseBundleId == native_bundle_id
    // and schemaVersion/version 2 — createEmptyMotionManifest + this bundleId satisfy it.
    const [snap] = await sql`
      INSERT INTO snapshots (node_id, source, native_bundle_id, motion_manifest, motion_manifest_version)
      VALUES (${nodeId}, 'native-bundle', ${descriptor.bundleId}, ${JSON.stringify(manifest)}::jsonb, 2)
      RETURNING id`;
    snapshotId = snap.id;
  }

  if (!existing?.current_snapshot_id) {
    await sql`UPDATE nodes SET current_snapshot_id = ${snapshotId} WHERE id = ${nodeId}`;
  }
  return nodeId;
}

/**
 * Seed the single fixture board plus its two native nodes (primary = the rich
 * scenario surface; secondary = runtime/message/asset isolation only). Idempotent:
 * a re-run reuses the existing board (owner + FIXTURE_TAG name) and its two nodes.
 */
export async function seedBoardAndNodes({ sql, ownerUserId, descriptor, primaryManifest }) {
  const [existingBoard] = await sql`
    SELECT id FROM boards WHERE user_id = ${ownerUserId} AND name = ${BOARD_NAME} LIMIT 1`;
  let boardId = existingBoard?.id;
  if (!boardId) {
    const [board] = await sql`
      INSERT INTO boards (user_id, name) VALUES (${ownerUserId}, ${BOARD_NAME}) RETURNING id`;
    boardId = board.id;
  }

  const primaryNodeId = await upsertNativeNode({
    sql, boardId, role: 'primary', descriptor, manifest: primaryManifest,
  });
  const secondaryManifest = createEmptyMotionManifest({
    baseBundleId: descriptor.bundleId,
    runtimeFingerprint: descriptor.runtimeFingerprint,
  });
  const secondaryNodeId = await upsertNativeNode({
    sql, boardId, role: 'secondary', descriptor, manifest: secondaryManifest,
  });

  return { boardId, primaryNodeId, secondaryNodeId, boardPath: '/canvas/' + boardId };
}
