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
  const prelude = [];
  const sql = vi.fn((strings, ...values) => {
    const text = Array.isArray(strings) ? strings.join(' ') : String(strings);
    // A trava e a aposentadoria da sessao de outro clone rodam SEMPRE, antes de
    // tudo. Ficam num registro PROPRIO: nem consomem resultado combinado nem
    // deslocam `calls[0]`, senao cada teste existente teria que saber de um
    // passo que nao e' o assunto dele.
    if (/base_snapshot_replaced/.test(text)
      || /SELECT n\.current_snapshot_id, s\.native_bundle_id/.test(text)) {
      prelude.push({ text, values });
      return Promise.resolve([]);
    }
    calls.push({ text, values });
    return Promise.resolve(results.shift() || []);
  });
  sql.calls = calls;
  sql.prelude = prelude;
  sql.transaction = (queries) => Promise.all(queries);
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

  it('writes a real expiry on open and extends it on resume (defect 1, 2026-08-20)', async () => {
    // The edit runtime token now lives 4h; the session row is the revocation
    // authority, so an abandoned session must EXPIRE on the server — expires_at
    // was mapped but never written nor enforced (Sol advise 2026-08-20).
    const sql = createSql([[sessionRow({ expires_at: '2026-08-20T18:00:00.000Z' })]]);
    const opened = await openOrResumeEditSession({
      sql, userId: 42, nodeId: NODE_ID, baseSnapshotId: SNAPSHOT_ID,
    });
    expect(opened.expiresAt).toBe('2026-08-20T18:00:00.000Z');
    const text = sql.calls[0].text;
    // INSERT sets the expiry…
    expect(text).toMatch(/INSERT INTO native_motion_edit_sessions[\s\S]*expires_at/i);
    // …and resuming EXTENDS it, so an active editor never dies under the user.
    expect(text).toMatch(/UPDATE native_motion_edit_sessions[\s\S]*expires_at/i);
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
    // Duas consultas de assunto (abrir + normalizar). A trava e a aposentadoria
    // rodam antes de tudo e vivem em `sql.prelude`.
    expect(sql.calls).toHaveLength(2);
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
    // O COMMIT em si é UM statement atômico (snapshot + node + sessão);
    const statement = sql.calls[0].text;
    expect(statement).toContain('INSERT INTO snapshots');
    expect(statement).toContain('UPDATE nodes');
    expect(statement).toContain('UPDATE native_motion_edit_sessions');
    // e a revogação da lease é um follow-up SEPARADO (não faz parte do átomo
    // de commit — o gateway já para de servir pelo status da sessão).
    expect(sql).toHaveBeenCalledTimes(2);
    expect(sql.calls[1].text).toMatch(/UPDATE native_runtime_leases SET status = 'revoked'/);
    expect(sql.calls[1].values).toContain(SESSION_ID);
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

// ── Sessão presa num snapshot morto ─────────────────────────────────────────
//
// MEDIDO no node real do dono (2026-08-22): a sessão do editor apontava para o
// snapshot de 18/08 e o node já estava no de 21/08 (re-clone). O gateway exige
// que os dois sejam o mesmo, então recusava TODO arquivo — "This website
// couldn't be opened for editing", todo dia. E como o índice único deixa uma
// só sessão ativa por node, a velha impedia a nova: re-clonar não adiantava.
describe('uma sessão de outro clone nunca é retomada', () => {
  it('exige que a sessão retomada seja do snapshot ATUAL do node', async () => {
    const sql = createSql([[sessionRow()]]);
    await openOrResumeEditSession({ sql, userId: 42, nodeId: NODE_ID, baseSnapshotId: SNAPSHOT_ID });
    const texto = sql.calls[sql.calls.length - 1].text;
    // A CTE que escolhe a sessão existente tem que comparar com o snapshot da
    // CTE `owned` — sem isso, QUALQUER sessão ativa do node serve, inclusive a
    // de um clone que não existe mais.
    expect(texto).toMatch(/existing AS \([\s\S]*base_snapshot_id\s*=\s*o\.snapshot_id/i);
  });

  it('aposenta a sessão incompatível para que a nova possa nascer', async () => {
    const sql = createSql([[sessionRow()]]);
    await openOrResumeEditSession({ sql, userId: 42, nodeId: NODE_ID, baseSnapshotId: SNAPSHOT_ID });
    const texto = sql.prelude.map((c) => c.text).join('\n');
    expect(texto).toMatch(/UPDATE native_motion_edit_sessions[\s\S]*status\s*=\s*'superseded'/i);
    expect(texto).toMatch(/base_snapshot_replaced/);
  });

  it('trava a linha do node antes de decidir, para dois Edits nao se atropelarem', async () => {
    const sql = createSql([[sessionRow()]]);
    await openOrResumeEditSession({ sql, userId: 42, nodeId: NODE_ID, baseSnapshotId: SNAPSHOT_ID });
    expect(sql.prelude.map((c) => c.text).join('\n')).toMatch(/FOR UPDATE/i);
  });
});

describe('re-clone no meio do Edit', () => {
  // Sem esta separação, quem chamou perde a corrida contra um re-clone e recebe
  // "não encontrado" — a pessoa lê "não pôde ser aberto" sem nada errado. Abrir
  // aqui na base nova seria pior: o token do runtime sai da leitura de QUEM
  // CHAMOU e apontaria para o bundle errado, que é o defeito que isto fecha.
  it('avisa que a base ficou velha, em vez de morrer como nao-encontrado', async () => {
    const sql = vi.fn((strings) => {
      const text = strings.join(' ');
      if (/base_snapshot_replaced/.test(text)) return Promise.resolve([]);
      if (/SELECT n\.current_snapshot_id, s\.native_bundle_id/.test(text)) {
        return Promise.resolve([{ current_snapshot_id: 'snap-novo', native_bundle_id: BUNDLE_ID }]);
      }
      return Promise.resolve([]);   // `owned` vazio: a base pedida não é mais a atual
    });
    sql.transaction = (queries) => Promise.all(queries);
    await expect(openOrResumeEditSession({
      sql, userId: 42, nodeId: NODE_ID, baseSnapshotId: SNAPSHOT_ID,
    })).rejects.toMatchObject({ code: 'stale_base_snapshot', currentSnapshotId: 'snap-novo' });
  });

  it('segue dizendo nao-encontrado quando o node nao tem clone nenhum', async () => {
    const sql = vi.fn((strings) => {
      const text = strings.join(' ');
      if (/base_snapshot_replaced/.test(text)) return Promise.resolve([]);
      if (/SELECT n\.current_snapshot_id, s\.native_bundle_id/.test(text)) {
        return Promise.resolve([{ current_snapshot_id: SNAPSHOT_ID, native_bundle_id: null }]);
      }
      return Promise.resolve([]);
    });
    sql.transaction = (queries) => Promise.all(queries);
    await expect(openOrResumeEditSession({
      sql, userId: 42, nodeId: NODE_ID, baseSnapshotId: SNAPSHOT_ID,
    })).rejects.toMatchObject({ code: 'not_found' });
  });
});

// CTE modificadora roda INTEIRA, independente do resto: incrementar o token de
// edicao numa CTE solta o mexeria mesmo com o autosave recusado (revisao
// obsoleta, sessao fechada, dono errado) — conflito estrutural falso, e com um
// nodeId qualquer mexeria no token de OUTRO node (Sol).
describe('o token de edicao so sobe quando o autosave salva', () => {
  it('o incremento depende da linha salva, e a trava nao incrementa', async () => {
    const sql = createSql([[{ id: SESSION_ID, node_id: NODE_ID, user_id: 42, revision: 1,
      draft_manifest: manifest(), status: 'active', base_snapshot_id: SNAPSHOT_ID, base_bundle_id: BUNDLE_ID }]]);
    await updateEditSessionDraft({
      sql, userId: 42, nodeId: NODE_ID, sessionId: SESSION_ID, expectedRevision: 0, draftManifest: manifest(),
    });
    const texto = sql.calls[sql.calls.length - 1].text;
    // A CTE que trava NAO escreve.
    expect(texto).toMatch(/travado AS \([\s\S]*?SELECT n\.id FROM nodes n[\s\S]*?FOR UPDATE\s*\)/);
    // E o incremento sai DE `salvo`.
    expect(texto).toMatch(/UPDATE nodes SET edit_revision = edit_revision \+ 1\s*FROM salvo/);
    expect(texto).toMatch(/WHERE nodes\.id = salvo\.node_id/);
  });
});

// O aviso de rascunho aposentado viaja no objeto `session`, e o ramo de
// migracao de manifesto devolve OUTRO objeto. Sem reaplicar, o trabalho perdido
// sumiria calado exatamente quando a sessao escolhida precisa migrar (Sol).
describe('o aviso sobrevive a migracao de manifesto', () => {
  it('reaplica supersededDraft no objeto migrado', async () => {
    const legado = { schemaVersion: 1, baseBundleId: BUNDLE_ID, runtimeFingerprint: RUNTIME_FINGERPRINT, patches: [] };
    const sql = vi.fn((strings) => {
      const text = strings.join(' ');
      if (/base_snapshot_replaced/.test(text)) {
        // aposenta um rascunho COM trabalho
        return Promise.resolve([{ id: 'sess-velha', revision: 2, edits: 3 }]);
      }
      if (/SELECT n\.current_snapshot_id, s\.native_bundle_id/.test(text)) return Promise.resolve([]);
      if (/UPDATE native_motion_edit_sessions/.test(text) && /draft_manifest =/.test(text)) {
        return Promise.resolve([sessionRow({ draft_manifest: manifest(), revision: 1, stored_manifest_version: 2 })]);
      }
      return Promise.resolve([sessionRow({ draft_manifest: legado, stored_manifest_version: 1 })]);
    });
    sql.transaction = (queries) => Promise.all(queries);
    const aberta = await openOrResumeEditSession({ sql, userId: 42, nodeId: NODE_ID, baseSnapshotId: SNAPSHOT_ID });
    expect(aberta.supersededDraft).toMatchObject({ sessionId: 'sess-velha', edits: 3 });
  });
});
// A guarda de reuso JA EXISTIA (sameDescriptor + immutable_bundle_conflict) —
// a auditoria alegou 'reuso silencioso' e nao procede; este teste FIXA o
// comportamento para a classe nunca regredir: mesmo id com content_hash
// divergente e' erro tipado, nunca troca silenciosa.
describe('persistNativeBundleDescriptor confere os campos imutaveis no reuso', () => {
  it('recusa reuso quando o content_hash diverge sob o mesmo bundle_id', async () => {
    const bundleId = '33333333-3333-5333-8333-333333333333';
    const base = {
      bundleId,
      schemaVersion: 1,
      storageKey: `native-bundles/v1/${bundleId}`,
      contentHash: `sha256:${'a'.repeat(64)}`,
      entryPath: 'index.html',
      runtimeFingerprint: `sha256:${'b'.repeat(64)}`,
      assetIndex: [{ path: 'index.html', contentType: 'text/html', byteLength: 10, contentHash: `sha256:${'c'.repeat(64)}` }],
      reconstructionCapabilities: { detectedEngines: [], candidateControls: [] },
    };
    const linhas = [];
    const sql = (strings, ...values) => {
      const texto = Array.isArray(strings) ? strings.join('?') : String(strings);
      if (/INSERT INTO native_bundles/i.test(texto)) { return Promise.resolve([]); }
      if (/SELECT \* FROM native_bundles/i.test(texto)) {
        // a linha JA EXISTENTE tem outro content_hash
        return Promise.resolve([{
          bundle_id: bundleId, schema_version: 1, storage_key: base.storageKey,
          content_hash: `sha256:${'f'.repeat(64)}`, entry_path: 'index.html',
          runtime_fingerprint: base.runtimeFingerprint,
          asset_index: base.assetIndex, reconstruction_capabilities: base.reconstructionCapabilities,
        }]);
      }
      linhas.push(texto);
      return Promise.resolve([]);
    };
    await expect(persistNativeBundleDescriptor({ sql, descriptor: base }))
      .rejects.toThrow(/different descriptor|immutable_bundle_conflict/i);
  });
});

