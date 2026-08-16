import { parseNativeBundleDescriptor } from '../native-clone/bundle-contract.js';
import {
  MOTION_MANIFEST_SCHEMA_VERSION,
  parseMotionManifest,
} from './manifest.js';

export class EditSessionStoreError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'EditSessionStoreError';
    this.code = code;
    Object.assign(this, details);
  }
}

function assertSql(sql) {
  if (typeof sql !== 'function') throw new TypeError('A tagged SQL client is required');
}

function parseJsonColumn(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function descriptorFromRow(row) {
  if (!row) return null;
  return parseNativeBundleDescriptor({
    schemaVersion: Number(row.schema_version),
    bundleId: row.bundle_id,
    storageKey: row.storage_key,
    contentHash: row.content_hash,
    entryPath: row.entry_path,
    assetIndex: parseJsonColumn(row.asset_index),
    runtimeFingerprint: row.runtime_fingerprint,
    reconstructionCapabilities: parseJsonColumn(row.reconstruction_capabilities),
  });
}

function sameDescriptor(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sessionFromRow(row) {
  if (!row) return null;
  const baseBundleId = row.base_bundle_id;
  const draftManifest = parseMotionManifest(parseJsonColumn(row.draft_manifest), {
    expectedBundleId: baseBundleId,
    runtimeFingerprint: row.base_runtime_fingerprint,
  });
  return {
    id: row.id,
    nodeId: row.node_id,
    userId: Number(row.user_id),
    baseSnapshotId: row.base_snapshot_id,
    baseBundleId,
    draftManifest,
    revision: Number(row.revision),
    status: row.status,
    expiresAt: row.expires_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at ?? null,
  };
}

function assertRevision(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('expectedRevision must be a non-negative integer');
  return value;
}

export async function persistNativeBundleDescriptor({ sql, descriptor }) {
  assertSql(sql);
  const parsed = parseNativeBundleDescriptor(descriptor);
  const rows = await sql`
    WITH inserted AS (
      INSERT INTO native_bundles (
        bundle_id, schema_version, storage_key, content_hash, entry_path,
        asset_index, runtime_fingerprint, reconstruction_capabilities
      )
      VALUES (
        ${parsed.bundleId}, ${parsed.schemaVersion}, ${parsed.storageKey}, ${parsed.contentHash},
        ${parsed.entryPath}, ${JSON.stringify(parsed.assetIndex)}::jsonb, ${parsed.runtimeFingerprint},
        ${JSON.stringify(parsed.reconstructionCapabilities)}::jsonb
      )
      ON CONFLICT DO NOTHING
      RETURNING *
    )
    SELECT * FROM inserted
    UNION ALL
    SELECT * FROM native_bundles WHERE bundle_id = ${parsed.bundleId}
    LIMIT 1
  `;
  const stored = descriptorFromRow(rows[0]);
  if (!stored || !sameDescriptor(stored, parsed)) {
    throw new EditSessionStoreError(
      'immutable_bundle_conflict',
      'The native bundle identity already belongs to different descriptor content.',
    );
  }
  return stored;
}

export async function openOrResumeEditSession({ sql, userId, nodeId, baseSnapshotId }) {
  assertSql(sql);
  const rows = await sql`
    WITH owned AS (
      SELECT n.id AS node_id, s.id AS snapshot_id, s.native_bundle_id,
             s.motion_manifest, nb.runtime_fingerprint
        FROM nodes n
        JOIN boards b ON b.id = n.board_id
        JOIN snapshots s ON s.id = ${baseSnapshotId} AND s.node_id = n.id
        JOIN native_bundles nb ON nb.bundle_id = s.native_bundle_id
       WHERE n.id = ${nodeId}
         AND b.user_id = ${userId}
         AND n.current_snapshot_id = s.id
         AND s.native_bundle_id IS NOT NULL
    ), existing AS (
      SELECT e.*
        FROM native_motion_edit_sessions e
        JOIN owned o ON o.node_id = e.node_id
       WHERE e.node_id = ${nodeId} AND e.status = 'active'
         AND e.user_id = ${userId}
       ORDER BY e.updated_at DESC
       LIMIT 1
    ), inserted AS (
      INSERT INTO native_motion_edit_sessions (
        user_id, node_id, base_snapshot_id, draft_manifest,
        draft_manifest_version, revision, status
      )
      SELECT ${userId}, o.node_id, o.snapshot_id,
             COALESCE(
               o.motion_manifest,
               jsonb_build_object(
                 'schemaVersion', 2,
                 'baseBundleId', o.native_bundle_id::text,
                 'transactions', '[]'::jsonb,
                 'controlManifest', '{}'::jsonb,
                 'responsiveManifest', '{}'::jsonb,
                 'runtimeFingerprint', o.runtime_fingerprint
               )
             ),
             2, 0, 'active'
        FROM owned o
       WHERE NOT EXISTS (SELECT 1 FROM existing)
      ON CONFLICT DO NOTHING
      RETURNING *
    ), chosen AS (
      SELECT * FROM inserted
      UNION ALL
      SELECT * FROM existing
      LIMIT 1
    )
    SELECT c.*, s.native_bundle_id::text AS base_bundle_id,
           nb.runtime_fingerprint AS base_runtime_fingerprint,
           CASE
             WHEN jsonb_typeof(c.draft_manifest) = 'object'
             THEN NULLIF(c.draft_manifest->>'schemaVersion', '')::int
             ELSE NULL
           END AS stored_manifest_version
      FROM chosen c
      JOIN snapshots s ON s.id = c.base_snapshot_id
      JOIN native_bundles nb ON nb.bundle_id = s.native_bundle_id
  `;
  const session = sessionFromRow(rows[0]);
  if (!session) {
    throw new EditSessionStoreError('not_found', 'Owned native snapshot not found.');
  }
  if (rows[0].stored_manifest_version != null
      && Number(rows[0].stored_manifest_version) !== MOTION_MANIFEST_SCHEMA_VERSION) {
    return updateEditSessionDraft({
      sql,
      userId,
      nodeId,
      sessionId: session.id,
      expectedRevision: session.revision,
      draftManifest: session.draftManifest,
    });
  }
  return session;
}

export async function readEditSessionConflict({ sql, userId, nodeId, sessionId, expectedRevision }) {
  assertSql(sql);
  assertRevision(expectedRevision);
  const rows = await sql`
    SELECT e.id, e.node_id, e.user_id, e.base_snapshot_id, e.revision, e.status,
           s.native_bundle_id::text AS base_bundle_id,
           n.current_snapshot_id
      FROM native_motion_edit_sessions e
      JOIN nodes n ON n.id = e.node_id
      JOIN boards b ON b.id = n.board_id
      JOIN snapshots s ON s.id = e.base_snapshot_id
     WHERE e.id = ${sessionId}
       AND e.node_id = ${nodeId}
       AND e.user_id = ${userId}
       AND b.user_id = ${userId}
  `;
  const row = rows[0];
  if (!row) {
    return { conflict: true, reason: 'not_found', currentRevision: null, status: null };
  }
  let reason = null;
  if (row.status !== 'active') reason = 'session_closed';
  else if (row.current_snapshot_id !== row.base_snapshot_id) reason = 'base_snapshot_changed';
  else if (Number(row.revision) !== expectedRevision) reason = 'revision_conflict';
  return {
    conflict: Boolean(reason),
    reason,
    currentRevision: Number(row.revision),
    status: row.status,
    baseBundleId: row.base_bundle_id,
    baseSnapshotId: row.base_snapshot_id,
    currentSnapshotId: row.current_snapshot_id,
  };
}

function conflictError(conflict, manifest = null) {
  if (conflict.reason === 'not_found') {
    return new EditSessionStoreError('not_found', 'Owned edit session not found.');
  }
  if (manifest && conflict.baseBundleId !== manifest.baseBundleId) {
    return new EditSessionStoreError('base_bundle_mismatch', 'Draft manifest does not match the base snapshot bundle.', {
      currentRevision: conflict.currentRevision,
      status: conflict.status,
    });
  }
  return new EditSessionStoreError(
    conflict.reason || 'revision_conflict',
    'The edit session changed before this write could be applied.',
    { currentRevision: conflict.currentRevision, status: conflict.status },
  );
}

export async function updateEditSessionDraft({
  sql,
  userId,
  nodeId,
  sessionId,
  expectedRevision,
  draftManifest,
}) {
  assertSql(sql);
  assertRevision(expectedRevision);
  const manifest = parseMotionManifest(draftManifest);
  const rows = await sql`
    UPDATE native_motion_edit_sessions e
       SET draft_manifest = ${JSON.stringify(manifest)}::jsonb,
           draft_manifest_version = ${MOTION_MANIFEST_SCHEMA_VERSION},
           revision = e.revision + 1,
           updated_at = NOW()
      FROM snapshots s, nodes n, boards b
     WHERE e.id = ${sessionId}
       AND e.node_id = ${nodeId}
       AND e.user_id = ${userId}
       AND e.status = 'active'
       AND e.revision = ${expectedRevision}
       AND s.id = e.base_snapshot_id
       AND s.native_bundle_id::text = ${manifest.baseBundleId}
       AND n.id = e.node_id
       AND n.current_snapshot_id = e.base_snapshot_id
       AND b.id = n.board_id
       AND b.user_id = ${userId}
    RETURNING e.*, s.native_bundle_id::text AS base_bundle_id
  `;
  if (rows[0]) return sessionFromRow(rows[0]);
  const conflict = await readEditSessionConflict({ sql, userId, nodeId, sessionId, expectedRevision });
  throw conflictError(conflict, manifest);
}

export async function commitEditSession({
  sql,
  userId,
  nodeId,
  sessionId,
  expectedRevision,
  continueEditing = false,
}) {
  assertSql(sql);
  assertRevision(expectedRevision);
  const rows = continueEditing ? await sql`
    WITH eligible AS (
      SELECT e.id, e.node_id, e.base_snapshot_id, e.draft_manifest, e.revision,
             s.native_bundle_id
        FROM native_motion_edit_sessions e
        JOIN nodes n ON n.id = e.node_id
        JOIN boards b ON b.id = n.board_id
        JOIN snapshots s ON s.id = e.base_snapshot_id
       WHERE e.id = ${sessionId}
         AND e.node_id = ${nodeId}
         AND e.user_id = ${userId}
         AND b.user_id = ${userId}
         AND e.status = 'active'
         AND e.revision = ${expectedRevision}
         AND n.current_snapshot_id = e.base_snapshot_id
         AND s.native_bundle_id IS NOT NULL
         AND e.draft_manifest_version = ${MOTION_MANIFEST_SCHEMA_VERSION}
         AND e.draft_manifest->>'schemaVersion' = ${String(MOTION_MANIFEST_SCHEMA_VERSION)}
         AND e.draft_manifest->>'baseBundleId' = s.native_bundle_id::text
       FOR UPDATE OF e, n
    ), created_snapshot AS (
      INSERT INTO snapshots (
        node_id, html, design_md, screenshot_url, source, parent_snapshot_id,
        native_bundle_id, motion_manifest, motion_manifest_version
      )
      SELECT node_id, NULL, NULL, NULL, 'native-edit', base_snapshot_id,
             native_bundle_id, draft_manifest, ${MOTION_MANIFEST_SCHEMA_VERSION}
        FROM eligible
      RETURNING id, node_id
    ), advanced_node AS (
      UPDATE nodes n
         SET current_snapshot_id = created_snapshot.id
        FROM created_snapshot, eligible
       WHERE n.id = created_snapshot.node_id AND n.id = eligible.node_id
      RETURNING n.id
    ), continued_session AS (
      UPDATE native_motion_edit_sessions e
         SET base_snapshot_id = created_snapshot.id,
             revision = e.revision + 1,
             updated_at = NOW()
        FROM created_snapshot, advanced_node, eligible
       WHERE e.id = eligible.id AND advanced_node.id = eligible.node_id
      RETURNING e.id, e.node_id, e.base_snapshot_id, e.revision, e.status,
                created_snapshot.id AS snapshot_id,
                eligible.native_bundle_id::text AS base_bundle_id
    )
    SELECT id AS session_id, node_id, base_snapshot_id, revision, status,
           snapshot_id, base_bundle_id
      FROM continued_session
  ` : await sql`
    WITH eligible AS (
      SELECT e.id, e.node_id, e.base_snapshot_id, e.draft_manifest, e.revision,
             s.native_bundle_id
        FROM native_motion_edit_sessions e
        JOIN nodes n ON n.id = e.node_id
        JOIN boards b ON b.id = n.board_id
        JOIN snapshots s ON s.id = e.base_snapshot_id
       WHERE e.id = ${sessionId}
         AND e.node_id = ${nodeId}
         AND e.user_id = ${userId}
         AND b.user_id = ${userId}
         AND e.status = 'active'
         AND e.revision = ${expectedRevision}
         AND n.current_snapshot_id = e.base_snapshot_id
         AND s.native_bundle_id IS NOT NULL
         AND e.draft_manifest_version = ${MOTION_MANIFEST_SCHEMA_VERSION}
         AND e.draft_manifest->>'schemaVersion' = ${String(MOTION_MANIFEST_SCHEMA_VERSION)}
         AND e.draft_manifest->>'baseBundleId' = s.native_bundle_id::text
       FOR UPDATE OF e, n
    ), created_snapshot AS (
      INSERT INTO snapshots (
        node_id, html, design_md, screenshot_url, source, parent_snapshot_id,
        native_bundle_id, motion_manifest, motion_manifest_version
      )
      SELECT node_id, NULL, NULL, NULL, 'native-edit', base_snapshot_id,
             native_bundle_id, draft_manifest, ${MOTION_MANIFEST_SCHEMA_VERSION}
        FROM eligible
      RETURNING id, node_id
    ), advanced_node AS (
      UPDATE nodes n
         SET current_snapshot_id = created_snapshot.id
        FROM created_snapshot, eligible
       WHERE n.id = created_snapshot.node_id AND n.id = eligible.node_id
      RETURNING n.id
    ), closed_session AS (
      UPDATE native_motion_edit_sessions e
         SET status = 'committed', updated_at = NOW(), closed_at = NOW()
        FROM created_snapshot, advanced_node, eligible
       WHERE e.id = eligible.id AND advanced_node.id = eligible.node_id
      RETURNING e.id, e.node_id, e.revision, e.status,
                created_snapshot.id AS snapshot_id,
                created_snapshot.id AS base_snapshot_id,
                eligible.native_bundle_id::text AS base_bundle_id
    )
    SELECT id AS session_id, node_id, base_snapshot_id, revision, status,
           snapshot_id, base_bundle_id
      FROM closed_session
  `;
  const row = rows[0];
  if (!row) {
    const conflict = await readEditSessionConflict({ sql, userId, nodeId, sessionId, expectedRevision });
    throw conflictError(conflict);
  }
  return {
    sessionId: row.session_id,
    snapshotId: row.snapshot_id,
    baseSnapshotId: row.base_snapshot_id || row.snapshot_id,
    baseBundleId: row.base_bundle_id,
    nodeId: row.node_id,
    revision: Number(row.revision),
    status: row.status,
  };
}

async function closeEditSession({ sql, userId, nodeId, sessionId, status }) {
  assertSql(sql);
  const rows = await sql`
    UPDATE native_motion_edit_sessions e
       SET status = ${status}, updated_at = NOW(), closed_at = NOW()
      FROM snapshots s, nodes n, boards b
     WHERE e.id = ${sessionId}
       AND e.node_id = ${nodeId}
       AND e.user_id = ${userId}
       AND e.status = 'active'
       AND s.id = e.base_snapshot_id
       AND n.id = e.node_id
       AND b.id = n.board_id
       AND b.user_id = ${userId}
    RETURNING e.*, s.native_bundle_id::text AS base_bundle_id
  `;
  const session = sessionFromRow(rows[0]);
  if (!session) throw new EditSessionStoreError('not_found', 'Owned active edit session not found.');
  return session;
}

export function discardEditSession(input) {
  return closeEditSession({ ...input, status: 'discarded' });
}

export function expireEditSession(input) {
  return closeEditSession({ ...input, status: 'expired' });
}
