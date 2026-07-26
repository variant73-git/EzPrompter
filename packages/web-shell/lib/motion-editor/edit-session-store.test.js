import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  commitEditSession,
  discardEditSession,
  expireEditSession,
  openOrResumeEditSession,
  persistNativeBundleDescriptor,
  readEditSessionConflict,
  updateEditSessionDraft,
} from './edit-session-store.js';
import { createEmptyMotionManifest } from './manifest.js';

const NODE_ID = '11111111-1111-4111-8111-111111111111';
const SNAPSHOT_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const BUNDLE_ID = '44444444-4444-4444-8444-444444444444';
const RUNTIME_FINGERPRINT = `sha256:${'a'.repeat(64)}`;

function manifest() {
  return createEmptyMotionManifest({ baseBundleId: BUNDLE_ID, runtimeFingerprint: RUNTIME_FINGERPRINT });
}

function sessionRow(overrides = {}) {
  return {
    id: SESSION_ID,
    node_id: NODE_ID,
    user_id: 42,
    base_snapshot_id: SNAPSHOT_ID,
    base_bundle_id: BUNDLE_ID,
    base_runtime_fingerprint: RUNTIME_FINGERPRINT,
    draft_manifest: manifest(),
    stored_manifest_version: 2,
    revision: 0,
    status: 'active',
    created_at: '2026-07-26T10:00:00.000Z',
    updated_at: '2026-07-26T10:00:00.000Z',
    current_snapshot_id: SNAPSHOT_ID,
    ...overrides,
  };
}

function createSql(results = []) {
  const calls = [];
  const sql = vi.fn((strings, ...values) => {
    calls.push({ text: Array.isArray(strings) ? strings.join(' ') : String(strings), values });
    return Promise.resolve(results.shift() || []);
  });
  sql.calls = calls;
  return sql;
}

function descriptorRow(overrides = {}) {
  return {
    bundle_id: BUNDLE_ID,
    schema_version: 1,
    storage_key: `native-bundles/v1/${BUNDLE_ID}`,
    content_hash: `sha256:${'b'.repeat(64)}`,
    entry_path: 'index.html',
    asset_index: [{ path: 'index.html', contentType: 'text/html', byteLength: 1, contentHash: `sha256:${'c'.repeat(64)}` }],
    runtime_fingerprint: RUNTIME_FINGERPRINT,
    reconstruction_capabilities: { detectedEngines: ['waapi'], candidateControls: [] },
    created_at: '2026-07-26T10:00:00.000Z',
    ...overrides,
  };
}

