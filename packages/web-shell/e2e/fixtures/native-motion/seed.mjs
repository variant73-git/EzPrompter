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
import {
  persistNativeBundleDescriptor,
  openOrResumeEditSession,
  updateEditSessionDraft,
  commitEditSession,
} from '../../../lib/motion-editor/edit-session-store.js';
import { createEmptyMotionManifest } from '../../../lib/motion-editor/manifest.js';
import { createConfiguredBundleStore } from '../../../lib/native-clone/bundle-store.js';
import { buildFixtureManifest } from './build-fixture-manifest.mjs';

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
async function upsertNativeNode({ sql, boardId, role, descriptor, manifest, posX = 0, posY = 0 }) {
  const [existing] = await sql`
    SELECT id, current_snapshot_id FROM nodes
     WHERE board_id = ${boardId} AND meta->>'fixtureRole' = ${role}
     LIMIT 1`;
  let nodeId = existing?.id;
  if (!nodeId) {
    // Distinct pos_x/pos_y so the two 1280-wide nodes never overlap on the board
    // (pos_x/pos_y default to 0 → both would stack and intercept each other's
    // clicks). The scenarios reach the primary node via ?focusNode= framing.
    const [node] = await sql`
      INSERT INTO nodes (board_id, kind, pos_x, pos_y, width, height, meta)
      VALUES (${boardId}, 'site', ${posX}, ${posY}, 1280, 800, ${JSON.stringify({ fixtureRole: role })}::jsonb)
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
    sql, boardId, role: 'primary', descriptor, manifest: primaryManifest, posX: 0, posY: 0,
  });
  const secondaryManifest = createEmptyMotionManifest({
    baseBundleId: descriptor.bundleId,
    runtimeFingerprint: descriptor.runtimeFingerprint,
  });
  const secondaryNodeId = await upsertNativeNode({
    sql, boardId, role: 'secondary', descriptor, manifest: secondaryManifest, posX: 1700, posY: 0,
  });

  return { boardId, primaryNodeId, secondaryNodeId, boardPath: '/canvas/' + boardId };
}

// Distinct hero-opacity desktop values per committed edit → the two history
// snapshots differ from the base (1) and from each other, giving the snapshot-restore
// scenario real state to compare. Responsive-only, so this stays decoupled from the
// control set.
const HISTORY_DESKTOP_OPACITIES = [0.7, 0.5];

function withHeroDesktopOpacity(manifest, desktopValue) {
  const next = JSON.parse(JSON.stringify(manifest));
  const prop = next.responsiveManifest?.properties?.['hero:opacity'];
  if (prop?.overrides) prop.overrides.desktop = desktopValue;
  return next;
}

/**
 * Drive the REAL edit-session helpers to leave ≥2 committed native-edit snapshots on
 * the primary node, each advancing current_snapshot_id (source='native-edit'). Gives
 * the snapshot-restore scenario genuine history. Idempotent: if ≥2 native-edit
 * snapshots already exist, it returns them without creating more. One session per
 * commit (each commit closes its session), respecting the one-active-session index.
 */
export async function seedSnapshotHistory({ sql, ownerUserId, primaryNodeId }) {
  const existing = await sql`
    SELECT id FROM snapshots
     WHERE node_id = ${primaryNodeId} AND source = 'native-edit'
     ORDER BY created_at ASC`;
  if (existing.length >= HISTORY_DESKTOP_OPACITIES.length) {
    return { committedSnapshotIds: existing.map((row) => row.id) };
  }

  const [node] = await sql`SELECT current_snapshot_id FROM nodes WHERE id = ${primaryNodeId}`;
  let baseSnapshotId = node?.current_snapshot_id;
  if (!baseSnapshotId) throw new Error('seed: primary node has no base snapshot to edit');

  const committedSnapshotIds = [];
  for (const desktopValue of HISTORY_DESKTOP_OPACITIES) {
    const session = await openOrResumeEditSession({
      sql, userId: ownerUserId, nodeId: primaryNodeId, baseSnapshotId,
    });
    const updated = await updateEditSessionDraft({
      sql, userId: ownerUserId, nodeId: primaryNodeId,
      sessionId: session.id, expectedRevision: session.revision,
      draftManifest: withHeroDesktopOpacity(session.draftManifest, desktopValue),
    });
    const committed = await commitEditSession({
      sql, userId: ownerUserId, nodeId: primaryNodeId,
      sessionId: updated.id, expectedRevision: updated.revision,
    });
    committedSnapshotIds.push(committed.snapshotId);
    baseSnapshotId = committed.snapshotId;
  }
  return { committedSnapshotIds };
}

/**
 * The full mutation pack. Guards the DB target (isolated endpoint only) BEFORE any
 * write, then seeds users, the animated bundle, and the board + two native nodes.
 * Idempotent — safe to re-run. Returns the seven values the runner turns into the
 * four E2E_NATIVE_MOTION_* env vars (+ the two user ids for the diagnostics scenario).
 *
 * The primary node carries the rich `buildFixtureManifest` (accepted control +
 * responsive bindings); the secondary node stays on an empty manifest.
 */
export async function seedNativeMotionFixture({ sql }) {
  assertIsolatedTarget(process.env.DATABASE_URL, { allowlistEndpoint: ALLOWLIST_ENDPOINT });

  const store = createConfiguredBundleStore();
  const { adminUserId, nonAdminUserId, sessionCookie } = await seedUsers({ sql });
  const descriptor = await seedBundle({ sql, store });
  const primaryManifest = buildFixtureManifest({
    baseBundleId: descriptor.bundleId,
    runtimeFingerprint: descriptor.runtimeFingerprint,
  });
  const { boardId, primaryNodeId, secondaryNodeId, boardPath } = await seedBoardAndNodes({
    sql, ownerUserId: nonAdminUserId, descriptor, primaryManifest,
  });
  await seedSnapshotHistory({ sql, ownerUserId: nonAdminUserId, primaryNodeId });

  return {
    boardId, primaryNodeId, secondaryNodeId, boardPath,
    sessionCookie, adminUserId, nonAdminUserId,
  };
}
