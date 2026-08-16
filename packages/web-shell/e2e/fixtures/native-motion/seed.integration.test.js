// Integration tests for the native-motion fixture seed. Gated on the isolated DB env
// (E2E_ISOLATED_DATABASE_URL); skipped otherwise so CI without the disposable DB stays green.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

const HAS_DB = !!process.env.E2E_ISOLATED_DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;

d('seed (isolated DB)', () => {
  let sql, seedUsers, seedBundle, seedBoardAndNodes, seedNativeMotionFixture,
    createConfiguredBundleStore, createEmptyMotionManifest, jwt;
  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.E2E_ISOLATED_DATABASE_URL;
    ({ sql } = await import('../../../lib/db.js'));
    ({ seedUsers, seedBundle, seedBoardAndNodes, seedNativeMotionFixture } = await import('./seed.mjs'));
    ({ createConfiguredBundleStore } = await import('../../../lib/native-clone/bundle-store.js'));
    ({ createEmptyMotionManifest } = await import('../../../lib/motion-editor/manifest.js'));
    jwt = (await import('jsonwebtoken')).default;
  });

  // The seed is idempotent by REUSE — whichever manifest seeds a node's base
  // snapshot first wins. In the shared test DB that makes results order-dependent,
  // so each test starts from a clean board (users + bundle persist idempotently).
  // A real gate run seeds a fresh disposable DB, so this only affects the suite.
  beforeEach(async () => {
    await sql`DELETE FROM boards WHERE name = 'e2e-native-motion-fixture'`;
  });

  it('seedUsers creates an admin + non-admin and a valid non-admin cookie', async () => {
    const r = await seedUsers({ sql });
    expect(typeof r.adminUserId).toBe('number');
    expect(typeof r.nonAdminUserId).toBe('number');
    const decoded = jwt.verify(r.sessionCookie, process.env.JWT_SECRET);
    expect(decoded.userId).toBe(r.nonAdminUserId);
    const [admin] = await sql`SELECT role FROM users WHERE id = ${r.adminUserId}`;
    expect(admin.role).toBe('admin');
    const [owner] = await sql`SELECT role FROM users WHERE id = ${r.nonAdminUserId}`;
    expect(owner.role).toBe('member');
  });

  it('seedUsers is idempotent (re-run returns the same ids)', async () => {
    const a = await seedUsers({ sql });
    const b = await seedUsers({ sql });
    expect(b.adminUserId).toBe(a.adminUserId);
    expect(b.nonAdminUserId).toBe(a.nonAdminUserId);
  });

  it('seedBundle registers a native bundle + descriptor row (idempotent)', async () => {
    const store = createConfiguredBundleStore();
    const first = await seedBundle({ sql, store });
    expect(first.bundleId).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    const [row] = await sql`SELECT content_hash FROM native_bundles WHERE bundle_id = ${first.bundleId}`;
    expect(row.content_hash).toBe(first.contentHash);
    const second = await seedBundle({ sql, store });
    expect(second.bundleId).toBe(first.bundleId); // content-addressed → stable
  });

  it('seedBoardAndNodes creates a board + two native nodes with native snapshots (idempotent)', async () => {
    const { nonAdminUserId } = await seedUsers({ sql });
    const store = createConfiguredBundleStore();
    const descriptor = await seedBundle({ sql, store });
    const primaryManifest = createEmptyMotionManifest({
      baseBundleId: descriptor.bundleId,
      runtimeFingerprint: descriptor.runtimeFingerprint,
    });

    const r = await seedBoardAndNodes({ sql, ownerUserId: nonAdminUserId, descriptor, primaryManifest });
    expect(r.boardId).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.primaryNodeId).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.secondaryNodeId).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.primaryNodeId).not.toBe(r.secondaryNodeId);
    expect(r.boardPath).toBe('/canvas/' + r.boardId);

    for (const nodeId of [r.primaryNodeId, r.secondaryNodeId]) {
      const [node] = await sql`SELECT current_snapshot_id FROM nodes WHERE id = ${nodeId}`;
      expect(node.current_snapshot_id).toBeTruthy();
      const [snap] = await sql`
        SELECT native_bundle_id, motion_manifest_version
          FROM snapshots WHERE id = ${node.current_snapshot_id}`;
      expect(snap.native_bundle_id).toBe(descriptor.bundleId);
      expect(Number(snap.motion_manifest_version)).toBe(2);
    }

    // Re-run returns the same board + node ids (idempotent) and does not duplicate the base snapshot.
    const again = await seedBoardAndNodes({ sql, ownerUserId: nonAdminUserId, descriptor, primaryManifest });
    expect(again.boardId).toBe(r.boardId);
    expect(again.primaryNodeId).toBe(r.primaryNodeId);
    expect(again.secondaryNodeId).toBe(r.secondaryNodeId);
    const [{ count }] = await sql`
      SELECT COUNT(*)::int AS count FROM snapshots
       WHERE node_id = ${r.primaryNodeId} AND source = 'native-bundle'`;
    expect(count).toBe(1);
  });

  it('seedNativeMotionFixture returns all seven fields; primary node resolves to NATIVE', async () => {
    const { resolveNodeEditorKind, snapshotEditorMetadata, NODE_EDITOR_KIND } =
      await import('../../../lib/node-editor-kind.js');
    const r = await seedNativeMotionFixture({ sql });
    for (const k of [
      'boardId', 'primaryNodeId', 'secondaryNodeId', 'sessionCookie',
      'adminUserId', 'nonAdminUserId', 'boardPath',
    ]) {
      expect(r[k], `field ${k}`).toBeTruthy();
    }
    expect(r.boardPath).toBe('/canvas/' + r.boardId);
    const decoded = jwt.verify(r.sessionCookie, process.env.JWT_SECRET);
    expect(decoded.userId).toBe(r.nonAdminUserId);

    // Load the primary node the way the canvas page does and confirm it edits NATIVE.
    const [node] = await sql`
      SELECT n.id, n.kind, n.meta, n.current_snapshot_id,
             s.source AS current_snapshot_source,
             s.native_bundle_id AS current_native_bundle_id,
             s.motion_manifest_version AS current_motion_manifest_version
        FROM nodes n JOIN snapshots s ON s.id = n.current_snapshot_id
       WHERE n.id = ${r.primaryNodeId}`;
    const snapMeta = snapshotEditorMetadata(node);
    expect(resolveNodeEditorKind(node, snapMeta, { nativeMotionCanvasEdit: true }))
      .toBe(NODE_EDITOR_KIND.NATIVE);

    // The primary node persists the RICH manifest: three accepted (ready) controls
    // (ctl-ok healthy + ctl-recover + ctl-exhausted for the Task-14 fault scenarios).
    const [snap] = await sql`
      SELECT motion_manifest FROM snapshots WHERE id = ${node.current_snapshot_id}`;
    const controls = snap.motion_manifest?.controlManifest?.controls || [];
    expect(controls).toHaveLength(3);
    expect(controls.every((c) => c.status === 'ready')).toBe(true);
  });

  it('leaves ≥2 committed native-edit snapshots on the primary node (idempotent)', async () => {
    const r = await seedNativeMotionFixture({ sql });
    const edits = await sql`
      SELECT id FROM snapshots
       WHERE node_id = ${r.primaryNodeId} AND source = 'native-edit'`;
    expect(edits.length).toBeGreaterThanOrEqual(2);

    // current_snapshot_id points at a committed native-edit snapshot (history advanced).
    const [cur] = await sql`
      SELECT s.source FROM nodes n JOIN snapshots s ON s.id = n.current_snapshot_id
       WHERE n.id = ${r.primaryNodeId}`;
    expect(cur.source).toBe('native-edit');

    // Re-running the seed does not pile up more history.
    await seedNativeMotionFixture({ sql });
    const [{ count }] = await sql`
      SELECT COUNT(*)::int AS count FROM snapshots
       WHERE node_id = ${r.primaryNodeId} AND source = 'native-edit'`;
    expect(count).toBe(edits.length);
  });
});