describe('native motion edit-session store', () => {
  it('persists an immutable native bundle descriptor without exposing provider state', async () => {
    const sql = createSql([[descriptorRow()]]);
    const stored = await persistNativeBundleDescriptor({
      sql,
      descriptor: {
        schemaVersion: 1,
        bundleId: BUNDLE_ID,
        storageKey: `native-bundles/v1/${BUNDLE_ID}`,
        contentHash: `sha256:${'b'.repeat(64)}`,
        entryPath: 'index.html',
        assetIndex: descriptorRow().asset_index,
        runtimeFingerprint: RUNTIME_FINGERPRINT,
        reconstructionCapabilities: descriptorRow().reconstruction_capabilities,
      },
    });

    expect(stored).toMatchObject({ bundleId: BUNDLE_ID, contentHash: `sha256:${'b'.repeat(64)}` });
    expect(sql.calls[0].text).toContain('INSERT INTO native_bundles');
  });

  it('rejects a database descriptor collision instead of mutating it', async () => {
    const sql = createSql([[descriptorRow({ content_hash: `sha256:${'d'.repeat(64)}` })]]);
    await expect(persistNativeBundleDescriptor({
      sql,
      descriptor: {
        schemaVersion: 1,
        bundleId: BUNDLE_ID,
        storageKey: `native-bundles/v1/${BUNDLE_ID}`,
        contentHash: `sha256:${'b'.repeat(64)}`,
        entryPath: 'index.html',
        assetIndex: descriptorRow().asset_index,
        runtimeFingerprint: RUNTIME_FINGERPRINT,
        reconstructionCapabilities: descriptorRow().reconstruction_capabilities,
      },
    })).rejects.toMatchObject({ code: 'immutable_bundle_conflict' });
    expect(sql.calls[0].text).not.toMatch(/DO UPDATE/i);
  });

  it('creates or resumes a session only through an owned native snapshot', async () => {
    const sql = createSql([[sessionRow()]]);
    const opened = await openOrResumeEditSession({
      sql, userId: 42, nodeId: NODE_ID, baseSnapshotId: SNAPSHOT_ID,
    });

    expect(opened).toMatchObject({
      id: SESSION_ID, nodeId: NODE_ID, userId: 42, baseSnapshotId: SNAPSHOT_ID,
      baseBundleId: BUNDLE_ID, revision: 0, status: 'active',
    });
    expect(sql.calls[0].text).toMatch(/JOIN\s+boards/i);
    expect(sql.calls[0].text).toMatch(/native_bundle_id\s+IS\s+NOT\s+NULL/i);
  });

  it('does not create a session for an unowned or non-native snapshot', async () => {
    const sql = createSql([[]]);
    await expect(openOrResumeEditSession({
      sql, userId: 99, nodeId: NODE_ID, baseSnapshotId: SNAPSHOT_ID,
    })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('normalizes a resumed version-1 draft before it can be committed', async () => {
    const legacyDraft = {
      schemaVersion: 1,
      baseBundleId: BUNDLE_ID,
      runtimeFingerprint: RUNTIME_FINGERPRINT,
      patches: [],
    };
    const sql = createSql([
      [sessionRow({ draft_manifest: legacyDraft, stored_manifest_version: 1 })],
      [sessionRow({ draft_manifest: manifest(), revision: 1, stored_manifest_version: 2 })],
    ]);

    const resumed = await openOrResumeEditSession({
      sql, userId: 42, nodeId: NODE_ID, baseSnapshotId: SNAPSHOT_ID,
    });
    expect(resumed.draftManifest.schemaVersion).toBe(2);
    expect(resumed.revision).toBe(1);
    expect(sql).toHaveBeenCalledTimes(2);
  });

  it('rejects a stale draft write and reports the current revision read-only', async () => {
    const sql = createSql([[], [sessionRow({ revision: 3 })]]);
    await expect(updateEditSessionDraft({
      sql,
      userId: 42,
      nodeId: NODE_ID,
      sessionId: SESSION_ID,
      expectedRevision: 2,
      draftManifest: manifest(),
    })).rejects.toMatchObject({ code: 'revision_conflict', currentRevision: 3 });
    expect(sql.calls[0].text).toMatch(/revision\s*=/i);
    expect(sql.calls[1].text).toMatch(/^\s*SELECT/i);
  });

  it('rejects a draft anchored to a different bundle', async () => {
    const otherManifest = createEmptyMotionManifest({
      baseBundleId: '77777777-7777-4777-8777-777777777777',
      runtimeFingerprint: RUNTIME_FINGERPRINT,
    });
    const sql = createSql([[], [sessionRow()]]);
    await expect(updateEditSessionDraft({
      sql,
      userId: 42,
      nodeId: NODE_ID,
      sessionId: SESSION_ID,
      expectedRevision: 0,
      draftManifest: otherManifest,
    })).rejects.toMatchObject({ code: 'base_bundle_mismatch' });
  });

  it('commits snapshot, node pointer, and session state in one atomic statement', async () => {
    const sql = createSql([[{
        session_id: SESSION_ID,
        snapshot_id: '55555555-5555-4555-8555-555555555555',
        node_id: NODE_ID,
        revision: 2,
        status: 'committed',
      }]]);

    const committed = await commitEditSession({
      sql, userId: 42, nodeId: NODE_ID, sessionId: SESSION_ID, expectedRevision: 2,
    });
    expect(committed).toMatchObject({ status: 'committed', nodeId: NODE_ID });
    expect(sql).toHaveBeenCalledTimes(1);
    const statement = sql.calls[0].text;
    expect(statement).toContain('INSERT INTO snapshots');
    expect(statement).toContain('UPDATE nodes');
    expect(statement).toContain('UPDATE native_motion_edit_sessions');
  });

  it('can save a version while keeping the same session active on the new base', async () => {
    const nextSnapshotId = '55555555-5555-4555-8555-555555555555';
    const sql = createSql([[{
      session_id: SESSION_ID,
      snapshot_id: nextSnapshotId,
      base_snapshot_id: nextSnapshotId,
      base_bundle_id: BUNDLE_ID,
      node_id: NODE_ID,
      revision: 3,
      status: 'active',
    }]]);

    const committed = await commitEditSession({
      sql,
      userId: 42,
      nodeId: NODE_ID,
      sessionId: SESSION_ID,
      expectedRevision: 2,
      continueEditing: true,
    });

    expect(committed).toMatchObject({
      sessionId: SESSION_ID,
      snapshotId: nextSnapshotId,
      baseSnapshotId: nextSnapshotId,
      baseBundleId: BUNDLE_ID,
      revision: 3,
      status: 'active',
    });
    expect(sql.calls[0].text).toMatch(/SET\s+base_snapshot_id\s*=\s*created_snapshot\.id/i);
    expect(sql.calls[0].text).not.toMatch(/status\s*=\s*'committed'/i);
  });

  it('discards or expires only the mutable session row', async () => {
    const discardSql = createSql([[sessionRow({ status: 'discarded' })]]);
    const expireSql = createSql([[sessionRow({ status: 'expired' })]]);

    await discardEditSession({ sql: discardSql, userId: 42, nodeId: NODE_ID, sessionId: SESSION_ID });
    await expireEditSession({ sql: expireSql, userId: 42, nodeId: NODE_ID, sessionId: SESSION_ID });

    expect(discardSql.calls[0].text).not.toMatch(/UPDATE\s+snapshots/i);
    expect(expireSql.calls[0].text).not.toMatch(/UPDATE\s+snapshots/i);
  });

  it('detects conflicts without mutating state', async () => {
    const sql = createSql([[sessionRow({ revision: 7 })]]);
    const conflict = await readEditSessionConflict({
      sql, userId: 42, nodeId: NODE_ID, sessionId: SESSION_ID, expectedRevision: 4,
    });
    expect(conflict).toMatchObject({ conflict: true, currentRevision: 7, status: 'active' });
    expect(sql.calls[0].text).toMatch(/^\s*SELECT/i);
    expect(sql.calls[0].text).not.toMatch(/INSERT|UPDATE|DELETE/i);
  });

  it('declares one active session per node and non-orphaning bundle references', async () => {
    const migration = await readFile(resolve(process.cwd(), 'migrations/2026-07-26-native-motion-editing.sql'), 'utf8');
    expect(migration).toMatch(/UNIQUE INDEX[\s\S]+node_id[\s\S]+WHERE status = 'active'/i);
    expect(migration).toMatch(/native_bundle_id[\s\S]+ON DELETE RESTRICT/i);
  });
});
